@IsTest
private class LookupRecordSearchControllerTest {

    private static final String ADMIN_ALIAS = 'lrsadm';
    private static final String PLAIN_ALIAS = 'lrspln';

    private static User makeUser(Profile p, String alias) {
        return new User(
            ProfileId = p.Id,
            LastName = 'LookupSearch' + alias,
            Email = 'lookupsearch_' + alias + '@example.com',
            Username = 'lookupsearch_' + alias + '+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
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
            SELECT Id FROM Profile WHERE PermissionsModifyAllData = true LIMIT 1
        ];
        Profile plainProfile = [
            SELECT Id FROM Profile WHERE PermissionsModifyAllData = false AND UserType = 'Standard' LIMIT 1
        ];
        User admin = makeUser(adminProfile, ADMIN_ALIAS);
        insert new List<User>{ admin, makeUser(plainProfile, PLAIN_ALIAS) };

        System.runAs(admin) {
            List<Account> accounts = new List<Account>();
            accounts.add(new Account(Name = 'Acme East'));
            accounts.add(new Account(Name = 'Acme West'));
            accounts.add(new Account(Name = '100% Pure'));
            for (Integer i = 0; i < 25; i++) {
                accounts.add(new Account(Name = 'Bulk ' + String.valueOf(1000 + i)));
            }
            insert accounts;
        }
    }

    private static User runAs(String alias) {
        return [SELECT Id FROM User WHERE Alias = :alias LIMIT 1];
    }

    @IsTest
    static void searchFindsRecordsByPartOfTheName() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            List<LookupRecordSearchController.RecordOption> hits = LookupRecordSearchController.searchRecords('Account', 'acme');

            System.assertEquals(2, hits.size());
            System.assertEquals('Acme East', hits[0].name, 'Results are ordered by name.');
            System.assertNotEquals(null, hits[0].id);
        }
    }

    @IsTest
    static void searchIsCaseInsensitiveOnTheObjectName() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            System.assertEquals(2, LookupRecordSearchController.searchRecords('account', 'Acme').size());
        }
    }

    @IsTest
    static void blankSearchListsAtMostTheFirstTwentyRecords() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            System.assertEquals(
                LookupRecordSearchController.MAX_RESULTS,
                LookupRecordSearchController.searchRecords('Account', '  ').size()
            );
        }
    }

    @IsTest
    static void wildcardCharactersAreTreatedAsPlainText() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            System.assertEquals(1, LookupRecordSearchController.searchRecords('Account', '100%').size());
            System.assertEquals(1, LookupRecordSearchController.searchRecords('Account', '%').size(), 'Only the literal % matches.');
            System.assertEquals(0, LookupRecordSearchController.searchRecords('Account', 'Acme_East').size(), '_ is not a wildcard.');
            System.assertEquals(0, LookupRecordSearchController.searchRecords('Account', 'x\' OR Name != \'').size());
        }
    }

    @IsTest
    static void unknownOrBlankObjectsReturnNothing() {
        System.runAs(runAs(ADMIN_ALIAS)) {
            System.assertEquals(0, LookupRecordSearchController.searchRecords(null, 'a').size());
            System.assertEquals(0, LookupRecordSearchController.searchRecords('', 'a').size());
            System.assertEquals(0, LookupRecordSearchController.searchRecords('Not_An_Object__c', 'a').size());
        }
    }

    @IsTest
    static void usersWithoutAccessNeverGetRecords() {
        System.runAs(runAs(PLAIN_ALIAS)) {
            Integer found = 0;
            Boolean denied = false;
            try {
                found = LookupRecordSearchController.searchRecords(String.valueOf(Form__c.SObjectType), 'a').size();
            } catch (AuraHandledException e) {
                denied = true;
            }
            System.assert(denied || found == 0, 'A user without access must not receive records.');
        }
    }
}
