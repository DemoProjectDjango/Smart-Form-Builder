@IsTest
private class FormEditorMetadataServiceTest {

    // Required by PMD: ApexUnitTestClassShouldHaveRunAs
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
            LastName = 'MetaSvc',
            Email = 'meta_svc_test@example.com',
            Username = 'meta_svc_test+' + DateTime.now().getTime() + '@example.com',
            Alias = 'msvc',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;
    }

    private static User runAsUser() {
        return [SELECT Id FROM User WHERE Alias = 'msvc' LIMIT 1];
    }

    // -----------------------------
    // fetchObjectOptions
    // -----------------------------

    @IsTest
    static void fetchObjectOptionsReturnsList() {
        System.runAs(runAsUser()) {
            Test.startTest();
            List<Map<String, String>> options =
                FormEditorMetadataService.fetchObjectOptions();
            Test.stopTest();

            System.assertNotEquals(null, options);
            System.assertEquals(true, options.size() > 0);

            Map<String, String> first = options[0];
            System.assertEquals(true, first.containsKey('label'));
            System.assertEquals(true, first.containsKey('name'));
        }
    }

    // -----------------------------
    // fetchFieldsForObject – guards
    // -----------------------------

    @IsTest
    static void fetchFieldsReturnsEmptyWhenBlank() {
        System.runAs(runAsUser()) {
            Test.startTest();
            List<Map<String, Object>> fields =
                FormEditorMetadataService.fetchFieldsForObject('');
            Test.stopTest();

            System.assertNotEquals(null, fields);
            System.assertEquals(0, fields.size());
        }
    }

    @IsTest
    static void fetchFieldsReturnsEmptyForInvalidObject() {
        System.runAs(runAsUser()) {
            Test.startTest();
            List<Map<String, Object>> fields =
                FormEditorMetadataService.fetchFieldsForObject('DoesNotExist__c');
            Test.stopTest();

            System.assertNotEquals(null, fields);
            System.assertEquals(0, fields.size());
        }
    }

    // -----------------------------
    // fetchFieldsForObject – happy path
    // -----------------------------

    @IsTest
    static void fetchFieldsReturnsDescriptorsForAccount() {
        System.runAs(runAsUser()) {
            Test.startTest();
            List<Map<String, Object>> fields =
                FormEditorMetadataService.fetchFieldsForObject('Account');
            Test.stopTest();

            System.assertNotEquals(null, fields);
            System.assertEquals(true, fields.size() > 0);

            Map<String, Object> field = fields[0];

            System.assertEquals(true, field.containsKey('label'));
            System.assertEquals(true, field.containsKey('name'));
            System.assertEquals(true, field.containsKey('type'));
            System.assertEquals(true, field.containsKey('picklistValues'));
            System.assertEquals(true, field.containsKey('required'));
        }
    }
}