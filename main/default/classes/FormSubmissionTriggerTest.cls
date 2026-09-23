@IsTest
private class FormSubmissionTriggerTest {

    @TestSetup
    static void setup() {
        Profile p = [
            SELECT Id
            FROM Profile
            WHERE PermissionsModifyAllData = true
            LIMIT 1
        ];

        User u = new User(
            ProfileId = p.Id,
            LastName = 'Fst',
            Email = 'fst_test@example.com',
            Username = 'fst_test+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
            Alias = 'fstst',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;
    }

    private static User getRunAsUser() {
        return [SELECT Id FROM User WHERE Alias = 'fstst' LIMIT 1];
    }

    private static Form__c createForm(String name) {
        return new Form__c(
            Name = name,
            HTML_Template__c = '<div/>',
            CSS_Template__c = '',
            JS_Template__c = '',
            Field_Dependencies__c = '{}',
            Object_API_Name__c = 'Account',
            Field_Config__c = '{}',
            Version__c = 1
        );
    }

    @IsTest
    static void testAfterInsertInvalidPayloadSetsErrorMessage() {
        System.runAs(getRunAsUser()) {
            Form__c f = createForm('Form_Invalid_' + DateTime.now().getTime());
            insert f;

            Form_Submission__c submission = new Form_Submission__c(
                Form__c = f.Id,
                Payload_JSON__c = 'invalid-json'
            );

            Test.startTest();
            insert submission;
            Test.stopTest();

            Form_Submission__c stored = [
                SELECT Error_Message__c
                FROM Form_Submission__c
                WHERE Id = :submission.Id
            ];

            System.assert(
                String.isNotBlank(stored.Error_Message__c),
                'Error message must be populated for invalid JSON'
            );
        }
    }
}