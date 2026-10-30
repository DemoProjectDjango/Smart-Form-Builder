@IsTest
private class FormControllerTest {

    private static final String SITE_KEY = '1x00000000000000000000AA';

    private static Form__c createForm() {
        Form__c formRec = new Form__c(
            Name = 'Public Test Form',
            HTML_Template__c = '<script>alert(1)</script><div onclick="bad()">Hello</div><a href="javascript:bad()">Click</a>',
            CSS_Template__c = 'body{background:url(javascript:bad)} .x{width:expression(alert(1)); -moz-binding:url(x)}',
            JS_Template__c = 'eval("bad"); new Function("bad");',
            Field_Dependencies__c = '{"test":"value"}'
        );
        insert formRec;
        return formRec;
    }

    @IsTest
    static void testConstructorWithValidFormId() {
        Form__c formRec = createForm();

        PageReference pageRef = new PageReference('/apex/TestPublicForm');
        pageRef.getParameters().put('id', formRec.Id);
        Test.setCurrentPage(pageRef);

        Test.startTest();
        FormController controller = new FormController();
        Test.stopTest();

        System.assertNotEquals(null, controller.formRec);
        System.assertEquals(formRec.Id, controller.formRec.Id);

        System.assert(!controller.sanitizedHTML.contains('<script'));
        System.assert(!controller.sanitizedHTML.contains('onclick'));
        System.assert(!controller.sanitizedHTML.contains('javascript:'));

        System.assert(controller.sanitizedCSS.contains('url(invalid)'));
        System.assert(controller.sanitizedCSS.contains('/*blocked*/('));
        System.assert(controller.sanitizedCSS.contains('/*blocked*/:'));

        System.assert(controller.sanitizedJS.contains('/*blocked*/eval('));
        System.assert(controller.sanitizedJS.contains('/*blocked*/new Function('));

        String payload = controller.formPayloadJson;
        System.assert(payload.contains(String.valueOf(formRec.Id)));
        System.assert(payload.contains('Hello'));
        System.assert(!payload.contains('<script'));
    }

    @IsTest
    static void testConstructorWithoutId() {
        Test.setCurrentPage(new PageReference('/apex/TestPublicForm'));

        FormController controller = new FormController();

        System.assertEquals(null, controller.formRec);
        System.assertEquals('', controller.sanitizedHTML);
        System.assertEquals('', controller.sanitizedCSS);
        System.assertEquals('', controller.sanitizedJS);
        System.assertEquals('{}', controller.formPayloadJson);
    }

    @IsTest
    static void testConstructorWithInvalidId() {
        PageReference pageRef = new PageReference('/apex/TestPublicForm');
        pageRef.getParameters().put('id', 'invalidId');
        Test.setCurrentPage(pageRef);

        FormController controller = new FormController();

        System.assertEquals(null, controller.formRec);
        System.assertEquals('{}', controller.formPayloadJson);
    }

