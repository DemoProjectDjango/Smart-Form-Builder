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

    @TestVisible
    private static Integer maxSubmissionsPerMinute = 60; // per form; generous so a busy form never trips it
    private static final String CAPTCHA_KEY = '_captcha';
    private static final String HONEYPOT_KEY = 'hp_website';
    private static final String SAVED = 'Success! Submission saved.';
    private static final String FAILED = 'We could not save your submission. Please try again later.';

    public Form__c formRec { get; private set; }

    /**
     * @description Public Turnstile site key for this form, or '' when the form does not use a
     *              captcha or spam protection is not connected. Drives loading of the widget script.
     */
    public String captchaSiteKey {
        get {
            return formRec != null && formRec.Captcha_Enabled__c == true ? TurnstileVerifier.connectedSiteKey() : '';
        }
    }

    /** @description True when the Turnstile widget script must be loaded on the page. */
    public Boolean showCaptcha {
        get { return String.isNotBlank(captchaSiteKey); }
    }

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
                'js'   => sanitizeJs(formRec.JS_Template__c),
                'captchaSiteKey' => captchaSiteKey
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
     *
     *              Before anything is written: a per-form rate cap applies to every form, a filled
     *              honeypot is dropped silently, and forms that require a captcha must carry a
     *              Turnstile token that Cloudflare confirms (fail closed on any error). The token and
     *              honeypot keys are removed so they are never stored with the submission.
     */
    @RemoteAction
    @SuppressWarnings('PMD.ApexCRUDViolation')
    public static String saveSubmission(String payloadJson, Id formId) {
        if (formId == null)              { return 'Form ID missing'; }
        if (String.isBlank(payloadJson)) { return 'Payload is missing'; }
        if (formId.getSobjectType() != Form__c.SObjectType) { return 'Invalid form ID'; }
        if (payloadJson.length() > MAX_PAYLOAD_LEN) { return 'Submission too large'; }
        try {
            GuestFormService guest = new GuestFormService();
            if (guest.isBusy(formId, maxSubmissionsPerMinute)) {
                return 'This form is receiving a lot of submissions right now. Please try again in a minute.';
            }
            ScreenedPayload screened = screenPayload(payloadJson, formId, guest.captchaRequired(formId));
            if (screened.reply != null) { return screened.reply; }
            Form_Submission__c submission = new Form_Submission__c(
                Payload_JSON__c = screened.payload,
                Form__c         = formId
            );
            new GuestSubmissionWriter().insertSubmission(submission);
            return SAVED;
        } catch (Exception e) {
            // Details stay server-side; visitors never see Salesforce internals.
            return FAILED;
        }
    }

    /**
     * @description Outcome of the spam screening: either a reply to return to the visitor right away
     *              (reply != null) or the payload to store.
     */
    private class ScreenedPayload {
        String reply;
        String payload;
    }

    private static ScreenedPayload screenPayload(String payloadJson, Id formId, Boolean captchaRequired) {
        ScreenedPayload screened = new ScreenedPayload();
        screened.payload = payloadJson;
        if (!captchaRequired && !payloadJson.contains('"' + CAPTCHA_KEY + '"') && !payloadJson.contains('"' + HONEYPOT_KEY + '"')) {
            return screened;
        }
        Map<String, Object> fields = (Map<String, Object>) JSON.deserializeUntyped(payloadJson);
        if (fields == null) {
            screened.reply = FAILED;
            return screened;
        }
        Object trap = fields.remove(HONEYPOT_KEY);
        Object token = fields.remove(CAPTCHA_KEY);
        if (trap != null && String.isNotBlank(String.valueOf(trap))) {
            screened.reply = SAVED; // looks like success to the bot; nothing is stored
            return screened;
        }
        if (captchaRequired && !TurnstileVerifier.verify(token == null ? null : String.valueOf(token), formId).success) {
            screened.reply = 'The spam check failed. Please reload the page and try again.';
            return screened;
        }
        screened.payload = JSON.serialize(fields);
        if (screened.payload.length() > MAX_PAYLOAD_LEN) {
            screened.reply = 'Submission too large';
        }
        return screened;
    }

    // ── Guest elevated-access service ────────────────────────────────────────
    /**
     * @description Private without sharing inner class that performs the single
     *              operation that needs elevated access for the unauthenticated Site
     *              guest user.
     *
     *              WHY without sharing / SYSTEM_MODE here:
     *              fetchFormForDisplay — the guest user has no sharing-based record
     *              visibility and no FLS on the packaged Form__c fields. Rendering a
     *              published form for anonymous visitors is the core product feature;
     *              the query is read-only, selects only the four fields needed to
     *              render, is filtered by a type-checked Id, and every value is
     *              passed through the HTML/CSS/JS sanitizers before output.
     *
     *              This class is private and not accessible outside FormController,
     *              limiting the elevated scope to exactly this read.
     */
    private without sharing class GuestFormService {

        Form__c fetchFormForDisplay(Id formId) {
            List<Form__c> forms = [
                SELECT HTML_Template__c,
                       CSS_Template__c,
                       JS_Template__c,
                       Field_Dependencies__c,
                       Captcha_Enabled__c
                FROM Form__c
                WHERE Id = :formId
                WITH SYSTEM_MODE
                LIMIT 1
            ];
            return forms.isEmpty() ? null : forms[0];
        }

        /**
         * WHY SYSTEM_MODE: the guest user has no FLS on the packaged Form__c fields, and whether a
         * form demands a captcha must be decided by the server, never by the visitor. Reads one
         * checkbox for one type-checked Id.
         */
        Boolean captchaRequired(Id formId) {
            // code-analyzer-suppress sfge.ApexFlsViolation, sfge.DatabaseOperationsMustUseWithSharing
            List<Form__c> forms = [
                SELECT Captcha_Enabled__c
                FROM Form__c
                WHERE Id = :formId
                WITH SYSTEM_MODE
                LIMIT 1
            ];
            return !forms.isEmpty() && forms[0].Captcha_Enabled__c == true;
        }

        /**
         * WHY SYSTEM_MODE: the guest user cannot see other visitors' submissions, but the rate cap
         * must count all of them. Returns only a yes/no answer, never record data.
         */
        Boolean isBusy(Id formId, Integer maxPerMinute) {
            Datetime since = Datetime.now().addSeconds(-60);
            // code-analyzer-suppress sfge.ApexFlsViolation, sfge.DatabaseOperationsMustUseWithSharing
            Integer recent = [
                SELECT COUNT()
                FROM Form_Submission__c
                WHERE Form__c = :formId AND CreatedDate >= :since
                WITH SYSTEM_MODE
                LIMIT 1000
            ];
            return recent >= maxPerMinute;
        }

    }

    /**
     * @description Writes the visitor's submission in user mode: sharing, object
     *              permissions and field-level security of the running (guest) user are
     *              enforced, using the Form Builder Guest permission set. The record is
     *              constructed by the caller with a fixed, code-controlled field list
     *              (raw payload + parent form lookup); no guest-supplied field names are
     *              ever written.
     */
    private with sharing class GuestSubmissionWriter {
        void insertSubmission(Form_Submission__c submission) {
            insert as user submission;
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