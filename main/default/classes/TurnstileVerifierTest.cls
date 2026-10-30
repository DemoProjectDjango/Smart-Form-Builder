@IsTest
private class TurnstileVerifierTest {

    private static final String SITE_KEY = '1x00000000000000000000AA';
    private static final String SECRET = '1x0000000000000000000000000000000AA';

    private static Form__c createForm() {
        Form__c form = new Form__c(Name = 'Captcha Form');
        insert form;
        return form;
    }

    private static void saveKeys(Boolean connected) {
        insert new Captcha_Settings__c(Site_Key__c = SITE_KEY, Secret_Key__c = SECRET, Connected__c = connected);
    }

    @IsTest
    static void testKeyFormat() {
        System.assert(TurnstileVerifier.isValidKeyFormat(SITE_KEY));
        System.assert(TurnstileVerifier.isValidKeyFormat('0x4AAAAAAABBBBBCCCCCDDDDD'));
        System.assert(!TurnstileVerifier.isValidKeyFormat(null));
        System.assert(!TurnstileVerifier.isValidKeyFormat(''));
        System.assert(!TurnstileVerifier.isValidKeyFormat('short'));
        System.assert(!TurnstileVerifier.isValidKeyFormat('has space in it 12345'));
        System.assert(!TurnstileVerifier.isValidKeyFormat('bad&key=1234567890'));
    }

    @IsTest
    static void testNotConnectedUntilTested() {
        System.assertEquals(false, TurnstileVerifier.isConnected());
        System.assertEquals('', TurnstileVerifier.connectedSiteKey());

        saveKeys(false);
        System.assertEquals(false, TurnstileVerifier.isConnected());
        System.assertEquals('', TurnstileVerifier.connectedSiteKey());
    }

    @IsTest
    static void testConnectedExposesOnlyTheSiteKey() {
        saveKeys(true);
        System.assertEquals(true, TurnstileVerifier.isConnected());
        System.assertEquals(SITE_KEY, TurnstileVerifier.connectedSiteKey());
    }

    @IsTest
    static void testVerifyAcceptsTokenBoundToTheForm() {
        saveKeys(true);
        Form__c form = createForm();
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(String.valueOf(form.Id)));

        Test.startTest();
        TurnstileVerifier.Result result = TurnstileVerifier.verify('good-token', form.Id);
        Test.stopTest();

