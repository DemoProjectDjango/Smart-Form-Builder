/**
 * @description Admin screen backend for form spam protection (Cloudflare Turnstile keys).
 *
 *              The keys are stored in the protected Captcha_Settings__c custom setting, which is
 *              readable only by this package's Apex. The secret key is write-only: it is never
 *              returned to the browser, only reported as "saved".
 *
 *              Writes to the protected setting run in system mode (custom settings have no
 *              object or field permissions to enforce), so every write is gated by the
 *              Manage_Spam_Protection custom permission, which ships in FormBuilder_Admin.
 */
public with sharing class CaptchaSettingsController {

    private static final String DENIED = 'You do not have permission to manage spam protection. Ask an administrator to assign the FormBuilder_Admin permission set.';

    /**
     * @description What the setup screen shows. Contains no secret.
     */
    public class Status {
        @AuraEnabled public String siteKey = '';
        @AuraEnabled public Boolean secretSaved = false;
        @AuraEnabled public Boolean connected = false;
        @AuraEnabled public Boolean canManage = false;
        @AuraEnabled public Integer formsUsing = 0;
        @AuraEnabled public String message = '';
    }

    /**
     * @description Current spam protection status.
     * @return Status without the secret key.
     */
    @AuraEnabled
    public static Status getStatus() {
        return buildStatus('');
    }

    /**
     * @description Saves the keys. A blank secret keeps the stored one. Saving always resets the
     *              connection state, so the keys must pass the test again before forms can use them.
     * @param siteKey Public site key from the Turnstile widget.
     * @param secretKey Secret key from the Turnstile widget, or blank to keep the saved one.
     * @return Updated status.
     */
    @AuraEnabled
    @SuppressWarnings('PMD.ApexCRUDViolation') // gated by the Manage_Spam_Protection custom permission
    public static Status saveKeys(String siteKey, String secretKey) {
        requireManager();
        String site = String.isBlank(siteKey) ? '' : siteKey.trim();
        String secret = String.isBlank(secretKey) ? '' : secretKey.trim();
        Captcha_Settings__c cfg = Captcha_Settings__c.getOrgDefaults();
        String problem = keyProblem(site, secret, String.isNotBlank(cfg.Secret_Key__c));
        if (problem != null) {
            throw fail(problem);
        }
        cfg.Site_Key__c = site;
        if (secret != '') {
            cfg.Secret_Key__c = secret;
        }
        cfg.Connected__c = false;
        upsert cfg;
        return buildStatus('Keys saved. Run the connection test to turn spam protection on for your forms.');
    }

    /**
     * @description Tests the saved secret key with Cloudflare and records the result.
     * @return Updated status; connected is true only when Cloudflare accepted the secret key.
     */
    @AuraEnabled
    @SuppressWarnings('PMD.ApexCRUDViolation') // gated by the Manage_Spam_Protection custom permission
    public static Status testConnection() {
        requireManager();
        Captcha_Settings__c cfg = Captcha_Settings__c.getOrgDefaults();
        if (String.isBlank(cfg.Site_Key__c) || String.isBlank(cfg.Secret_Key__c)) {
            throw fail('Save your site key and secret key first.');
        }
        TurnstileVerifier.Result outcome = TurnstileVerifier.probe(cfg.Secret_Key__c);
        cfg.Connected__c = outcome.success;
        upsert cfg;
        return buildStatus(outcome.message);
    }

    /**
     * @description Removes both keys. Forms that require a captcha stop accepting submissions
     *              until keys are saved and tested again, so the status reports how many are affected.
     * @return Updated status.
     */
    @AuraEnabled
    @SuppressWarnings('PMD.ApexCRUDViolation') // gated by the Manage_Spam_Protection custom permission
    public static Status clearKeys() {
        requireManager();
        Captcha_Settings__c cfg = Captcha_Settings__c.getOrgDefaults();
        cfg.Site_Key__c = null;
        cfg.Secret_Key__c = null;
        cfg.Connected__c = false;
        upsert cfg;
        return buildStatus('Keys removed.');
    }

    /** The first problem with the keys the admin entered, or null when they can be saved. */
    private static String keyProblem(String site, String secret, Boolean secretAlreadySaved) {
        if (!TurnstileVerifier.isValidKeyFormat(site)) {
            return 'Enter the site key from your Turnstile widget.';
        }
        if (secret == '') {
            return secretAlreadySaved ? null : 'Enter the secret key from your Turnstile widget.';
        }
        return TurnstileVerifier.isValidKeyFormat(secret)
            ? null
            : 'The secret key does not look like a Turnstile key. Copy it again from Cloudflare.';
    }

    private static Status buildStatus(String message) {
        Captcha_Settings__c cfg = Captcha_Settings__c.getOrgDefaults();
        Status s = new Status();
        s.siteKey = cfg.Site_Key__c == null ? '' : cfg.Site_Key__c;
        s.secretSaved = String.isNotBlank(cfg.Secret_Key__c);
        s.connected = TurnstileVerifier.isConnected();
        s.canManage = FeatureManagement.checkPermission('Manage_Spam_Protection');
        s.formsUsing = countFormsUsingCaptcha();
        s.message = message;
        return s;
    }

    private static Integer countFormsUsingCaptcha() {
        try {
            return [SELECT COUNT() FROM Form__c WHERE Captcha_Enabled__c = TRUE WITH USER_MODE];
        } catch (QueryException e) {
            return 0; // no field access
        } catch (SecurityException e) {
            return 0; // no object access
        }
    }

    private static void requireManager() {
        if (!FeatureManagement.checkPermission('Manage_Spam_Protection')) {
            throw fail(DENIED);
        }
    }

    private static AuraHandledException fail(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        return ex;
    }
}
