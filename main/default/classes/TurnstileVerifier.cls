/**
 * @description Verifies Cloudflare Turnstile tokens for published forms.
 *
 *              The site key is public (it is rendered in the form). The secret key lives in the
 *              protected Captcha_Settings__c custom setting: only this package's code can read it,
 *              and it is never returned to any client. Every failure path (missing keys, timeout,
 *              malformed response) is treated as "not verified", so a broken or unreachable
 *              verification service can never let an unchecked submission through.
 */
public with sharing class TurnstileVerifier {

    @TestVisible
    private static final String VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    @TestVisible
    private static final Integer TIMEOUT_MS = 8000;
    @TestVisible
    private static final Integer MAX_TOKEN_LENGTH = 2048;
    // A syntactically valid but meaningless widget answer: lets us check the secret key without a widget.
    private static final String PROBE_ANSWER = 'smart-forms-connection-test';
    private static final String KEY_PATTERN = '[A-Za-z0-9_-]{10,100}';

    /**
     * @description Outcome of a verification call. message is safe to log or show to an admin;
     *              it never contains the secret key.
     */
    public class Result {
        public Boolean success = false;
        public String message = '';
        public List<String> errorCodes = new List<String>();
        public String cdata;
    }

    /**
     * @description True when the key has the shape of a Turnstile key. Used before anything is stored.
     * @param key Candidate site or secret key.
     * @return True when the key is acceptable.
     */
    public static Boolean isValidKeyFormat(String key) {
        return String.isNotBlank(key) && Pattern.matches(KEY_PATTERN, key);
    }

    /**
     * @description True when both keys are saved and the secret key passed the connection test.
     * @return Whether forms may require a captcha.
     */
    public static Boolean isConnected() {
        Captcha_Settings__c cfg = Captcha_Settings__c.getOrgDefaults();
        return cfg != null
            && cfg.Connected__c == true
            && String.isNotBlank(cfg.Site_Key__c)
            && String.isNotBlank(cfg.Secret_Key__c);
    }

    /**
     * @description The public site key to render in the form, or an empty string when not connected.
     * @return Site key or ''.
     */
    public static String connectedSiteKey() {
        return isConnected() ? Captcha_Settings__c.getOrgDefaults().Site_Key__c : '';
    }

    /**
     * @description Verifies a visitor's token with Cloudflare and checks it was issued for this form.
     * @param token Token produced by the widget in the visitor's browser.
     * @param formId Form the visitor is submitting; the widget was rendered with this as cdata.
     * @return Result whose success flag is true only for a valid token bound to this form.
     */
    public static Result verify(String token, Id formId) {
        Result outcome = new Result();
        if (String.isBlank(token) || token.length() > MAX_TOKEN_LENGTH) {
            outcome.message = 'Missing or malformed token.';
            return outcome;
        }
        if (!isConnected()) {
            outcome.message = 'Spam protection is not connected.';
            return outcome;
        }
        outcome = callSiteVerify(Captcha_Settings__c.getOrgDefaults().Secret_Key__c, token);
        if (outcome.success && !boundToForm(outcome.cdata, formId)) {
            outcome.success = false;
            outcome.message = 'Token was issued for a different form.';
        }
        return outcome;
    }

    /**
     * @description Checks a secret key against Cloudflare using a dummy widget answer.
     *              A valid secret yields "invalid-input-response" (or success for Cloudflare's
     *              always-pass test secret); a wrong secret yields HTTP 400 "invalid-input-secret".
     * @param secretKey The secret key to test.
     * @return Result whose success flag means "the secret key is accepted by Cloudflare".
     */
    public static Result probe(String secretKey) {
        Result outcome = new Result();
        if (!isValidKeyFormat(secretKey)) {
            outcome.message = 'The secret key is not saved or does not look like a Turnstile key.';
            return outcome;
        }
        Result reply = callSiteVerify(secretKey, PROBE_ANSWER);
        outcome.errorCodes = reply.errorCodes;
        if (reply.errorCodes.contains('invalid-input-secret') || reply.errorCodes.contains('missing-input-secret')) {
            outcome.message = 'Cloudflare did not accept this secret key. Copy it again from the Turnstile widget.';
        } else if (reply.success || reply.errorCodes.contains('invalid-input-response')) {
            outcome.success = true;
            outcome.message = 'Cloudflare accepted the secret key.';
        } else {
            outcome.message = reply.message;
        }
        return outcome;
    }

    private static Boolean boundToForm(String cdata, Id formId) {
        if (String.isBlank(cdata) || formId == null) {
            return false;
        }
        try {
            return Id.valueOf(cdata) == formId;
        } catch (StringException e) {
            return false;
        }
    }

    private static Result callSiteVerify(String secretKey, String token) {
        Result outcome = new Result();
        HttpResponse res;
        try {
            res = new Http().send(buildRequest(secretKey, token));
        } catch (CalloutException e) {
            outcome.message = 'Could not reach Cloudflare. Check that the Remote Site Setting is active.';
            return outcome;
        }
        Integer status = res.getStatusCode();
        Map<String, Object> body = parseBody(res.getBody());
        if (body == null) {
            outcome.message = status == 200 ? 'Unreadable answer from Cloudflare.' : 'Cloudflare answered with status ' + status + '.';
            return outcome;
        }
        // Cloudflare answers 400 with a JSON body for a wrong secret key, so the body is read for any
        // status. Only an HTTP 200 carrying success=true counts as verified.
        outcome.errorCodes = readErrorCodes(body);
        outcome.cdata = body.get('cdata') == null ? null : String.valueOf(body.get('cdata'));
        outcome.success = status == 200 && body.get('success') == true;
        outcome.message = describe(outcome, status);
        return outcome;
    }

    private static HttpRequest buildRequest(String secretKey, String token) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(VERIFY_ENDPOINT);
        req.setMethod('POST');
        req.setTimeout(TIMEOUT_MS);
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody(
            'secret=' + EncodingUtil.urlEncode(secretKey, 'UTF-8')
            + '&response=' + EncodingUtil.urlEncode(token, 'UTF-8')
        );
        return req;
    }

    private static Map<String, Object> parseBody(String raw) {
        try {
            return (Map<String, Object>) JSON.deserializeUntyped(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<String> readErrorCodes(Map<String, Object> body) {
        List<String> codes = new List<String>();
        if (body.get('error-codes') instanceof List<Object>) {
            for (Object code : (List<Object>) body.get('error-codes')) {
                codes.add(String.valueOf(code));
            }
        }
        return codes;
    }

    private static String describe(Result outcome, Integer status) {
        if (outcome.success) {
            return 'Verified.';
        }
        Boolean explained = status == 200 || !outcome.errorCodes.isEmpty();
        return explained ? 'Cloudflare rejected the token.' : 'Cloudflare answered with status ' + status + '.';
    }
}
