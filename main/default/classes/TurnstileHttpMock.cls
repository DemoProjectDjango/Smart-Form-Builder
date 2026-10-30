/**
 * @description Test double for the Cloudflare Turnstile siteverify endpoint.
 */
@IsTest
public class TurnstileHttpMock implements HttpCalloutMock {

    public static String lastRequestBody;
    public static Integer callCount = 0;

    private final Integer statusCode;
    private final String body;
    private final Boolean throwError;

    public TurnstileHttpMock(Integer statusCode, String body) {
        this.statusCode = statusCode;
        this.body = body;
        this.throwError = false;
    }

    public TurnstileHttpMock() {
        this.statusCode = 0;
        this.body = '';
        this.throwError = true;
    }

    /** @description Cloudflare accepted the token and echoes the cdata the widget was rendered with. */
    public static TurnstileHttpMock accepted(String cdata) {
        return new TurnstileHttpMock(200, '{"success":true,"error-codes":[],"cdata":"' + cdata + '","action":"submit"}');
    }

    public static TurnstileHttpMock rejected(String errorCode) {
        return new TurnstileHttpMock(200, '{"success":false,"error-codes":["' + errorCode + '"]}');
    }

    public HttpResponse respond(HttpRequest req) {
        lastRequestBody = req.getBody();
        callCount++;
        if (throwError) {
            throw new CalloutException('Simulated network failure');
        }
        HttpResponse res = new HttpResponse();
        res.setStatusCode(statusCode);
        res.setBody(body);
        return res;
    }
}