    /**
     * @description Builds a least-privilege user carrying only the FormBuilder_Guest
     *              permission set — the same grant the Site guest user receives. Setup
     *              DML is wrapped in System.runAs() to avoid MIXED_DML_OPERATION with the
     *              later Form__c / Form_Submission__c DML.
     */
    private static User buildGuestLikeUser() {
        User u;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
            u = new User(
                ProfileId         = p.Id,
                LastName          = 'GuestLike',
                Email             = 'guestlike_fc@example.com',
                Username          = 'guestlike_fc+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
                Alias             = 'gstlk',
                TimeZoneSidKey    = 'America/Los_Angeles',
                LocaleSidKey      = 'en_US',
                EmailEncodingKey  = 'UTF-8',
                LanguageLocaleKey = 'en_US'
            );
            insert u;

            PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'FormBuilder_Guest' LIMIT 1];
            insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        }
        return u;
    }

    @IsTest
    static void testSaveSubmissionSuccess() {
        // saveSubmission inserts in USER_MODE, so it enforces the running user's FLS.
        // Run it as a user holding only FormBuilder_Guest (the same permission set the
        // Site guest user gets) so the test proves that permission set is sufficient
        // and doesn't silently pass on an admin's broad access. Running as the default
        // admin here is what caused the packaging failure: the packaging user has no
        // field-Edit on the packaged fields, so USER_MODE rejected the insert.
        User guestLikeUser = buildGuestLikeUser();

        Form__c formRec = createForm();

        Test.startTest();
        String result;
        System.runAs(guestLikeUser) {
            result = FormController.saveSubmission(
                '{"FirstName":"Test","LastName":"User"}',
                formRec.Id
            );
        }
        Test.stopTest();

        System.assertEquals(
            'Success! Submission saved.',
            result,
            'Guest submission failed under USER_MODE. Confirm FormBuilder_Guest grants '
            + 'Create on Form_Submission__c and Edit on Payload_JSON__c/Form__c.'
        );

        Form_Submission__c submission = [
            SELECT Id, Form__c, Payload_JSON__c
            FROM Form_Submission__c
            WHERE Form__c = :formRec.Id
            LIMIT 1
        ];

        System.assertEquals(formRec.Id, submission.Form__c);
        System.assertEquals('{"FirstName":"Test","LastName":"User"}', submission.Payload_JSON__c);
    }

    @IsTest
    static void testSaveSubmissionMissingFormId() {
        String result = FormController.saveSubmission('{"test":"value"}', null);

        System.assertEquals('Form ID missing', result);
    }

    @IsTest
    static void testSaveSubmissionMissingPayload() {
        Form__c formRec = createForm();

        String result = FormController.saveSubmission('', formRec.Id);

        System.assertEquals('Payload is missing', result);
    }

    // ── Spam protection ──────────────────────────────────────────────────────

    private static void connectSpamProtection() {
        insert new Captcha_Settings__c(
            Site_Key__c = SITE_KEY,
            Secret_Key__c = '1x0000000000000000000000000000000AA',
            Connected__c = true
        );
    }

    private static Form__c createProtectedForm() {
        Form__c formRec = new Form__c(Name = 'Protected Form', Captcha_Enabled__c = true);
        insert formRec;
        return formRec;
    }

    private static List<Form_Submission__c> storedSubmissions(Id formId) {
        return [SELECT Id, Payload_JSON__c FROM Form_Submission__c WHERE Form__c = :formId];
    }

    @IsTest
    static void testFilledHoneypotIsDroppedWithoutSavingAnything() {
        Form__c formRec = createForm();

        String result = FormController.saveSubmission('{"FirstName":"Bot","hp_website":"http://spam.example"}', formRec.Id);

        System.assertEquals('Success! Submission saved.', result, 'A bot must not learn that it was caught');
        System.assertEquals(0, storedSubmissions(formRec.Id).size());
    }

    @IsTest
    static void testHoneypotAndTokenKeysAreNeverStored() {
        User guestLikeUser = buildGuestLikeUser();
        Form__c formRec = createForm();

        String result;
        System.runAs(guestLikeUser) {
            result = FormController.saveSubmission('{"FirstName":"Ann","hp_website":"","_captcha":"tok"}', formRec.Id);
        }

        System.assertEquals('Success! Submission saved.', result);
        List<Form_Submission__c> rows = storedSubmissions(formRec.Id);
        System.assertEquals(1, rows.size());
        System.assertEquals('{"FirstName":"Ann"}', rows[0].Payload_JSON__c);
    }

    @IsTest
    static void testRateCapStopsAFloodOnOneForm() {
        User guestLikeUser = buildGuestLikeUser();
        Form__c formRec = createForm();
        Form__c otherForm = createForm();
        FormController.maxSubmissionsPerMinute = 2;
        insert new List<Form_Submission__c>{
            new Form_Submission__c(Form__c = formRec.Id, Payload_JSON__c = '{"a":"1"}'),
            new Form_Submission__c(Form__c = formRec.Id, Payload_JSON__c = '{"a":"2"}')
        };

        String blocked;
        String elsewhere;
        System.runAs(guestLikeUser) {
            blocked = FormController.saveSubmission('{"a":"3"}', formRec.Id);
            elsewhere = FormController.saveSubmission('{"a":"4"}', otherForm.Id);
        }

        System.assertEquals('This form is receiving a lot of submissions right now. Please try again in a minute.', blocked);
        System.assertEquals(2, storedSubmissions(formRec.Id).size());
        System.assertEquals('Success! Submission saved.', elsewhere, 'The cap is per form');
    }

    @IsTest
    static void testProtectedFormAcceptsAVerifiedToken() {
        connectSpamProtection();
        User guestLikeUser = buildGuestLikeUser();
        Form__c formRec = createProtectedForm();
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(String.valueOf(formRec.Id)));

        Test.startTest();
        String result;
        System.runAs(guestLikeUser) {
            result = FormController.saveSubmission('{"FirstName":"Ann","_captcha":"good-token"}', formRec.Id);
        }
        Test.stopTest();

        System.assertEquals('Success! Submission saved.', result);
        List<Form_Submission__c> rows = storedSubmissions(formRec.Id);
        System.assertEquals(1, rows.size());
        System.assertEquals('{"FirstName":"Ann"}', rows[0].Payload_JSON__c);
        System.assert(TurnstileHttpMock.lastRequestBody.contains('response=good-token'));
    }

    @IsTest
    static void testProtectedFormRejectsEverythingThatIsNotVerified() {
        connectSpamProtection();
        Form__c formRec = createProtectedForm();
        Form__c otherForm = createProtectedForm();
        String failed = 'The spam check failed. Please reload the page and try again.';

        Test.startTest();
        // No token at all: Cloudflare is never asked.
        System.assertEquals(failed, FormController.saveSubmission('{"FirstName":"Bot"}', formRec.Id));
        System.assertEquals(0, TurnstileHttpMock.callCount);

        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('timeout-or-duplicate'));
        System.assertEquals(failed, FormController.saveSubmission('{"FirstName":"Bot","_captcha":"replayed"}', formRec.Id));

        // A token that Cloudflare issued for a different form.
        Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.accepted(String.valueOf(otherForm.Id)));
        System.assertEquals(failed, FormController.saveSubmission('{"FirstName":"Bot","_captcha":"borrowed"}', formRec.Id));

        // Cloudflare unreachable: fail closed.
        Test.setMock(HttpCalloutMock.class, new TurnstileHttpMock());
        System.assertEquals(failed, FormController.saveSubmission('{"FirstName":"Bot","_captcha":"t"}', formRec.Id));
        Test.stopTest();

        System.assertEquals(0, storedSubmissions(formRec.Id).size());
    }

    @IsTest
    static void testProtectedFormRejectsEverythingWhenKeysWereRemoved() {
        Form__c formRec = createProtectedForm();

        String result = FormController.saveSubmission('{"FirstName":"Ann","_captcha":"good-token"}', formRec.Id);

        System.assertEquals('The spam check failed. Please reload the page and try again.', result);
        System.assertEquals(0, storedSubmissions(formRec.Id).size());
    }

    @IsTest
    static void testProtectedFormRejectsUnreadablePayloads() {
        connectSpamProtection();
        Form__c formRec = createProtectedForm();

        System.assertEquals('We could not save your submission. Please try again later.', FormController.saveSubmission('not json', formRec.Id));
        System.assertEquals('We could not save your submission. Please try again later.', FormController.saveSubmission('null', formRec.Id));
        System.assertEquals(0, storedSubmissions(formRec.Id).size());
    }

    @IsTest
    static void testUnprotectedFormsKeepWorkingExactlyAsBefore() {
        connectSpamProtection();
        User guestLikeUser = buildGuestLikeUser();
        Form__c formRec = createForm();

        String result;
        System.runAs(guestLikeUser) {
            result = FormController.saveSubmission('{"FirstName":"Test","LastName":"User"}', formRec.Id);
        }

        System.assertEquals('Success! Submission saved.', result);
        System.assertEquals('{"FirstName":"Test","LastName":"User"}', storedSubmissions(formRec.Id)[0].Payload_JSON__c);
        System.assertEquals(0, TurnstileHttpMock.callCount);
    }

    @IsTest
    static void testPageGetsTheSiteKeyOnlyForProtectedConnectedForms() {
        Form__c plain = createForm();
        Form__c protectedForm = createProtectedForm();

        Test.setCurrentPage(new PageReference('/apex/PublicForm?id=' + protectedForm.Id));
        ApexPages.currentPage().getParameters().put('id', protectedForm.Id);
        System.assertEquals('', new FormController().captchaSiteKey, 'Not connected yet');
        System.assertEquals(false, new FormController().showCaptcha);

        connectSpamProtection();
        FormController controller = new FormController();
        System.assertEquals(SITE_KEY, controller.captchaSiteKey);
        System.assertEquals(true, controller.showCaptcha, 'The widget script loads only when it will be used');
        System.assert(controller.formPayloadJson.contains('"captchaSiteKey":"' + SITE_KEY + '"'));
        System.assert(!controller.formPayloadJson.contains('Secret'));

        ApexPages.currentPage().getParameters().put('id', plain.Id);
        FormController plainController = new FormController();
        System.assertEquals('', plainController.captchaSiteKey);
        System.assertEquals(false, plainController.showCaptcha);
        System.assert(plainController.formPayloadJson.contains('"captchaSiteKey":""'));
    }

    @IsTest
    static void testSanitizeMethodsDirectly() {
        String html = FormController.sanitizeHtml(
            '<script>alert(1)</script><iframe src="x"></iframe><div onclick="bad()">Safe</div><a href="data:text/html,bad">Link</a>'
        );
        System.assert(!html.contains('<script'));
        System.assert(!html.contains('<iframe'));
        System.assert(!html.contains('onclick'));
        System.assert(!html.contains('data:'));

        String css = FormController.sanitizeCss(
            'body{background:url(javascript:bad)} div{width:expression(alert(1)); -moz-binding:url(x)}'
        );
        System.assert(css.contains('url(invalid)'));
        System.assert(css.contains('/*blocked*/('));
        System.assert(css.contains('/*blocked*/:'));

        String js = FormController.sanitizeJs(
            'eval("bad"); new Function("bad");'
        );
        System.assert(js.contains('/*blocked*/eval('));
        System.assert(js.contains('/*blocked*/new Function('));

        System.assertEquals('', FormController.sanitizeHtml(null));
        System.assertEquals('', FormController.sanitizeCss(null));
        System.assertEquals('', FormController.sanitizeJs(null));
    }
}