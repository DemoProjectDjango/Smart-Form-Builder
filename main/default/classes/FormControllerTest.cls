@IsTest
private class FormControllerTest {

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