        System.assertEquals(true, result.success);
        System.assert(TurnstileHttpMock.lastRequestBody.contains('secret=' + SECRET));
        System.assert(TurnstileHttpMock.lastRequestBody.contains('response=good-token'));
    }

    @IsTest
    static void testVerifyAcceptsTheFifteenCharacterId() {
        saveKeys(true);
        Form__c form = createForm();
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(String.valueOf(form.Id).left(15)));

        Test.startTest();
        TurnstileVerifier.Result result = TurnstileVerifier.verify('good-token', form.Id);
        Test.stopTest();

        System.assertEquals(true, result.success, result.message);
    }

    @IsTest
    static void testVerifyRejectsTokenIssuedForAnotherForm() {
        saveKeys(true);
        Form__c form = createForm();
        Form__c other = createForm();
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(String.valueOf(other.Id)));

        Test.startTest();
        TurnstileVerifier.Result result = TurnstileVerifier.verify('good-token', form.Id);
        Test.stopTest();

        System.assertEquals(false, result.success);
        System.assertEquals('Token was issued for a different form.', result.message);
    }

    @IsTest
    static void testVerifyRejectsWhenCdataIsMissingOrNotAnId() {
        saveKeys(true);
        Form__c form = createForm();

        Test.startTest();
        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock(200, '{"success":true,"error-codes":[]}'));
        TurnstileVerifier.Result missing = TurnstileVerifier.verify('t', form.Id);

        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock(200, '{"success":true,"cdata":"not an id"}'));
        TurnstileVerifier.Result garbage = TurnstileVerifier.verify('t', form.Id);
        Test.stopTest();

        System.assertEquals(false, missing.success);
        System.assertEquals('Token was issued for a different form.', missing.message);
        System.assertEquals(false, garbage.success);
        System.assertEquals('Token was issued for a different form.', garbage.message);
    }

    @IsTest
    static void testVerifyFailsClosedOnEveryProblem() {
        saveKeys(true);
        Form__c form = createForm();

        Test.startTest();
        System.assertEquals(false, TurnstileVerifier.verify(null, form.Id).success);
        System.assertEquals(false, TurnstileVerifier.verify('', form.Id).success);
        System.assertEquals(false, TurnstileVerifier.verify('x'.repeat(TurnstileVerifier.MAX_TOKEN_LENGTH + 1), form.Id).success);
        System.assertEquals(0, TurnstileHttpMock.callCount, 'Bad tokens must not reach Cloudflare');

        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('timeout-or-duplicate'));
        TurnstileVerifier.Result spent = TurnstileVerifier.verify('spent', form.Id);
        System.assertEquals(false, spent.success);
        System.assertEquals(new List<String>{ 'timeout-or-duplicate' }, spent.errorCodes);

        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock(500, 'oops'));
        TurnstileVerifier.Result serverError = TurnstileVerifier.verify('t', form.Id);
        System.assertEquals(false, serverError.success);
        System.assertEquals('Cloudflare answered with status 500.', serverError.message);

        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock(200, 'not json'));
        TurnstileVerifier.Result garbled = TurnstileVerifier.verify('t', form.Id);
        System.assertEquals(false, garbled.success);
        System.assertEquals('Unreadable answer from Cloudflare.', garbled.message);

        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock());
        TurnstileVerifier.Result unreachable = TurnstileVerifier.verify('t', form.Id);
        System.assertEquals(false, unreachable.success);
        System.assert(unreachable.message.contains('Could not reach Cloudflare'), unreachable.message);
        Test.stopTest();
    }

    @IsTest
    static void testVerifyFailsWhenNotConnected() {
        Form__c form = createForm();
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(String.valueOf(form.Id)));

        saveKeys(false);

        TurnstileVerifier.Result result = TurnstileVerifier.verify('good-token', form.Id);

        System.assertEquals(false, result.success);
        System.assertEquals('Spam protection is not connected.', result.message);
    }

    @IsTest
    static void testProbeAcceptsAValidSecret() {
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('invalid-input-response'));
        System.assertEquals(true, TurnstileVerifier.probe(SECRET).success);

        // Cloudflare's always-pass test secret answers success for any token.
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(''));
        System.assertEquals(true, TurnstileVerifier.probe(SECRET).success);
    }

    @IsTest
    static void testProbeRejectsAWrongSecret() {
        // This is what Cloudflare really answers for a wrong secret key: HTTP 400 with a JSON body.
        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock(400, '{"error-codes":["invalid-input-secret"],"success":false,"messages":[]}'));
        TurnstileVerifier.Result result = TurnstileVerifier.probe(SECRET);
        System.assertEquals(false, result.success);
        System.assert(result.message.contains('did not accept'), result.message);

        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('invalid-input-secret'));
        System.assertEquals(false, TurnstileVerifier.probe(SECRET).success);
    }

    @IsTest
    static void testSuccessNeedsHttp200() {
        saveKeys(true);
        Form__c form = createForm();
        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock(400, '{"success":true,"cdata":"' + form.Id + '"}'));

        Test.startTest();
        TurnstileVerifier.Result result = TurnstileVerifier.verify('t', form.Id);
        Test.stopTest();

        System.assertEquals(false, result.success, 'A non-200 answer is never a pass, whatever the body says');
    }

    @IsTest
    static void testProbeReportsOtherFailures() {
        System.assertEquals(false, TurnstileVerifier.probe(null).success);
        System.assertEquals(false, TurnstileVerifier.probe('bad key').success);

        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock());
        TurnstileVerifier.Result unreachable = TurnstileVerifier.probe(SECRET);
        System.assertEquals(false, unreachable.success);
        System.assert(unreachable.message.contains('Could not reach Cloudflare'));

        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('internal-error'));
        System.assertEquals(false, TurnstileVerifier.probe(SECRET).success);
    }
}
