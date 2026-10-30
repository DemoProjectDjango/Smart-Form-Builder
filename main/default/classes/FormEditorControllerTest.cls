@IsTest
private class FormEditorControllerTest {

    // -----------------------------
    // Test data + user helpers
    // -----------------------------

    private static Form__c makeForm(String name) {
        Form__c f = new Form__c();
        f.Name = name;
        f.HTML_Template__c = '<div>html</div>';
        f.CSS_Template__c = 'body{margin:0;}';
        f.JS_Template__c = 'console.log("x");';
        f.Field_Dependencies__c = '{"deps":[{"a":"b"}]}';
        f.Version__c = 1;
        f.Object_API_Name__c = 'Account';
        f.Field_Config__c = '{"fields":[{"api":"Name"}]}';
        return f;
    }

    private static String getFormObjectApiName() {
        return Form__c.SObjectType.getDescribe(SObjectDescribeOptions.DEFERRED).getName();
    }

    private static String getFieldPermissionName(Schema.SObjectField fieldRef) {
        String objectApiName = getFormObjectApiName();
        String fieldApiName = fieldRef.getDescribe().getName();
        return objectApiName + '.' + fieldApiName;
    }

    private static FieldPermissions makeFieldPermission(
        Id permissionSetId,
        Schema.SObjectField fieldRef,
        Boolean canEdit
    ) {
        return new FieldPermissions(
            ParentId = permissionSetId,
            SObjectType = getFormObjectApiName(),
            Field = getFieldPermissionName(fieldRef),
            PermissionsRead = true,
            PermissionsEdit = canEdit
        );
    }

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
            LastName = 'FeCtrl',
            Email = 'formeditorctrltest@example.com',
            Username = 'formeditorctrltest+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
            Alias = 'fect',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;

        PermissionSet ps = new PermissionSet(
            Name = 'FormEditorTestAccess',
            Label = 'Form Editor Test Access'
        );
        insert ps;

        insert new ObjectPermissions(
            ParentId = ps.Id,
            SObjectType = getFormObjectApiName(),
            PermissionsCreate = true,
            PermissionsRead = true,
            PermissionsEdit = true,
            PermissionsDelete = true
        );

        List<FieldPermissions> fieldPerms = new List<FieldPermissions>{
            makeFieldPermission(ps.Id, Form__c.HTML_Template__c, true),
            makeFieldPermission(ps.Id, Form__c.CSS_Template__c, true),
            makeFieldPermission(ps.Id, Form__c.JS_Template__c, true),
            makeFieldPermission(ps.Id, Form__c.Field_Dependencies__c, true),
            makeFieldPermission(ps.Id, Form__c.Version__c, true),
            makeFieldPermission(ps.Id, Form__c.Object_API_Name__c, true),
            makeFieldPermission(ps.Id, Form__c.Field_Config__c, true)
        };

        insert fieldPerms;

        insert new PermissionSetAssignment(
            AssigneeId = u.Id,
            PermissionSetId = ps.Id
        );

