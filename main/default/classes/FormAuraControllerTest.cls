@IsTest
private class FormAuraControllerTest {

    private static final String TEST_USERNAME_PREFIX = 'fbtest';

    private static User getFormBuilderUser() {
        return [
            SELECT Id
            FROM User
            WHERE Username LIKE :(TEST_USERNAME_PREFIX + '%')
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];
    }

    @TestSetup
    static void setupData() {
        // Setup-object DML isolated in its own runAs to avoid MIXED_DML_OPERATION
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Profile adminProfile = [
                SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1
            ];
            String uniqueName = TEST_USERNAME_PREFIX
                + Crypto.getRandomInteger()
                + '@example.com.invalid';

            User u = new User(
                Alias             = 'fbtst',
                Email             = 'fbtest@example.com.invalid',
                EmailEncodingKey  = 'UTF-8',
                LastName          = 'Tester',
                LanguageLocaleKey = 'en_US',
                LocaleSidKey      = 'en_US',
                ProfileId         = adminProfile.Id,
                TimeZoneSidKey    = 'America/Los_Angeles',
                Username          = uniqueName
            );
            insert u;

            PermissionSet ps = [
                SELECT Id FROM PermissionSet WHERE Name = 'FormBuilder_Admin' LIMIT 1
            ];
            insert new PermissionSetAssignment(
                AssigneeId       = u.Id,
                PermissionSetId  = ps.Id
            );
        }

        // Non-setup DML — SYSTEM_MODE insert doesn't require FLS
        Form__c existingForm = new Form__c(
            CSS_Template__c  = 'body{}',
            JS_Template__c   = 'console.log("old");'
        );
        Database.insert(existingForm, AccessLevel.SYSTEM_MODE);
    }

    @IsTest
    static void testCreateForm() {

        User u = getFormBuilderUser();

        String reqJson = JSON.serialize(new Map<String, Object>{
            'name' => 'New Form',
            'html' => '<script>alert(1)</script><div>Hello</div>',
            'css' => 'body{background:url(javascript:test)}',
            'js' => 'eval("alert(1)")',
            'fieldDependenciesJson' => '{"a":"b"}',
            'objectApiName' => 'Account',
            'fieldConfigJson' => '{"field":"Name"}'
        });

        Id formId;
        System.runAs(u) {
            Test.startTest();
            formId = FormAuraController.saveFormTemplate(reqJson);
            Test.stopTest();
        }

        System.assertNotEquals(null, formId, 'Created Form Id should not be null.');

        // Plain SOQL runs in system mode (FLS not enforced), so verification
        // queries are safe to run outside the runAs block.
        Form__c createdForm = [
            SELECT Id,
                   Name
            FROM Form__c
            WHERE Id = :formId
        ];

        System.assertEquals('New Form', createdForm.Name);
    }

    @IsTest
    static void testUpdateForm() {

        User u = getFormBuilderUser();

        Form__c existingForm = [
            SELECT Id
            FROM Form__c
            LIMIT 1
        ];

        String reqJson = JSON.serialize(new Map<String, Object>{
            'formId' => existingForm.Id,
            'name' => 'Updated Form',
            'html' => '<div>Updated</div>',
            'css' => '.test{}',
            'js' => 'console.log("updated");',
            'fieldDependenciesJson' => '{}',
            'objectApiName' => 'Contact',
            'fieldConfigJson' => '{}'
        });

        Id returnedId;
        System.runAs(u) {
            Test.startTest();
            returnedId = FormAuraController.saveFormTemplate(reqJson);
            Test.stopTest();
        }

        System.assertEquals(existingForm.Id, returnedId);

        Form__c updatedForm = [
            SELECT Name
            FROM Form__c
            WHERE Id = :existingForm.Id
        ];

        System.assertEquals('Updated Form', updatedForm.Name);
    }

    @IsTest
    static void testGetFormTemplates() {

        User u = getFormBuilderUser();

        List<Map<String,String>> templates;
        System.runAs(u) {
            Test.startTest();
            templates = FormAuraController.getFormTemplates();
            Test.stopTest();
        }

        System.assert(templates.size() > 0, 'Expected at least one form template.');
        System.assert(templates[0].containsKey('label'), 'Template option should contain label.');
        System.assert(templates[0].containsKey('value'), 'Template option should contain value.');
    }

    @IsTest
    static void testMissingNameException() {

        User u = getFormBuilderUser();

        String reqJson = JSON.serialize(new Map<String,Object>{
            'html' => '<div>No Name</div>'
        });

        Boolean exceptionThrown = false;

        System.runAs(u) {
            try {
                FormAuraController.saveFormTemplate(reqJson);
            } catch (AuraHandledException e) {
                exceptionThrown = true;
            }
        }
        System.assertEquals(
            true,
            exceptionThrown,
            'Expected AuraHandledException when form name is missing.'
        );
    }

    @IsTest
    static void testFormNotFoundException() {

        User u = getFormBuilderUser();

        // Non-setup DML performed as the running admin (no FLS needed for plain insert).
        Form__c tempForm = new Form__c(
            Name = 'Temporary Form For Delete'
        );
        // Explicit SYSTEM_MODE so this setup insert never enforces FLS,
        // regardless of which user context the test runs in.
        Database.insert(tempForm, AccessLevel.SYSTEM_MODE);

        Id deletedFormId = tempForm.Id;
        Database.delete(tempForm, AccessLevel.SYSTEM_MODE);

        String reqJson = JSON.serialize(new Map<String,Object>{
            'formId' => deletedFormId,
            'name' => 'Test'
        });

        Boolean exceptionThrown = false;

        System.runAs(u) {
            try {
                FormAuraController.saveFormTemplate(reqJson);
            } catch (AuraHandledException e) {
                exceptionThrown = true;
            }
        }
        System.assertEquals(
            true,
            exceptionThrown,
            'Expected AuraHandledException when form is not found.'
        );
    }

    @IsTest
    static void testVersionCalculationForDuplicateName() {

        User u = getFormBuilderUser();

        Form__c existing = new Form__c(
            Name = 'Version Test'
        );
        Database.insert(existing, AccessLevel.SYSTEM_MODE);

        String reqJson = JSON.serialize(new Map<String,Object>{
            'name' => 'Version Test',
            'html' => '<div>Test</div>'
        });

        Id newId;
        System.runAs(u) {
            Test.startTest();
            newId = FormAuraController.saveFormTemplate(reqJson);
            Test.stopTest();
        }

        Assert.isNotNull(newId, 'saveFormTemplate should return the new Form__c Id.');

        Form__c created = [
            SELECT Id, Name, Version__c
            FROM Form__c
            WHERE Id = :newId
            WITH SYSTEM_MODE
            LIMIT 1
        ];

        Assert.areEqual(
            'Version Test', created.Name,
            'New form should retain the requested name.'
        );
        Assert.areNotEqual(
            existing.Id, created.Id,
            'A duplicate name should create a new record, not update the existing one.'
        );
    }
}