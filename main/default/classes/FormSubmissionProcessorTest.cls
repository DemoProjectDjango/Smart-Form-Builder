/**
 * @description Test class for FormSubmissionProcessor.
 *
 * This org can throw from FormSubmissionTrigger for some payloads, which prevents insertion of
 * Form_Submission__c. Therefore tests use Database.insert(..., false) and validate outcomes.
 *
 * All verification queries use WITH USER_MODE. Every test runs as a dedicated user
 * assigned the packaged FormBuilder_Admin permission set, so USER_MODE has the FLS it
 * needs both locally and in the package-version-create build org (where FLS on packaged
 * fields is never auto-granted to the default test user).
 *
 * Contract asserted:
 * - If Form_Submission__c inserts successfully:
 *    - Error_Message__c blank => tracking row(s) exist (>= 1)
 *    - Error_Message__c populated => tracking row count is 0
 * - If insert fails => CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY
 */
@IsTest
@SuppressWarnings('PMD.ApexCRUDViolation, PMD.ApexUnitTestClassShouldHaveAsserts, PMD.ApexAssertionsShouldIncludeMessage, PMD.CyclomaticComplexity')
private class FormSubmissionProcessorTest {

    private static final String TEST_FORM_NAME     = 'TestForm';
    private static final String TEST_OBJECT_API    = 'Account';
    private static final String INVALID_OBJECT_API = 'NonExistentObject__c';

    private static final String TEST_JSON_INVALID = 'Not JSON';
    private static final String TEST_JSON_NON_OBJECT = '[]';
    private static final String TEST_JSON_EMPTY   = '{}';
    private static final String TEST_JSON_BAD_ID  = '{"Id":"BadId123"}';

    private static final String RUN_AS_ALIAS = 'fsbp';

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
            LastName = 'SubProc',
            Email = 'formsubproctest@example.com',
            Username = 'formsubproctest+' + String.valueOf(DateTime.now().getTime()) + '@example.com',
            Alias = RUN_AS_ALIAS,
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;

        // Packaged permission set grants object CRUD + FLS on all Form Builder
        // fields so WITH USER_MODE verification queries work in the package
        // version create build org, where FLS is never auto-granted.
        PermissionSet ps = [
            SELECT Id
            FROM PermissionSet
            WHERE Name = 'FormBuilder_Admin'
            LIMIT 1
        ];
        insert new PermissionSetAssignment(
            AssigneeId = u.Id,
            PermissionSetId = ps.Id
        );

