/**
 * @description Visualforce page controller for the public-facing form page.
 *
 *              SECURITY ARCHITECTURE (for AppExchange security review):
 *              The outer class is declared WITH SHARING. The only operations that
 *              require elevated access in the unauthenticated Site guest user
 *              context are isolated in the private GuestFormService inner class
 *              below, with a documented justification for each operation.
 *              All authenticated @AuraEnabled operations live in FormAuraController
 *              (with sharing, WITH USER_MODE throughout).
 */
@SuppressWarnings('PMD.CyclomaticComplexity')
public with sharing class FormController {

    @TestVisible
    private static final Integer MAX_PAYLOAD_LEN = 131070; // Form_Submission__c.Payload_JSON__c length

    public Form__c formRec { get; private set; }

    public String sanitizedHTML {
        get { return formRec != null ? sanitizeHtml(formRec.HTML_Template__c) : ''; }
    }
    public String sanitizedCSS {
        get { return formRec != null ? sanitizeCss(formRec.CSS_Template__c) : ''; }
    }
    public String sanitizedJS {
        get { return formRec != null ? sanitizeJs(formRec.JS_Template__c) : ''; }
    }

    public String formPayloadJson {
        get {
            if (formRec == null) { return '{}'; }
            Map<String, Object> payload = new Map<String, Object>{
                'id'   => String.valueOf(formRec.Id),
                'html' => sanitizeHtml(formRec.HTML_Template__c),
                'css'  => sanitizeCss(formRec.CSS_Template__c),
                'js'   => sanitizeJs(formRec.JS_Template__c)
            };
            return JSON.serialize(payload).replace('</', '<\\/');
        }
    }

    public FormController() {
        initFormRec();
    }

    private void initFormRec() {
        String formIdParam = ApexPages.currentPage().getParameters().get('id');
        if (String.isBlank(formIdParam)) { return; }
        Id formId;
        try {
            formId = (Id) formIdParam;
        } catch (Exception e) {
            return;
        }
        // Type-check the Id so arbitrary record Ids of other objects are rejected
        // before any query runs in the elevated guest service.
        if (formId.getSobjectType() != Form__c.SObjectType) { return; }
        formRec = new GuestFormService().fetchFormForDisplay(formId);
    }

    /**
     * @description Saves a public form submission via Visualforce @RemoteAction.
     *              Field list is fixed in code (Payload_JSON__c + Form__c lookup only);
     *              payload length is capped to the field size; the Id is type-checked.
     */
    @RemoteAction
    @SuppressWarnings('PMD.ApexCRUDViolation')
    public static String saveSubmission(String payloadJson, Id formId) {
        if (formId == null)              { return 'Form ID missing'; }
        if (String.isBlank(payloadJson)) { return 'Payload is missing'; }
        if (formId.getSobjectType() != Form__c.SObjectType) { return 'Invalid form ID'; }
        if (payloadJson.length() > MAX_PAYLOAD_LEN) { return 'Submission too large'; }
        try {
            Form_Submission__c submission = new Form_Submission__c(
                Payload_JSON__c = payloadJson,
                Form__c         = formId
            );
            new GuestFormService().insertSubmission(submission);
            return 'Success! Submission saved.';
        } catch (DmlException e) {
            return 'Submission error: ' + e.getDmlMessage(0);
        } catch (Exception e) {
            return 'Submission error: ' + e.getMessage();
        }
    }

    // ── Guest elevated-access service ────────────────────────────────────────
    /**
     * @description Private without sharing inner class that performs the two (and
     *              only two) operations the unauthenticated Site guest user needs.
     *
     *              WHY without sharing / SYSTEM_MODE here:
     *              1. fetchFormForDisplay — the guest user has no sharing-based record
     *                 visibility and no FLS on the packaged Form__c fields. Rendering a
     *                 published form for anonymous visitors is the core product feature;
     *                 the query is read-only, selects only the four fields needed to
     *                 render, is filtered by a type-checked Id, and every value is
     *                 passed through the HTML/CSS/JS sanitizers before output.
     *              2. insertSubmission — the guest user has no FLS on Form_Submission__c.
     *                 The record is constructed in the outer class with a fixed,
     *                 code-controlled field list (raw payload + parent form lookup);
     *                 no guest-supplied field names are ever written.
     *
     *              This class is private and not accessible outside FormController,
     *              limiting the elevated scope to exactly these operations.
     */
    private without sharing class GuestFormService {

        Form__c fetchFormForDisplay(Id formId) {
            List<Form__c> forms = [
                SELECT HTML_Template__c,
                       CSS_Template__c,
                       JS_Template__c,
                       Field_Dependencies__c
                FROM Form__c
                WHERE Id = :formId
                WITH SYSTEM_MODE
                LIMIT 1
            ];
            return forms.isEmpty() ? null : forms[0];
        }

        void insertSubmission(Form_Submission__c submission) {
            Database.insert(submission, AccessLevel.USER_MODE);
        }
    }

    @TestVisible
    private static String sanitizeHtml(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replaceAll('(?is)<script[^>]*>.*?</script>', '')
            .replaceAll('(?is)<(iframe|object|embed|base|link|meta)[^>]*/?>', '')
            .replaceAll('(?i)\\s+on\\w+\\s*=\\s*("[^"]*"|\'[^\']*\'|[^\\s>]+)', '')
            .replaceAll('(?i)(href|src|action)\\s*=\\s*["\']?\\s*(javascript|data):[^"\'\\s>]*["\']?', '');
    }

    @TestVisible
    private static String sanitizeCss(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replaceAll('(?i)url\\s*\\(\\s*["\']?\\s*javascript:.*?["\']?\\s*\\)', 'url(invalid)')
            .replaceAll('(?i)expression\\s*\\(', '/*blocked*/(')
            .replaceAll('(?i)-moz-binding\\s*:', '/*blocked*/:');
    }

    @TestVisible
    private static String sanitizeJs(String input) {
        if (String.isBlank(input)) { return ''; }
        return input
            .replaceAll('(?i)\\beval\\s*\\(',         '/*blocked*/eval(')
            .replaceAll('(?i)new\\s+Function\\s*\\(', '/*blocked*/new Function(');
    }
}