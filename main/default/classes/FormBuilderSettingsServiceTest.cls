/**
 * @description Tests for FormBuilderSettingsService.
 */
@IsTest
private class FormBuilderSettingsServiceTest {

    @TestSetup
    static void setup() {
        Profile p = [
            SELECT Id
            FROM Profile
            WHERE PermissionsModifyAllData = true
            LIMIT 1
        ];

        User u = new User(
            ProfileId         = p.Id,
            LastName          = 'Fbss',
            Email             = 'fbss_test@example.com',
            Username          = 'fbss_test+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
            Alias             = 'fbsst',
            TimeZoneSidKey    = 'America/Los_Angeles',
            LocaleSidKey      = 'en_US',
            EmailEncodingKey  = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );

        insert u;
    }

    private static User getRunAsUser() {
        return [
            SELECT Id
            FROM User
            WHERE Alias = 'fbsst'
            LIMIT 1
        ];
    }

    @IsTest
    static void getPublicFormBaseUrlReturnsValue() {
        System.runAs(getRunAsUser()) {
            Form_Builder_Settings__c cs = new Form_Builder_Settings__c(
                SetupOwnerId = UserInfo.getOrganizationId(),
                Public_Form_Base_Url__c = 'https://example.com/PublicForm?id='
            );
            insert cs;

            Test.startTest();
            String val = FormBuilderSettingsService.getPublicFormBaseUrl();
            Test.stopTest();

            System.assertEquals(
                'https://example.com/PublicForm?id=',
                val,
                'Public form base URL should return the configured custom setting value.'
            );
        }
    }

    @IsTest
    static void getPublicFormBaseUrlReturnsTrimmedValue() {
        System.runAs(getRunAsUser()) {
            Form_Builder_Settings__c cs = new Form_Builder_Settings__c(
                SetupOwnerId = UserInfo.getOrganizationId(),
                Public_Form_Base_Url__c = '  https://example.com/PublicForm?id=  '
            );
            insert cs;

            Test.startTest();
            String val = FormBuilderSettingsService.getPublicFormBaseUrl();
            Test.stopTest();

            System.assertEquals(
                'https://example.com/PublicForm?id=',
                val,
                'Public form base URL should be trimmed.'
            );
        }
    }

    @IsTest
    static void getPublicFormBaseUrlReturnsBlankWhenMissing() {
        System.runAs(getRunAsUser()) {
            Test.startTest();
            String val = FormBuilderSettingsService.getPublicFormBaseUrl();
            Test.stopTest();

            System.assertNotEquals(
                null,
                val,
                'Value should never be null.'
            );

            System.assertEquals(
                '',
                val,
                'Value should be blank when custom setting is missing.'
            );
        }
    }

    @IsTest
    static void getPublicFormBaseUrlReturnsBlankWhenFieldIsNull() {
        System.runAs(getRunAsUser()) {
            Form_Builder_Settings__c cs = new Form_Builder_Settings__c(
                SetupOwnerId = UserInfo.getOrganizationId()
            );
            insert cs;

            Test.startTest();
            String val = FormBuilderSettingsService.getPublicFormBaseUrl();
            Test.stopTest();

            System.assertNotEquals(
                null,
                val,
                'Value should never be null.'
            );

            System.assertEquals(
                '',
                val,
                'Value should be blank when Public_Form_Base_Url__c is null.'
            );
        }
    }

}