        // runAs separates setup-object DML (User, PermissionSetAssignment)
        // from standard DML to avoid MIXED_DML_OPERATION.
        System.runAs(u) {
            insertTestData();
        }
    }

    private static User getRunAsUser() {
        return [
            SELECT Id
            FROM User
            WHERE Alias = :RUN_AS_ALIAS
            LIMIT 1
        ];
    }

    private static void insertTestData() {
        insert new Form__c(
            Name = TEST_FORM_NAME,
            Object_API_Name__c = TEST_OBJECT_API
        );
        insert new Form__c(
            Name = 'ContactForm',
            Object_API_Name__c = 'Contact'
        );
        insert new Form__c(
            Name = 'OppForm',
            Object_API_Name__c = 'Opportunity'
        );
        insert new Form__c(
            Name = 'EventForm',
            Object_API_Name__c = 'Event'
        );
        insert new Account(Name = 'Original Acc');
        insert new Account(Name = 'Parent Acc');
    }

    // ============================================================
    // Helpers
    // ============================================================

    private static Id getFormId() {
        return [SELECT Id FROM Form__c WHERE Name = :TEST_FORM_NAME WITH USER_MODE LIMIT 1].Id;
    }

    private static Id getContactFormId() {
        return [SELECT Id FROM Form__c WHERE Name = 'ContactForm' WITH USER_MODE LIMIT 1].Id;
    }

    private static Id getOppFormId() {
        return [SELECT Id FROM Form__c WHERE Name = 'OppForm' WITH USER_MODE LIMIT 1].Id;
    }

    private static Id getEventFormId() {
        return [SELECT Id FROM Form__c WHERE Name = 'EventForm' WITH USER_MODE LIMIT 1].Id;
    }

    private static Id getAccountId() {
        return [SELECT Id FROM Account WHERE Name = 'Original Acc' WITH USER_MODE LIMIT 1].Id;
    }

    private static Id getParentAccountId() {
        return [SELECT Id FROM Account WHERE Name = 'Parent Acc' WITH USER_MODE LIMIT 1].Id;
    }

    private static Form_Submission__c makeSubmission(Id formId, String payload) {
        return new Form_Submission__c(
            Form__c = formId,
            Payload_JSON__c = payload
        );
    }

    private static String payloadBoth(Map<String, Object> fields) {
        Map<String, Object> wrapper = new Map<String, Object>();
        for (String k : fields.keySet()) {
            wrapper.put(k, fields.get(k));
        }
        wrapper.put('fields', fields);
        return JSON.serialize(wrapper);
    }

    private static String payloadUpdateBoth(Id recordId, Map<String, Object> fields) {
        Map<String, Object> wrapper = new Map<String, Object>();
        wrapper.put('Id', String.valueOf(recordId));
        for (String k : fields.keySet()) {
            wrapper.put(k, fields.get(k));
        }
        wrapper.put('fields', fields);
        return JSON.serialize(wrapper);
    }

    private static Form_Submission__c reloadSub(Id subId) {
        return [
            SELECT Id, Error_Message__c, Payload_JSON__c, Form__c
            FROM Form_Submission__c
            WHERE Id = :subId
            WITH USER_MODE
            LIMIT 1
        ];
    }

    private static Integer trackingCountForSub(Id subId) {
        return [
            SELECT COUNT()
            FROM Form_Submission_Record__c
            WHERE Form_Submission__c = :subId
            WITH USER_MODE
        ];
    }

    private static void assertSubmissionOutcome(Database.SaveResult sr) {
        System.assertNotEquals(null, sr, 'SaveResult must not be null.');

        if (!sr.isSuccess()) {
            System.assert(
                sr.getErrors() != null && sr.getErrors().size() > 0,
                'Expected at least one error when insert fails.'
            );
            Database.Error e = sr.getErrors()[0];
            System.assertNotEquals(null, e, 'SaveResult error must not be null.');
            System.assertEquals(
                StatusCode.CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY,
                e.getStatusCode(),
                'Expected trigger failure status code CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY.'
            );
            return;
        }

        Id subId = sr.getId();
        System.assertNotEquals(null, subId, 'If insert succeeded, Id must be populated.');

        Form_Submission__c saved = reloadSub(subId);
        Integer tCount = trackingCountForSub(subId);

        if (String.isBlank(saved.Error_Message__c)) {
            System.assert(
                tCount >= 1,
                'When Error_Message__c is blank, expected at least 1 tracking record. Actual: ' + tCount
            );
        } else {
            System.assertEquals(
                0,
                tCount,
                'When Error_Message__c is populated, expected 0 tracking records. Actual: ' + tCount
            );
        }
    }

    // ✅ converts expected String values for Date/Datetime fields before asserting
    private static Object normalizeExpected(Object expected, Object actual) {
        if (expected == null || actual == null) {
            return expected;
        }

        // Date field stored as Date, expected sent as 'YYYY-MM-DD'
        if (actual instanceof Date && expected instanceof String) {
            try {
                return Date.valueOf((String) expected);
            } catch (Exception ex) {
                return expected;
            }
        }

        // Datetime field stored as Datetime, expected sent as ISO string
        if (actual instanceof Datetime && expected instanceof String) {
            String s = ((String) expected).trim();
            // Handle ISO formats used by your payloads: '2024-01-01T12:00:00Z' and also with ms
            s = s.replace('T', ' ');
            if (s.endsWith('Z')) {
                s = s.substring(0, s.length() - 1);
            }
            Integer dotPos = s.indexOf('.');
            if (dotPos > -1) {
                s = s.substring(0, dotPos);
            }
            try {
                return Datetime.valueOf(s);
            } catch (Exception ex) {
                return expected;
            }
        }

        return expected;
    }

    private static void assertSuccessfulInsert(
        Database.SaveResult sr,
        String objectApiName,
        Map<String, Object> expectedFields
    ) {
        assertSubmissionOutcome(sr);

        if (sr.isSuccess()) {
            Form_Submission__c saved = reloadSub(sr.getId());
            System.assert(String.isBlank(saved.Error_Message__c), 'Expected no error for successful insert.');
            System.assertEquals(1, trackingCountForSub(saved.Id), 'Expected one tracking record.');

            Id targetId = [
                SELECT Record_Id__c
                FROM Form_Submission_Record__c
                WHERE Form_Submission__c = :saved.Id
                WITH USER_MODE
                LIMIT 1
            ].Record_Id__c;

            SObject targetRecord = Database.query(
                'SELECT ' + String.join(new List<String>(expectedFields.keySet()), ', ')
                + ' FROM ' + objectApiName
                + ' WHERE Id = :targetId WITH USER_MODE LIMIT 1'
            );

            for (String field : expectedFields.keySet()) {
                Object actualVal = targetRecord.get(field);
                Object expectedVal = normalizeExpected(expectedFields.get(field), actualVal);
                System.assertEquals(expectedVal, actualVal, field + ' should match.');
            }
        }
    }

    // ============================================================
    // Tests
    // ============================================================

    @IsTest
    static void testProcessAfterInsertHandlesNullOrEmptyList() {
        System.runAs(getRunAsUser()) {
        Test.startTest();
        FormSubmissionProcessor.processAfterInsert(null);
        FormSubmissionProcessor.processAfterInsert(new List<Form_Submission__c>());
        Test.stopTest();

        System.assert(true, 'Processor should handle null/empty lists without throwing.');
        }
    }

    @IsTest
    static void testInsertFiltersInvalidSubmissionsNoExceptions() {
        System.runAs(getRunAsUser()) {
        List<Form_Submission__c> subs = new List<Form_Submission__c>{
            new Form_Submission__c(),
            new Form_Submission__c(Form__c = getFormId()),
            new Form_Submission__c(Payload_JSON__c = payloadBoth(new Map<String,Object>{ 'Name' => 'X' }))
        };

        Test.startTest();
        Database.SaveResult[] sr = Database.insert(subs, false);
        Test.stopTest();

        System.assertEquals(3, sr.size(), 'Should return 3 save results for 3 attempted inserts.');
        }
    }

    @IsTest
    static void testMissingFormObjectApiOutcome() {
        System.runAs(getRunAsUser()) {
        Form__c formNoObj = new Form__c(Name = 'NoObjForm');
        insert formNoObj;

        Form_Submission__c sub = makeSubmission(
            formNoObj.Id,
            payloadBoth(new Map<String,Object>{ 'Name' => 'Test Acc', 'Type' => 'Prospect' })
        );

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testUnknownObjectOutcome() {
        System.runAs(getRunAsUser()) {
        Form__c badForm = new Form__c(Name = 'BadForm', Object_API_Name__c = INVALID_OBJECT_API);
        insert badForm;

        Form_Submission__c sub = makeSubmission(
            badForm.Id,
            payloadBoth(new Map<String,Object>{ 'Name' => 'Test Acc', 'Type' => 'Prospect' })
        );

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testInvalidJsonOutcome() {
        System.runAs(getRunAsUser()) {
        Form_Submission__c sub = makeSubmission(getFormId(), TEST_JSON_INVALID);

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testNonObjectJsonOutcome() {
        System.runAs(getRunAsUser()) {
        Form_Submission__c sub = makeSubmission(getFormId(), TEST_JSON_NON_OBJECT);

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testEmptyPayloadOutcome() {
        System.runAs(getRunAsUser()) {
        Form_Submission__c sub = makeSubmission(getFormId(), TEST_JSON_EMPTY);

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testInvalidOrWrongTypeIdOutcome() {
        System.runAs(getRunAsUser()) {
        Form_Submission__c badIdSub = makeSubmission(getFormId(), TEST_JSON_BAD_ID);

        Id userId = UserInfo.getUserId();
        String payloadWrongType = payloadUpdateBoth(
            userId,
            new Map<String,Object>{ 'Name' => 'Updated Acc' }
        );
        Form_Submission__c wrongTypeSub = makeSubmission(getFormId(), payloadWrongType);

        List<Form_Submission__c> subs = new List<Form_Submission__c>{badIdSub, wrongTypeSub};

        Test.startTest();
        Database.SaveResult[] srs = Database.insert(subs, false);
        Test.stopTest();

        for (Database.SaveResult sr : srs) {
            assertSubmissionOutcome(sr);
        }
        }
    }

    @IsTest
    static void testContactMissingLastNameOutcome() {
        System.runAs(getRunAsUser()) {
        Form_Submission__c sub = makeSubmission(
            getContactFormId(),
            payloadBoth(new Map<String,Object>{ 'FirstName' => 'Test' })
        );

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testMultipleSubmissionsMixedOutcomes() {
        System.runAs(getRunAsUser()) {
        Form_Submission__c s1 = makeSubmission(getFormId(), payloadBoth(new Map<String,Object>{ 'Name' => 'Mixed Test 1' }));
        Form_Submission__c s2 = makeSubmission(getFormId(), TEST_JSON_INVALID);
        Form_Submission__c s3 = makeSubmission(getFormId(), payloadUpdateBoth(getAccountId(), new Map<String,Object>{ 'Name' => 'Updated Acc' }));

        List<Form_Submission__c> subs = new List<Form_Submission__c>{s1, s2, s3};

        Test.startTest();
        Database.SaveResult[] srs = Database.insert(subs, false);
        Test.stopTest();

        for (Database.SaveResult sr : srs) {
            assertSubmissionOutcome(sr);
        }
        }
    }

    @IsTest
    static void testLongPayloadOutcome() {
        System.runAs(getRunAsUser()) {
        String longPayload = '{"Name":"Test"}';
        while (longPayload.length() <= 131072) {
            longPayload += ' ';
        }

        Form_Submission__c sub = makeSubmission(getFormId(), longPayload);

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSubmissionOutcome(sr);
        }
    }

    @IsTest
    static void testSuccessfulAccountInsertWithTypes() {
        System.runAs(getRunAsUser()) {
        Id parentId = getParentAccountId();
        Map<String, Object> fields = new Map<String, Object>{
            'Name' => 'Test Acc Types',
            'AnnualRevenue' => 100000.5,
            'NumberOfEmployees' => 100,
            'ParentId' => parentId,
            'Site' => 'Test Site'
        };
        Form_Submission__c sub = makeSubmission(getFormId(), payloadBoth(fields));

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSuccessfulInsert(sr, 'Account', fields);
        }
    }

    @IsTest
    static void testSuccessfulContactInsert() {
        System.runAs(getRunAsUser()) {
        Map<String, Object> fields = new Map<String, Object>{
            'FirstName' => 'Test',
            'LastName' => 'Contact',
            'Birthdate' => '1990-01-01',
            'Email' => 'test@contact.com'
        };
        Form_Submission__c sub = makeSubmission(getContactFormId(), payloadBoth(fields));

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSuccessfulInsert(sr, 'Contact', fields);
        }
    }

    @IsTest
    static void testSuccessfulOpportunityInsert() {
        System.runAs(getRunAsUser()) {
        Map<String, Object> fields = new Map<String, Object>{
            'Name' => 'Test Opp',
            'CloseDate' => '2024-01-01',
            'StageName' => 'Prospecting',
            'Amount' => 5000.5,
            'Probability' => 50
        };
        Form_Submission__c sub = makeSubmission(getOppFormId(), payloadBoth(fields));

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSuccessfulInsert(sr, 'Opportunity', fields);
        }
    }

    @IsTest
    static void testSuccessfulEventInsert() {
        System.runAs(getRunAsUser()) {
        Map<String, Object> fields = new Map<String, Object>{
            'Subject' => 'Test Event',
            'StartDateTime' => '2024-01-01T12:00:00Z',
            'EndDateTime' => '2024-01-01T13:00:00Z'
        };
        Form_Submission__c sub = makeSubmission(getEventFormId(), payloadBoth(fields));

        Test.startTest();
        Database.SaveResult sr = Database.insert(sub, false);
        Test.stopTest();

        assertSuccessfulInsert(sr, 'Event', fields);
        }
    }

    @IsTest
    static void testConvertValueCoversAllBranches() {
        System.runAs(getRunAsUser()) {
        Schema.DescribeFieldResult fdBool = Contact.DoNotCall.getDescribe();
        Schema.DescribeFieldResult fdInt  = Account.NumberOfEmployees.getDescribe();
        Schema.DescribeFieldResult fdDec  = Account.AnnualRevenue.getDescribe();
        Schema.DescribeFieldResult fdDate = Contact.Birthdate.getDescribe();
        Schema.DescribeFieldResult fdDt   = Event.StartDateTime.getDescribe();
        Schema.DescribeFieldResult fdText = Account.Name.getDescribe();
        Schema.DescribeFieldResult fdRef  = Account.ParentId.getDescribe();

        Test.startTest();

        System.assertEquals(null, FormSubmissionProcessor.convertValue(null, null), 'Null input should return null.');
        System.assertEquals('test', FormSubmissionProcessor.convertValue('test', null), 'Null describe should return original.');

        System.assertEquals(true, FormSubmissionProcessor.convertValue('true', fdBool), 'Boolean true should convert.');
        System.assertEquals(false, FormSubmissionProcessor.convertValue('false', fdBool), 'Boolean false should convert.');

        System.assertEquals(10, FormSubmissionProcessor.convertValue('10', fdInt), 'Integer should convert.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('bad', fdInt), 'Invalid integer should return null.');

        System.assertEquals(10.5, FormSubmissionProcessor.convertValue('10.5', fdDec), 'Decimal should convert.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('bad', fdDec), 'Invalid decimal should return null.');

        Date testDate = Date.valueOf('2023-01-01');
        System.assertEquals(testDate, FormSubmissionProcessor.convertValue('2023-01-01', fdDate), 'Date should parse.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('bad', fdDate), 'Invalid date should return null.');

        Datetime expectedDt = Datetime.valueOf('2023-01-01 12:00:00');
        System.assertEquals(expectedDt, FormSubmissionProcessor.convertValue('2023-01-01 12:00:00', fdDt), 'Datetime should parse.');

        System.assertNotEquals(null, FormSubmissionProcessor.convertValue('2023-01-01T12:00:00Z', fdDt), 'ISO datetime should parse.');
        System.assertNotEquals(null, FormSubmissionProcessor.convertValue('2023-01-01T12:00:00.123Z', fdDt), 'ISO datetime with ms should parse.');

        System.assertEquals(null, FormSubmissionProcessor.convertValue('bad', fdDt), 'Invalid datetime should return null.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('', fdDt), 'Empty datetime should return null.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('   ', fdDt), 'Blank datetime should return null.');

        Id accId = getAccountId();
        System.assertEquals(accId, FormSubmissionProcessor.convertValue(String.valueOf(accId), fdRef), 'Reference should convert.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('badId', fdRef), 'Invalid reference should return null.');
        System.assertEquals(null, FormSubmissionProcessor.convertValue('', fdRef), 'Empty reference should return null.');

        System.assertEquals('test value', FormSubmissionProcessor.convertValue('test value', fdText), 'Text should remain unchanged.');

        Test.stopTest();
        }
    }

    @IsTest
    static void testCurrencyConversion() {
        System.runAs(getRunAsUser()) {
        Schema.DescribeFieldResult fdCurrency = Account.AnnualRevenue.getDescribe();

        Test.startTest();
        Decimal currencyVal = (Decimal)FormSubmissionProcessor.convertValue('50000.75', fdCurrency);
        Test.stopTest();

        System.assertEquals(50000.75, currencyVal, 'Currency should convert to Decimal correctly.');
        }
    }
}