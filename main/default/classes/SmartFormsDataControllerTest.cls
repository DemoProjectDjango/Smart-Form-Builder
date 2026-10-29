@IsTest
private class SmartFormsDataControllerTest {

    private static final String ADMIN_ALIAS = 'sfdadm';
    private static final String PLAIN_ALIAS = 'sfdpln';

    private static User makeUser(Profile p, String alias) {
        return new User(
            ProfileId = p.Id,
            LastName = 'SfData' + alias,
            Email = 'sfdata_' + alias + '@example.com',
            Username = 'sfdata_' + alias + '+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
            Alias = alias,
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
    }

    @TestSetup
    static void setup() {
        Profile adminProfile = [
            SELECT Id
            FROM Profile
            WHERE PermissionsModifyAllData = true
            LIMIT 1
        ];
        Profile plainProfile = [
            SELECT Id
            FROM Profile
            WHERE PermissionsModifyAllData = false AND UserType = 'Standard'
            LIMIT 1
        ];
        User admin = makeUser(adminProfile, ADMIN_ALIAS);
        insert new List<User>{ admin, makeUser(plainProfile, PLAIN_ALIAS) };

        PermissionSet builderSet = [
            SELECT Id
            FROM PermissionSet
            WHERE Name = 'FormBuilder_Admin'
            LIMIT 1
        ];
        insert new PermissionSetAssignment(AssigneeId = admin.Id, PermissionSetId = builderSet.Id);

        System.runAs(admin) {
            Form__c form = new Form__c(
                Name = 'Website enquiry',
                Object_API_Name__c = 'Account',
                Field_Config__c = '[{"apiName":"Name"}]',
                Version__c = 3,
                Status__c = 'Active',
                Active__c = true,
                Is_Public__c = true
            );
            insert form;

            Form_Submission__c saved = new Form_Submission__c(
                Form__c = form.Id,
                Payload_JSON__c = '{"Name":"Acme"}'
            );
            Form_Submission__c failed = new Form_Submission__c(
                Form__c = form.Id,
                Payload_JSON__c = 'invalid-json'
            );
            insert new List<Form_Submission__c>{ saved, failed };

            // The trigger processes submissions on insert; pin the outcome so assertions are deterministic.
            saved.Error_Message__c = null;
            failed.Error_Message__c = 'Required fields are missing: [Subject]';
            update new List<Form_Submission__c>{ saved, failed };

            // Drop anything the trigger tracked so the related-record assertions are deterministic.
            delete [SELECT Id FROM Form_Submission_Record__c LIMIT 100];

            Account linked = new Account(Name = 'Linked account');
            insert linked;
            insert new Form_Submission_Record__c(
                Form_Submission__c = saved.Id,
                Object_API_Name__c = 'Account',
                Record_Id__c = linked.Id,
                Action__c = 'Created'
            );
        }
    }

    private static User runAs(String alias) {
        return [SELECT Id FROM User WHERE Alias = :alias LIMIT 1];
    }

    private static Form_Submission__c submissionWithError(Boolean withError) {
        for (Form_Submission__c s : [SELECT Id, Error_Message__c FROM Form_Submission__c LIMIT 10]) {
            if (String.isNotBlank(s.Error_Message__c) == withError) {
                return s;
            }
        }
        return null;
    }

    @IsTest
    static void getFormsReturnsSummaryWithoutFieldConfig() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Test.startTest();
            List<SmartFormsDataController.FormSummary> forms = SmartFormsDataController.getForms();
            Test.stopTest();

            System.assertEquals(1, forms.size(), 'One form was created in setup');
            SmartFormsDataController.FormSummary f = forms[0];
            System.assertEquals('Website enquiry', f.name);
            System.assertEquals('Account', f.objectApiName);
            System.assertEquals('Account', f.objectLabel, 'Label comes from the object describe');
            System.assertEquals(3, f.version);
            System.assertEquals('Active', f.status);
            System.assertEquals(true, f.isActive);
            System.assertEquals(true, f.isPublic);
            System.assertEquals(null, f.fieldConfig, 'List rows do not carry the field configuration');
        }
    }

    @IsTest
    static void getFormDetailReturnsFieldConfig() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Form__c form = [SELECT Id FROM Form__c LIMIT 1];

            Test.startTest();
            SmartFormsDataController.FormSummary detail = SmartFormsDataController.getFormDetail(form.Id);
            Test.stopTest();

            System.assertNotEquals(null, detail);
            System.assertEquals('[{"apiName":"Name"}]', detail.fieldConfig);
        }
    }

    @IsTest
    static void getFormDetailHandlesBlankAndMissingIds() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Form__c form = [SELECT Id FROM Form__c LIMIT 1];
            Id missing = form.Id;
            delete form;

            System.assertEquals(null, SmartFormsDataController.getFormDetail(null));
            System.assertEquals(null, SmartFormsDataController.getFormDetail(missing));
        }
    }

    @IsTest
    static void unknownObjectApiNameFallsBackToApiNameAsLabel() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Form__c form = [SELECT Id FROM Form__c LIMIT 1];
            form.Object_API_Name__c = 'Not_An_Object__c';
            update form;

            SmartFormsDataController.FormSummary detail = SmartFormsDataController.getFormDetail(form.Id);

            System.assertEquals('Not_An_Object__c', detail.objectLabel);
        }
    }

    @IsTest
    static void blankObjectApiNameGivesBlankLabel() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Form__c form = [SELECT Id FROM Form__c LIMIT 1];
            form.Object_API_Name__c = '';
            update form;

            SmartFormsDataController.FormSummary detail = SmartFormsDataController.getFormDetail(form.Id);

            System.assertEquals('', detail.objectLabel);
        }
    }

    @IsTest
    static void getSubmissionsFlagsFailuresAndLinksRecords() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Test.startTest();
            List<SmartFormsDataController.SubmissionSummary> all = SmartFormsDataController.getSubmissions();
            Test.stopTest();

            System.assertEquals(2, all.size());
            SmartFormsDataController.SubmissionSummary ok;
            SmartFormsDataController.SubmissionSummary err;
            for (SmartFormsDataController.SubmissionSummary s : all) {
                if (s.hasError) {
                    err = s;
                } else {
                    ok = s;
                }
            }
            System.assertNotEquals(null, ok, 'One submission succeeded');
            System.assertNotEquals(null, err, 'One submission failed');
            System.assertEquals('Website enquiry', ok.formName);
            System.assertNotEquals(null, ok.firstRecord, 'Saved submission links to the record it created');
            System.assertEquals('Created', ok.firstRecord.action);
            System.assertEquals('Account', ok.firstRecord.objectLabel);
            System.assertEquals(null, err.firstRecord);
        }
    }

    @IsTest
    static void getSubmissionDetailReturnsPayloadErrorAndRecords() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Form_Submission__c saved = submissionWithError(false);
            Form_Submission__c failed = submissionWithError(true);

            Test.startTest();
            SmartFormsDataController.SubmissionDetail savedDetail = SmartFormsDataController.getSubmissionDetail(saved.Id);
            SmartFormsDataController.SubmissionDetail failedDetail = SmartFormsDataController.getSubmissionDetail(failed.Id);
            Test.stopTest();

            System.assertEquals('{"Name":"Acme"}', savedDetail.payloadJson);
            System.assertEquals(false, savedDetail.summary.hasError);
            System.assertEquals(1, savedDetail.records.size());
            Account linked = [SELECT Id FROM Account WHERE Name = 'Linked account' LIMIT 1];
            System.assertEquals(String.valueOf(linked.Id), savedDetail.records[0].recordId);

            System.assertEquals(true, failedDetail.summary.hasError);
            System.assertEquals('Required fields are missing: [Subject]', failedDetail.errorMessage);
            System.assertEquals(0, failedDetail.records.size());
        }
    }

    @IsTest
    static void getSubmissionDetailHandlesBlankAndMissingIds() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            Form_Submission__c failed = submissionWithError(true);
            Id missing = failed.Id;
            delete failed;

            System.assertEquals(null, SmartFormsDataController.getSubmissionDetail(null));
            System.assertEquals(null, SmartFormsDataController.getSubmissionDetail(missing));
        }
    }

    @IsTest
    static void getErrorCountCountsOnlyFailedSubmissions() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            System.assertEquals(1, SmartFormsDataController.getErrorCount());
        }
    }

    @IsTest
    static void getPublicFormBaseUrlReturnsConfiguredValue() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            insert new Form_Builder_Settings__c(
                SetupOwnerId = UserInfo.getOrganizationId(),
                Public_Form_Base_Url__c = 'https://example.my.salesforce-sites.com/?id='
            );

            System.assertEquals(
                'https://example.my.salesforce-sites.com/?id=',
                SmartFormsDataController.getPublicFormBaseUrl()
            );
        }
    }

    @IsTest
    static void usersWithoutAccessNeverReceiveData() {
        Id formId = [SELECT Id FROM Form__c LIMIT 1].Id;
        Id submissionId = submissionWithError(true).Id;

        System.runAs(runAs(PLAIN_ALIAS)) {
            // Depending on the profile the user either sees nothing or is told access is missing; never data.
            Integer forms = 0;
            Integer submissions = 0;
            Integer errors = 0;
            Boolean denied = false;
            try {
                forms = SmartFormsDataController.getForms().size();
                submissions = SmartFormsDataController.getSubmissions().size();
                errors = SmartFormsDataController.getErrorCount();
                System.assertEquals(null, SmartFormsDataController.getFormDetail(formId));
                System.assertEquals(null, SmartFormsDataController.getSubmissionDetail(submissionId));
            } catch (AuraHandledException e) {
                denied = true;
                System.assert(e.getMessage().contains('FormBuilder_Admin'), 'The message tells the user how to get access');
            }
            System.assert(denied || (forms + submissions + errors == 0), 'A user without access must not receive data');
        }
    }
}
