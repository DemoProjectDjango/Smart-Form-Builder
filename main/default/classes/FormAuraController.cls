/**
 * @description Handles all authenticated @AuraEnabled operations for the Form Builder.
 *              Declared with sharing — sharing rules and FLS enforced via USER_MODE.
 */
public with sharing class FormAuraController {

    @AuraEnabled
    public static Id saveFormTemplate(String reqJson) {
        FormTemplateRequest req = (FormTemplateRequest) JSON.deserialize(reqJson, FormTemplateRequest.class);
        validateRequest(req);

        if (req.formId != null) {
            ensureUpdatePermissions();
            Form__c form = loadFormForUpdate(req.formId);
            applyFormFields(form, req);
            // Only touched when it changes, so users without access to the field can still save forms.
            if (req.captchaEnabled != null && req.captchaEnabled != FormEditorController.readCaptchaFlag(req.formId)) {
                form.Captcha_Enabled__c = req.captchaEnabled;
            }
            bumpVersion(form);
            try {
                update as user form;
            } catch (DmlException e) {
                throw new AuraHandledException('Failed to update form: ' + e.getDmlMessage(0));
            }
            return form.Id;
        }

        ensureCreatePermissions();
        Form__c newForm = buildNewForm(req);
        if (req.captchaEnabled == true) {
            newForm.Captcha_Enabled__c = true;
        }
        newForm.Version__c = calculateNextVersionForNewForm(req.name);
        try {
            insert as user newForm;
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to create form: ' + e.getDmlMessage(0));
        }
        return newForm.Id;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getFormTemplates() {
        if (!Schema.sObjectType.Form__c.isAccessible()) {
            return new List<Map<String, String>>();
        }
        List<Map<String, String>> options = new List<Map<String, String>>();
        for (Form__c f : [
            SELECT Id, Name
            FROM Form__c
            WHERE Name != null
            WITH USER_MODE
            ORDER BY Name ASC
            LIMIT 200
        ]) {
            options.add(new Map<String, String>{ 'label' => f.Name, 'value' => f.Id });
        }
        return options;
    }

    private static void validateRequest(FormTemplateRequest req) {
        if (req == null) { throw new AuraHandledException('Request payload is missing.'); }
        if (String.isBlank(req.name)) { throw new AuraHandledException('Form name is required.'); }
        String configError = FormConfigValidator.validate(req.fieldConfigJson);
        if (configError == null) {
            configError = captchaError(req);
        }
        if (configError != null) {
            AuraHandledException ex = new AuraHandledException(configError);
            ex.setMessage(configError);
            throw ex;
        }
    }

    private static String captchaError(FormTemplateRequest req) {
        if (req.captchaEnabled == true && !TurnstileVerifier.isConnected()) {
            return 'Connect spam protection on the Spam protection tab before requiring a captcha on a form.';
        }
        return null;
    }

    private static void ensureUpdatePermissions() {
        if (!Schema.sObjectType.Form__c.isAccessible()) { throw new AuraHandledException('You do not have access to Form__c.'); }
        if (!Schema.sObjectType.Form__c.isUpdateable()) { throw new AuraHandledException('You do not have permission to update Form__c.'); }
    }

    private static void ensureCreatePermissions() {
        if (!Schema.sObjectType.Form__c.isAccessible()) { throw new AuraHandledException('You do not have access to Form__c.'); }
        if (!Schema.sObjectType.Form__c.isCreateable()) { throw new AuraHandledException('You do not have permission to create Form__c.'); }
    }

    private static Form__c loadFormForUpdate(Id formId) {
        if (formId == null) { throw new AuraHandledException('Form Id is required.'); }
        if (!Schema.sObjectType.Form__c.isAccessible()) { throw new AuraHandledException('You do not have access to Form__c.'); }
        List<Form__c> forms = [
            SELECT Id, Version__c, Name,
                   HTML_Template__c, CSS_Template__c, JS_Template__c,
                   Field_Dependencies__c, Object_API_Name__c, Field_Config__c
            FROM Form__c
            WHERE Id = :formId
            WITH USER_MODE
            LIMIT 1
        ];
        if (forms.isEmpty()) { throw new AuraHandledException('Form not found for update.'); }
        return forms[0];
    }

    private static void applyFormFields(Form__c form, FormTemplateRequest req) {
        form.Name                  = req.name;
        form.HTML_Template__c      = sanitizeHtml(req.html);
        form.CSS_Template__c       = sanitizeCss(req.css);
        form.JS_Template__c        = sanitizeJs(req.js);
        form.Field_Dependencies__c = req.fieldDependenciesJson;
        form.Object_API_Name__c    = req.objectApiName;
        form.Field_Config__c       = req.fieldConfigJson;
    }

    private static void bumpVersion(Form__c form) {
        form.Version__c = (form.Version__c == null || form.Version__c == 0) ? 1 : form.Version__c + 1;
    }

    private static Form__c buildNewForm(FormTemplateRequest req) {
        return new Form__c(
            Name                  = req.name,
            HTML_Template__c      = sanitizeHtml(req.html),
            CSS_Template__c       = sanitizeCss(req.css),
            JS_Template__c        = sanitizeJs(req.js),
            Field_Dependencies__c = req.fieldDependenciesJson,
            Object_API_Name__c    = req.objectApiName,
            Field_Config__c       = req.fieldConfigJson,
            Is_Public__c         = true
        );
    }

    private static Decimal calculateNextVersionForNewForm(String name) {
        AggregateResult[] maxVersions = [
            SELECT MAX(Version__c) maxVer
            FROM Form__c
            WHERE Name = :name
            WITH USER_MODE
        ];
        if (maxVersions.isEmpty() || maxVersions[0].get('maxVer') == null) { return 1; }
        return (Decimal) maxVersions[0].get('maxVer') + 1;
    }

    private static String sanitizeHtml(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replaceAll('(?is)<script[^>]*>.*?</script>', '')
            .replaceAll('(?is)<(iframe|object|embed|base|link|meta)[^>]*/?>', '')
            .replaceAll('(?i)\\s+on\\w+\\s*=\\s*("[^"]*"|\'[^\']*\'|[^\\s>]+)', '')
            .replaceAll('(?i)(href|src|action)\\s*=\\s*["\']?\\s*(javascript|data):[^"\'\\s>]*["\']?', '');
    }

    private static String sanitizeCss(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replaceAll('(?i)url\\s*\\(\\s*["\']?\\s*javascript:.*?["\']?\\s*\\)', 'url(invalid)')
            .replaceAll('(?i)expression\\s*\\(', '/*blocked*/(')
            .replaceAll('(?i)-moz-binding\\s*:', '/*blocked*/:');
    }

    private static String sanitizeJs(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replaceAll('(?i)\\beval\\s*\\(',         '/*blocked*/eval(')
            .replaceAll('(?i)new\\s+Function\\s*\\(', '/*blocked*/new Function(');
    }
}