        System.runAs(u) {
            insert makeForm('A Form');
            insert makeForm('B Form');
        }
    }

    private static User getRunAsUser() {
        return [
            SELECT Id
            FROM User
            WHERE Alias = 'fect'
            LIMIT 1
        ];
    }

    // -----------------------------
    // getFormTemplates
    // -----------------------------

    @IsTest
    static void getFormTemplatesReturnsOptions() {
        System.runAs(getRunAsUser()) {
            Test.startTest();
            List<Map<String, String>> opts = FormEditorController.getFormTemplates();
            Test.stopTest();

            System.assertNotEquals(null, opts, 'Options list should not be null.');
            System.assertEquals(true, opts.size() >= 2, 'Expected at least two form templates.');

            System.assertEquals(true, opts[0].containsKey('label'), 'Option should contain label.');
            System.assertEquals(true, opts[0].containsKey('value'), 'Option should contain value.');

            Integer idxA = -1;
            Integer idxB = -1;

            for (Integer i = 0; i < opts.size(); i++) {
                String label = opts[i].get('label');

                if (label == 'A Form' && idxA == -1) {
                    idxA = i;
                }

                if (label == 'B Form' && idxB == -1) {
                    idxB = i;
                }
            }

            System.assertEquals(true, idxA != -1 && idxB != -1, 'A Form and B Form should both exist.');
            System.assertEquals(true, idxA < idxB, 'A Form should appear before B Form.');
        }
    }

    // -----------------------------
    // getFormData
    // -----------------------------

    @IsTest
    static void getFormDataReturnsMapForValidId() {
        System.runAs(getRunAsUser()) {
            Form__c f = [
                SELECT Id
                FROM Form__c
                WHERE Name = 'A Form'
                LIMIT 1
            ];

            Test.startTest();
            Map<String, Object> data = FormEditorController.getFormData(f.Id);
            Test.stopTest();

            System.assertNotEquals(null, data, 'Form data should not be null.');
            System.assertEquals(String.valueOf(f.Id), String.valueOf(data.get('id')));
            System.assertEquals('A Form', (String) data.get('name'));

            System.assertEquals(true, data.containsKey('html'));
            System.assertEquals(true, data.containsKey('css'));
            System.assertEquals(true, data.containsKey('js'));
            System.assertEquals(true, data.containsKey('dependencies'));
            System.assertEquals(true, data.containsKey('version'));
            System.assertEquals(true, data.containsKey('objectApiName'));
            System.assertEquals(true, data.containsKey('fieldConfig'));
            System.assertEquals(true, data.containsKey('captchaEnabled'));
            System.assertEquals(false, data.get('captchaEnabled'));
        }
    }

    @IsTest
    static void readCaptchaFlagIsFalseWhenTheUserCannotReadTheField() {
        // This test user holds explicit field permissions that predate Captcha_Enabled__c, like a
        // customer permission set created before the upgrade: forms must still open normally.
        Form__c f = makeForm('Protected Form');
        f.Captcha_Enabled__c = true;
        insert f;

        System.runAs(getRunAsUser()) {
            Boolean canRead = Schema.SObjectType.Form__c.fields.Captcha_Enabled__c.isAccessible();
            System.assertEquals(canRead, FormEditorController.readCaptchaFlag(f.Id), 'No access must read as "off", never throw');
            System.assertEquals(false, FormEditorController.readCaptchaFlag(null));
            System.assertNotEquals(null, FormEditorController.getFormData(f.Id));
        }
    }

    @IsTest
    static void getFormDataReturnsNullWhenIdNull() {
        System.runAs(getRunAsUser()) {
            Test.startTest();
            Map<String, Object> data = FormEditorController.getFormData(null);
            Test.stopTest();

            System.assertEquals(null, data);
        }
    }

    // -----------------------------
    // updateFormStatus
    // -----------------------------

    @IsTest
    static void updateFormStatusUpdatesRecord() {
        System.runAs(getRunAsUser()) {
            Form__c f = makeForm('Status Form ' + String.valueOf(DateTime.now().getTime()));
            insert f;

            String updatedName = f.Name + ' Updated';

            Form__c updateRecord = new Form__c(
                Id = f.Id,
                Name = updatedName
            );

            Test.startTest();
            FormEditorController.updateFormStatus(updateRecord);
            Test.stopTest();

            Form__c updated = [
                SELECT Name
                FROM Form__c
                WHERE Id = :f.Id
                LIMIT 1
            ];

            System.assertEquals(updatedName, updated.Name);
        }
    }

    @IsTest
    static void updateFormStatusThrowsWhenNull() {
        System.runAs(getRunAsUser()) {
            Boolean thrown = false;

            Test.startTest();
            try {
                FormEditorController.updateFormStatus(null);
            } catch (AuraHandledException e) {
                thrown = true;
            }
            Test.stopTest();

            System.assertEquals(true, thrown, 'Expected AuraHandledException for null form.');
        }
    }

    @IsTest
    static void updateFormStatusThrowsWhenIdNull() {
        System.runAs(getRunAsUser()) {
            Boolean thrown = false;

            Form__c f = new Form__c();
            f.Name = 'NoId';

            Test.startTest();
            try {
                FormEditorController.updateFormStatus(f);
            } catch (AuraHandledException e) {
                thrown = true;
            }
            Test.stopTest();

            System.assertEquals(true, thrown, 'Expected AuraHandledException when Id is missing.');
        }
    }

    // -----------------------------
    // fetchFieldDependencies
    // -----------------------------

    @IsTest
    static void fetchFieldDependenciesReturnsJson() {
        System.runAs(getRunAsUser()) {
            Form__c f = makeForm('Deps Form ' + String.valueOf(DateTime.now().getTime()));
            f.Field_Dependencies__c = '{"deps":[{"x":"y"}]}';
            insert f;

            Test.startTest();
            String deps = FormEditorController.fetchFieldDependencies(f.Id);
            Test.stopTest();

            System.assertEquals('{"deps":[{"x":"y"}]}', deps);
        }
    }

    @IsTest
    static void fetchFieldDependenciesReturnsEmptyWhenNullId() {
        System.runAs(getRunAsUser()) {
            Test.startTest();
            String deps = FormEditorController.fetchFieldDependencies(null);
            Test.stopTest();

            System.assertEquals('', deps);
        }
    }

    // -----------------------------
    // fetchObjectOptions + fetchFieldsForObject
    // -----------------------------

    @IsTest
    static void fetchObjectOptionsReturnsList() {
        System.runAs(getRunAsUser()) {
            Test.startTest();
            List<Map<String, String>> opts = FormEditorController.fetchObjectOptions();
            Test.stopTest();

            System.assertNotEquals(null, opts, 'Object options should not be null.');
        }
    }

    @IsTest
    static void fetchFieldsForObjectReturnsList() {
        System.runAs(getRunAsUser()) {
            Test.startTest();
            List<Map<String, Object>> fields = FormEditorController.fetchFieldsForObject('Account');
            Test.stopTest();

            System.assertNotEquals(null, fields, 'Field list should not be null.');
        }
    }
}