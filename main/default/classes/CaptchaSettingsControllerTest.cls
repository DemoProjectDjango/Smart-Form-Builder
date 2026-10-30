@IsTest
private class CaptchaSettingsControllerTest {

    private static final String SITE_KEY = '1x00000000000000000000AA';
    private static final String SECRET = '1x0000000000000000000000000000000AA';
    private static final String USERNAME_PREFIX = 'captchaadmin';
    private static final String PLAIN_PREFIX = 'captchaplain';

    @TestSetup
    static void setupData() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Profile p = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
            User u = new User(
                Alias             = 'cpadm',
                Email             = 'captchaadmin@example.com.invalid',
                EmailEncodingKey  = 'UTF-8',
                LastName          = 'CaptchaAdmin',
                LanguageLocaleKey = 'en_US',
                LocaleSidKey      = 'en_US',
                ProfileId         = p.Id,
                TimeZoneSidKey    = 'America/Los_Angeles',
                Username          = USERNAME_PREFIX + Crypto.getRandomInteger() + '@example.com.invalid'
            );
            insert u;
            PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'FormBuilder_Admin' LIMIT 1];
            insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);

            // Holds no Form Builder permission set. The default test user cannot stand in for this:
            // developers who run the tests usually have FormBuilder_Admin assigned.
            Profile standard = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
            insert new User(
                Alias             = 'cpplain',
                Email             = 'captchaplain@example.com.invalid',
                EmailEncodingKey  = 'UTF-8',
                LastName          = 'CaptchaPlain',
                LanguageLocaleKey = 'en_US',
                LocaleSidKey      = 'en_US',
                ProfileId         = standard.Id,
                TimeZoneSidKey    = 'America/Los_Angeles',
                Username          = PLAIN_PREFIX + Crypto.getRandomInteger() + '@example.com.invalid'
            );
        }
    }

    private static User adminUser() {
        return [SELECT Id FROM User WHERE Username LIKE :(USERNAME_PREFIX + '%') LIMIT 1];
    }

    private static User plainUser() {
        return [SELECT Id FROM User WHERE Username LIKE :(PLAIN_PREFIX + '%') LIMIT 1];
    }

    private static String errorOf(Exception e) {
        return e.getMessage();
    }

    @IsTest
    static void testStatusStartsEmptyAndNeverExposesTheSecret() {
        System.runAs(adminUser()) {
            CaptchaSettingsController.Status status = CaptchaSettingsController.getStatus();

            System.assertEquals('', status.siteKey);
            System.assertEquals(false, status.secretSaved);
            System.assertEquals(false, status.connected);
            System.assertEquals(true, status.canManage);
            System.assertEquals(0, status.formsUsing);

            CaptchaSettingsController.saveKeys(SITE_KEY, SECRET);
            String json = JSON.serialize(CaptchaSettingsController.getStatus());
            System.assert(!json.contains(SECRET), 'The secret key must never be returned to the browser');
            System.assert(json.contains(SITE_KEY));
        }
    }

    @IsTest
    static void testSaveKeysStoresThemAndWaitsForTheTest() {
        System.runAs(adminUser()) {
            CaptchaSettingsController.Status status = CaptchaSettingsController.saveKeys('  ' + SITE_KEY + ' ', SECRET);

            System.assertEquals(SITE_KEY, status.siteKey);
            System.assertEquals(true, status.secretSaved);
            System.assertEquals(false, status.connected, 'Keys must pass the connection test first');
            System.assertEquals(SECRET, Captcha_Settings__c.getOrgDefaults().Secret_Key__c);
        }
    }

    @IsTest
    static void testSavingAgainKeepsTheSecretWhenBlankAndResetsConnection() {
        System.runAs(adminUser()) {
            CaptchaSettingsController.saveKeys(SITE_KEY, SECRET);
            Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('invalid-input-response'));
            Test.startTest(); // a callout cannot follow DML in the same transaction
            System.assertEquals(true, CaptchaSettingsController.testConnection().connected);
            Test.stopTest();

            CaptchaSettingsController.Status status = CaptchaSettingsController.saveKeys('1x00000000000000000001BB', '');

            System.assertEquals('1x00000000000000000001BB', status.siteKey);
            System.assertEquals(true, status.secretSaved);
            System.assertEquals(false, status.connected);
            System.assertEquals(SECRET, Captcha_Settings__c.getOrgDefaults().Secret_Key__c);
        }
    }

    @IsTest
    static void testSaveKeysRejectsBadInput() {
        System.runAs(adminUser()) {
            for (List<String> keys : new List<List<String>>{
                new List<String>{ '', SECRET },
                new List<String>{ 'short', SECRET },
                new List<String>{ SITE_KEY, '' },
                new List<String>{ SITE_KEY, 'not a key!!' }
            }) {
                try {
                    CaptchaSettingsController.saveKeys(keys[0], keys[1]);
                    System.assert(false, 'Expected the keys to be rejected: ' + keys);
                } catch (AuraHandledException e) {
                    System.assertNotEquals(null, errorOf(e));
                }
            }
            System.assertEquals(null, Captcha_Settings__c.getOrgDefaults().Id);
        }
    }

    @IsTest
    static void testConnectionPassesWithAValidSecret() {
        System.runAs(adminUser()) {
            CaptchaSettingsController.saveKeys(SITE_KEY, SECRET);
            Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('invalid-input-response'));

            Test.startTest();
            CaptchaSettingsController.Status status = CaptchaSettingsController.testConnection();
            Test.stopTest();

            System.assertEquals(true, status.connected);
            System.assertEquals('Cloudflare accepted the secret key.', status.message);
            System.assertEquals(true, TurnstileVerifier.isConnected());
        }
    }

    @IsTest
    static void testConnectionFailsWithAWrongSecret() {
        System.runAs(adminUser()) {
            CaptchaSettingsController.saveKeys(SITE_KEY, SECRET);
            Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('invalid-input-secret'));

            Test.startTest();
            CaptchaSettingsController.Status status = CaptchaSettingsController.testConnection();
            Test.stopTest();

            System.assertEquals(false, status.connected);
            System.assert(status.message.contains('did not accept'));
        }
    }

    @IsTest
    static void testConnectionNeedsSavedKeys() {
        System.runAs(adminUser()) {
            try {
                CaptchaSettingsController.testConnection();
                System.assert(false, 'Expected an error');
            } catch (AuraHandledException e) {
                System.assertEquals('Save your site key and secret key first.', errorOf(e));
            }
        }
    }

    @IsTest
    static void testClearKeysRemovesEverythingAndCountsAffectedForms() {
        System.runAs(adminUser()) {
            CaptchaSettingsController.saveKeys(SITE_KEY, SECRET);
            Test.setMock(HttpCalloutMock.class, TurnstileHttpMock.rejected('invalid-input-response'));
            Test.startTest();
            CaptchaSettingsController.testConnection();
            Test.stopTest();
            insert new Form__c(Name = 'Protected', Captcha_Enabled__c = true);

            CaptchaSettingsController.Status status = CaptchaSettingsController.clearKeys();

            System.assertEquals('', status.siteKey);
            System.assertEquals(false, status.secretSaved);
            System.assertEquals(false, status.connected);
            System.assertEquals(1, status.formsUsing, 'The screen must warn about forms that rely on the keys');
            System.assertEquals(null, Captcha_Settings__c.getOrgDefaults().Secret_Key__c);
        }
    }

    @IsTest
    static void testEveryWriteNeedsThePermission() {
        String denied = 'You do not have permission to manage spam protection. Ask an administrator to assign the FormBuilder_Admin permission set.';
        System.runAs(plainUser()) {
            System.assertEquals(false, CaptchaSettingsController.getStatus().canManage);
            try {
                CaptchaSettingsController.saveKeys(SITE_KEY, SECRET);
                System.assert(false, 'Expected a permission error');
            } catch (AuraHandledException e) {
                System.assertEquals(denied, errorOf(e));
            }
            try {
                CaptchaSettingsController.testConnection();
                System.assert(false, 'Expected a permission error');
            } catch (AuraHandledException e) {
                System.assertEquals(denied, errorOf(e));
            }
            try {
                CaptchaSettingsController.clearKeys();
                System.assert(false, 'Expected a permission error');
            } catch (AuraHandledException e) {
                System.assertEquals(denied, errorOf(e));
            }
            System.assertEquals(null, Captcha_Settings__c.getOrgDefaults().Id);
        }
    }
}
