@IsTest
private class FormFieldConfigTest {

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
    static void parseBuildsALowerCasedAllowListWithTypesAndPicklistValues() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            String json = '[{"apiName":"Industry","type":"picklist","required":true,'
                + '"picklistValues":[{"label":"Banking","value":"Banking"},{"label":"Edu","value":"Education"}]},'
                + '{"apiName":"Name","type":"STRING"},{"label":"no api name"},"junk"]';

            Map<String, FormFieldConfig.Field> parsed = FormFieldConfig.parse(json);

            System.assertEquals(2, parsed.size(), 'Entries without an API name are skipped.');
            FormFieldConfig.Field industry = parsed.get('industry');
            System.assertEquals('PICKLIST', industry.type);
            System.assertEquals(true, industry.required);
            System.assertEquals(new Set<String>{ 'Banking', 'Education' }, industry.picklistValues);
            System.assertEquals(false, parsed.get('name').required);
            System.assertEquals(null, parsed.get('name').lookupMode);
        }
    }

    @IsTest
    static void parseReadsFixedAndChoiceLookups() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account a = newAccount();

            FormFieldConfig.Field fixed = FormFieldConfig.parse(fixedJson(a.Id, '["Account"]')).get('parentid');
            System.assertEquals(FormFieldConfig.MODE_FIXED, fixed.lookupMode);
            System.assertEquals(a.Id, fixed.fixedId);
            System.assertEquals(new List<String>{ 'Account' }, fixed.referenceTo);

            FormFieldConfig.Field choices = FormFieldConfig.parse(choicesJson(2, a.Id, '["Account"]')).get('parentid');
            System.assertEquals(FormFieldConfig.MODE_CHOICES, choices.lookupMode);
            System.assertEquals(a.Id, choices.choices.get('o2'));
        }
    }

    @IsTest
    static void parseIgnoresChoicesWithBadKeysOrIds() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            String body = '{"mode":"choices","choices":[{"key":"bad key","id":"' + UserInfo.getUserId()
                + '"},{"key":"o1","id":"not-an-id"},{"key":"o2"},"x"]}';

            FormFieldConfig.Field f = FormFieldConfig.parse(lookupJson('OwnerId', body, '[]')).get('ownerid');

            System.assertEquals(FormFieldConfig.MODE_CHOICES, f.lookupMode);
            System.assertEquals(0, f.choices.size());
        }
    }

    @IsTest
    static void parseReturnsEmptyForBlankInvalidOrNonListJson() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            System.assert(FormFieldConfig.parse(null).isEmpty());
            System.assert(FormFieldConfig.parse('').isEmpty());
            System.assert(FormFieldConfig.parse('{nope').isEmpty());
            System.assert(FormFieldConfig.parse('{"field":"Name"}').isEmpty());
        }
    }
}
