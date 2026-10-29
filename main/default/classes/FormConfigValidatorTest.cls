@IsTest
private class FormConfigValidatorTest {

    private static String lookupJson(String apiName, String lookupBody, String referenceTo) {
        return '[{"apiName":"' + apiName + '","type":"REFERENCE","referenceTo":' + referenceTo
            + ',"lookup":' + lookupBody + '}]';
    }

    private static String fixedJson(Id recordId, String referenceTo) {
        return lookupJson('ParentId', '{"mode":"fixed","record":{"id":"' + recordId + '","label":"x"}}', referenceTo);
    }

    private static String choicesJson(Integer count, Id recordId, String referenceTo) {
        List<String> items = new List<String>();
        for (Integer i = 1; i <= count; i++) {
            items.add('{"key":"o' + i + '","id":"' + recordId + '","label":"L' + i + '"}');
        }
        return lookupJson('ParentId', '{"mode":"choices","choices":[' + String.join(items, ',') + ']}', referenceTo);
    }

    private static Account newAccount() {
        Account a = new Account(Name = 'Config Acc');
        insert a;
        return a;
    }

    @IsTest
    static void validateAcceptsBlankLegacyAndWellFormedConfigurations() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account a = newAccount();

            System.assertEquals(null, FormConfigValidator.validate(null));
            System.assertEquals(null, FormConfigValidator.validate('{"field":"Name"}'));
            System.assertEquals(null, FormConfigValidator.validate('[{"apiName":"Name","type":"STRING"}]'));
            System.assertEquals(null, FormConfigValidator.validate(fixedJson(a.Id, '["Account"]')));
            System.assertEquals(null, FormConfigValidator.validate(choicesJson(FormFieldConfig.MAX_CHOICES, a.Id, '["Account"]')));
            System.assertEquals(null, FormConfigValidator.validate(lookupJson('ParentId', 'null', '["Account"]')), 'Unconfigured lookups are fine.');
        }
    }

    @IsTest
    static void validateRejectsMalformedConfigurations() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account a = newAccount();

            System.assertNotEquals(null, FormConfigValidator.validate('{nope'));
            System.assertNotEquals(null, FormConfigValidator.validate('[{"type":"STRING"}]'), 'A field needs an API name.');
            System.assertNotEquals(null, FormConfigValidator.validate(lookupJson('ParentId', '{"mode":"fixed"}', '["Account"]')));
            System.assertNotEquals(null, FormConfigValidator.validate(fixedJson(UserInfo.getUserId(), '["Account"]')), 'Record of the wrong object.');
            System.assertNotEquals(null, FormConfigValidator.validate(lookupJson('ParentId', '{"mode":"choices","choices":[]}', '["Account"]')));
            System.assertNotEquals(null, FormConfigValidator.validate(choicesJson(FormFieldConfig.MAX_CHOICES + 1, a.Id, '["Account"]')));
            System.assertNotEquals(null, FormConfigValidator.validate(choicesJson(1, UserInfo.getUserId(), '["Account"]')), 'Choice of the wrong object.');
        }
    }

    @IsTest
    static void matchesReferenceChecksTheObjectOfTheRecord() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account a = newAccount();

            System.assertEquals(false, FormConfigValidator.matchesReference(null, new List<String>{ 'Account' }));
            System.assertEquals(true, FormConfigValidator.matchesReference(a.Id, null), 'No targets listed: no check.');
            System.assertEquals(true, FormConfigValidator.matchesReference(a.Id, new List<String>{ 'account' }));
            System.assertEquals(true, FormConfigValidator.matchesReference(UserInfo.getUserId(), new List<String>{ 'Group', 'User' }));
            System.assertEquals(false, FormConfigValidator.matchesReference(a.Id, new List<String>{ 'User' }));
        }
    }
}
