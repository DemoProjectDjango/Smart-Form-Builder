/**
 * @description Test class for FormSubmissionProcessor.
 *
 * Rules under test:
 * - Only fields listed in the form's saved configuration (Field_Config__c) are written; anything
 *   else a visitor sends is ignored.
 * - Lookup fields are hidden unless the admin configured them: a fixed record, or selected
 *   choices submitted as opaque keys. Visitor-supplied record Ids are never used.
 * - Public submissions can only create records; a payload carrying an Id is rejected.
 * - A rejected record is stored as the submission's error message; nothing throws out of the trigger.
 *
 * All verification queries use WITH USER_MODE. Every test runs as a dedicated user
 * assigned the packaged FormBuilder_Admin permission set, so USER_MODE has the FLS it
 * needs both locally and in the package-version-create build org (where FLS on packaged
 * fields is never auto-granted to the default test user).
 */
@IsTest
@SuppressWarnings('PMD.ApexCRUDViolation, PMD.ApexUnitTestClassShouldHaveAsserts, PMD.ApexAssertionsShouldIncludeMessage, PMD.CyclomaticComplexity')
private class FormSubmissionProcessorTest {

    private static final String RUN_AS_ALIAS = 'fsbp';

    private static final String FORM_ACCOUNT = 'AccountForm';
    private static final String FORM_FIXED   = 'FixedParentForm';
    private static final String FORM_NOCFG   = 'NoConfigForm';
    private static final String FORM_CONTACT = 'ContactForm';
    private static final String FORM_OPP     = 'OppForm';
    private static final String FORM_EVENT   = 'EventForm';

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

    // ============================================================
    // Test data
    // ============================================================

    private static Map<String, Object> field(String apiName, String type) {
        return new Map<String, Object>{ 'apiName' => apiName, 'type' => type, 'required' => false };
    }

    private static Map<String, Object> lookupField(String apiName, Map<String, Object> lookup) {
        Map<String, Object> f = field(apiName, 'REFERENCE');
        f.put('lookup', lookup);
        return f;
    }

    private static Map<String, Object> picklistField(String apiName, List<String> values) {
        Map<String, Object> f = field(apiName, 'PICKLIST');
        List<Object> options = new List<Object>();
        for (String v : values) {
            options.add(new Map<String, Object>{ 'label' => v, 'value' => v });
        }
        f.put('picklistValues', options);
        return f;
    }

    private static void insertTestData() {
        Account parent = new Account(Name = 'Parent Acc');
        Account original = new Account(Name = 'Original Acc');
        insert new List<Account>{ parent, original };

        // ParentId: selected choices (o1 -> Parent Acc); OwnerId: left unconfigured, so hidden.
        Map<String, Object> parentChoices = new Map<String, Object>{
            'mode' => 'choices',
            'choices' => new List<Object>{
                new Map<String, Object>{ 'key' => 'o1', 'id' => String.valueOf(parent.Id), 'label' => 'Parent Acc' }
            }
        };
        List<Object> accountConfig = new List<Object>{
            field('Name', 'STRING'),
            field('AnnualRevenue', 'CURRENCY'),
            field('NumberOfEmployees', 'INTEGER'),
            field('Site', 'STRING'),
            picklistField('Industry', new List<String>{ 'Banking', 'Education' }),
            lookupField('ParentId', parentChoices),
            lookupField('OwnerId', null)
        };
        // ParentId fixed to the parent account.
        List<Object> fixedConfig = new List<Object>{
            field('Name', 'STRING'),
            lookupField('ParentId', new Map<String, Object>{
                'mode' => 'fixed',
                'record' => new Map<String, Object>{ 'id' => String.valueOf(parent.Id), 'label' => 'Parent Acc', 'showToVisitors' => false }
            })
        };

        insert new List<Form__c>{
            new Form__c(Name = FORM_ACCOUNT, Object_API_Name__c = 'Account', Field_Config__c = JSON.serialize(accountConfig)),
            new Form__c(Name = FORM_FIXED, Object_API_Name__c = 'Account', Field_Config__c = JSON.serialize(fixedConfig)),
            new Form__c(Name = FORM_NOCFG, Object_API_Name__c = 'Account'),
            new Form__c(Name = FORM_CONTACT, Object_API_Name__c = 'Contact', Field_Config__c = JSON.serialize(new List<Object>{
                field('FirstName', 'STRING'), field('LastName', 'STRING'), field('Birthdate', 'DATE'), field('Email', 'EMAIL')
            })),
            new Form__c(Name = FORM_OPP, Object_API_Name__c = 'Opportunity', Field_Config__c = JSON.serialize(new List<Object>{
                field('Name', 'STRING'), field('CloseDate', 'DATE'), field('StageName', 'PICKLIST'),
                field('Amount', 'CURRENCY'), field('Probability', 'PERCENT')
            })),
            new Form__c(Name = FORM_EVENT, Object_API_Name__c = 'Event', Field_Config__c = JSON.serialize(new List<Object>{
                field('Subject', 'STRING'), field('StartDateTime', 'DATETIME'), field('EndDateTime', 'DATETIME')
            }))
        };
    }

    // ============================================================
    // Helpers
    // ============================================================

    private static User getRunAsUser() {
        return [SELECT Id FROM User WHERE Alias = :RUN_AS_ALIAS LIMIT 1];
    }

    private static Id formId(String name) {
        return [SELECT Id FROM Form__c WHERE Name = :name WITH USER_MODE LIMIT 1].Id;
    }

    private static Id accountId(String name) {
        return [SELECT Id FROM Account WHERE Name = :name WITH USER_MODE LIMIT 1].Id;
    }

    private static Form_Submission__c makeSubmission(Id formId, String payload) {
        return new Form_Submission__c(Form__c = formId, Payload_JSON__c = payload);
    }

    private static String payloadBoth(Map<String, Object> fields) {
        Map<String, Object> wrapper = new Map<String, Object>(fields);
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

    /**
     * Inserts one submission and returns it reloaded. FormSubmissionHandler processes only the first
     * insert of a transaction, so each test submits exactly once.
     */
    private static Form_Submission__c submit(String formName, String payload) {
        Database.SaveResult sr = Database.insert(makeSubmission(formId(formName), payload), false);
        System.assert(sr.isSuccess(), 'The submission itself must always be stored: ' + sr.getErrors());
        return reloadSub(sr.getId());
    }

    private static SObject createdRecord(Form_Submission__c saved, String objectApiName, List<String> fields) {
        Id targetId = [
            SELECT Record_Id__c
            FROM Form_Submission_Record__c
            WHERE Form_Submission__c = :saved.Id
            WITH USER_MODE
            LIMIT 1
        ].Record_Id__c;
        return Database.query(
            'SELECT ' + String.join(fields, ', ') + ' FROM ' + objectApiName
            + ' WHERE Id = :targetId WITH USER_MODE LIMIT 1'
        );
    }

    private static void assertRejected(Form_Submission__c saved, String expectedMessagePart) {
        System.assert(String.isNotBlank(saved.Error_Message__c), 'An error message must be stored.');
        System.assert(
            saved.Error_Message__c.contains(expectedMessagePart),
            'Unexpected error message: ' + saved.Error_Message__c
        );
        System.assertEquals(0, trackingCountForSub(saved.Id), 'No record may be tracked for a rejected submission.');
    }

    // ============================================================
    // Allow-list
    // ============================================================

    @IsTest
    static void testFieldsOnTheFormAreWritten() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{
                'Name' => 'Test Acc Types',
                'AnnualRevenue' => 100000.5,
                'NumberOfEmployees' => 100,
                'Site' => 'Test Site',
                'Industry' => 'Banking'
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account',
                new List<String>{ 'Name', 'AnnualRevenue', 'NumberOfEmployees', 'Site', 'Industry' });
            System.assertEquals('Test Acc Types', created.Name);
            System.assertEquals(100000.5, created.AnnualRevenue);
            System.assertEquals(100, created.NumberOfEmployees);
            System.assertEquals('Test Site', created.Site);
            System.assertEquals('Banking', created.Industry);
        }
    }

    @IsTest
    static void testFieldsNotOnTheFormAreIgnored() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, JSON.serialize(new Map<String, Object>{
                'Name' => 'Allow List Acc',
                'Description' => 'must not be written',
                'Phone' => '555-0100'
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account', new List<String>{ 'Name', 'Description', 'Phone' });
            System.assertEquals('Allow List Acc', created.Name);
            System.assertEquals(null, created.Description, 'A field that is not on the form must be ignored.');
            System.assertEquals(null, created.Phone, 'A field that is not on the form must be ignored.');
        }
    }

    @IsTest
    static void testFormWithoutSavedConfigurationIsRejected() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_NOCFG, payloadBoth(new Map<String, Object>{ 'Name' => 'No Config' }));

            assertRejected(saved, 'no saved field configuration');
        }
    }

    @IsTest
    static void testTooManyFieldsAreRejected() {
        System.runAs(getRunAsUser()) {
            Map<String, Object> many = new Map<String, Object>();
            for (Integer i = 0; i < 201; i++) {
                many.put('F' + i, 'x');
            }

            Form_Submission__c saved = submit(FORM_ACCOUNT, JSON.serialize(many));

            assertRejected(saved, 'too many fields');
        }
    }

    @IsTest
    static void testPicklistValueMustBeOneOfTheFormsValues() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{
                'Name' => 'Bad Industry',
                'Industry' => 'Not A Real Value'
            }));

            assertRejected(saved, 'Invalid value for Industry');
        }
    }

    // ============================================================
    // Create only
    // ============================================================

    @IsTest
    static void testPayloadWithAnIdIsRejectedAndNothingIsUpdated() {
        System.runAs(getRunAsUser()) {
            Id existing = accountId('Original Acc');

            Form_Submission__c saved = submit(FORM_ACCOUNT, JSON.serialize(new Map<String, Object>{
                'Id' => String.valueOf(existing),
                'Name' => 'Hijacked'
            }));

            assertRejected(saved, 'Updating existing records is not allowed');
            System.assertEquals('Original Acc', [SELECT Name FROM Account WHERE Id = :existing WITH USER_MODE].Name);
        }
    }

    @IsTest
    static void testNestedIdIsAlsoRejected() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, JSON.serialize(new Map<String, Object>{
                'fields' => new Map<String, Object>{ 'id' => String.valueOf(accountId('Original Acc')), 'Name' => 'Hijacked' }
            }));

            assertRejected(saved, 'Updating existing records is not allowed');
        }
    }

    // ============================================================
    // Lookup fields
    // ============================================================

    @IsTest
    static void testBlankUnconfiguredLookupDoesNotRejectTheRecord() {
        // The original failure: a blank Owner lookup became OwnerId = null and rejected the record.
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{ 'Name' => 'Blank Owner', 'OwnerId' => '' }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account', new List<String>{ 'OwnerId' });
            System.assertEquals(UserInfo.getUserId(), created.OwnerId, 'Salesforce applies its normal owner default.');
        }
    }

    @IsTest
    static void testVisitorSuppliedOwnerIsNeverUsed() {
        System.runAs(getRunAsUser()) {
            Id someoneElse = [SELECT Id FROM User WHERE Id != :UserInfo.getUserId() AND IsActive = true LIMIT 1].Id;

            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{
                'Name' => 'Forged Owner',
                'OwnerId' => String.valueOf(someoneElse)
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account', new List<String>{ 'OwnerId' });
            System.assertNotEquals(someoneElse, created.OwnerId, 'A visitor-supplied Owner Id must never be used.');
        }
    }

    @IsTest
    static void testChoiceKeyIsMappedToTheConfiguredRecord() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{ 'Name' => 'Child Acc', 'ParentId' => 'o1' }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account', new List<String>{ 'ParentId' });
            System.assertEquals(accountId('Parent Acc'), created.ParentId);
        }
    }

    @IsTest
    static void testBlankChoiceLeavesTheLookupEmpty() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{ 'Name' => 'No Parent', 'ParentId' => '' }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account', new List<String>{ 'ParentId' });
            System.assertEquals(null, created.ParentId);
        }
    }

    @IsTest
    static void testRawRecordIdIsNotAValidChoice() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, payloadBoth(new Map<String, Object>{
                'Name' => 'Raw Id',
                'ParentId' => String.valueOf(accountId('Original Acc'))
            }));

            assertRejected(saved, 'Invalid selection for ParentId');
        }
    }

    @IsTest
    static void testFixedRecordIsAppliedAndVisitorValueIgnored() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_FIXED, payloadBoth(new Map<String, Object>{
                'Name' => 'Fixed Child',
                'ParentId' => String.valueOf(accountId('Original Acc'))
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Account created = (Account) createdRecord(saved, 'Account', new List<String>{ 'ParentId' });
            System.assertEquals(accountId('Parent Acc'), created.ParentId, 'The configured record wins over anything sent.');
        }
    }

    @IsTest
    static void testConfiguredRecordOfTheWrongObjectIsRejected() {
        System.runAs(getRunAsUser()) {
            Form__c broken = new Form__c(
                Name = 'WrongTarget',
                Object_API_Name__c = 'Account',
                Field_Config__c = JSON.serialize(new List<Object>{
                    field('Name', 'STRING'),
                    lookupField('ParentId', new Map<String, Object>{
                        'mode' => 'fixed',
                        'record' => new Map<String, Object>{ 'id' => String.valueOf(UserInfo.getUserId()) }
                    })
                })
            );
            insert broken;

            Form_Submission__c saved = submit('WrongTarget', payloadBoth(new Map<String, Object>{ 'Name' => 'x' }));

            assertRejected(saved, 'configured for ParentId is not valid');
        }
    }

    // ============================================================
    // Failures are recorded, not thrown
    // ============================================================

    @IsTest
    static void testRecordRejectedBySalesforceIsStoredAsTheSubmissionError() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_CONTACT, payloadBoth(new Map<String, Object>{ 'FirstName' => 'No Last Name' }));

            assertRejected(saved, 'Required fields are missing');
        }
    }

    @IsTest
    static void testOneBadSubmissionDoesNotBlockTheOthers() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c good = makeSubmission(formId(FORM_ACCOUNT), payloadBoth(new Map<String, Object>{ 'Name' => 'Good One' }));
            Form_Submission__c bad = makeSubmission(formId(FORM_CONTACT), payloadBoth(new Map<String, Object>{ 'FirstName' => 'Bad' }));

            Test.startTest();
            Database.SaveResult[] results = Database.insert(new List<Form_Submission__c>{ good, bad }, false);
            Test.stopTest();

            System.assert(results[0].isSuccess() && results[1].isSuccess(), 'Both submissions are stored.');
            System.assert(String.isBlank(reloadSub(results[0].getId()).Error_Message__c));
            System.assertEquals(1, trackingCountForSub(results[0].getId()));
            System.assert(String.isNotBlank(reloadSub(results[1].getId()).Error_Message__c));
        }
    }

    // ============================================================
    // Existing outcome checks
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
                new Form_Submission__c(Form__c = formId(FORM_ACCOUNT)),
                new Form_Submission__c(Payload_JSON__c = payloadBoth(new Map<String, Object>{ 'Name' => 'X' }))
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

            Form_Submission__c saved = submit('NoObjForm', payloadBoth(new Map<String, Object>{ 'Name' => 'Test Acc' }));

            assertRejected(saved, 'No access to Form__c.Object_API_Name__c');
        }
    }

    @IsTest
    static void testUnknownObjectOutcome() {
        System.runAs(getRunAsUser()) {
            insert new Form__c(Name = 'BadForm', Object_API_Name__c = 'NonExistentObject__c');

            Form_Submission__c saved = submit('BadForm', payloadBoth(new Map<String, Object>{ 'Name' => 'Test Acc' }));

            assertRejected(saved, 'invalid Object_API_Name__c');
        }
    }

    @IsTest
    static void testInvalidJsonOutcome() {
        System.runAs(getRunAsUser()) {
            assertRejected(submit(FORM_ACCOUNT, 'Not JSON'), 'Invalid JSON payload');
        }
    }

    @IsTest
    static void testNonObjectJsonOutcome() {
        System.runAs(getRunAsUser()) {
            assertRejected(submit(FORM_ACCOUNT, '[]'), 'Payload must be a JSON object');
        }
    }

    @IsTest
    static void testEmptyPayloadOutcome() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_ACCOUNT, '{}');

            // Account requires a Name, so Salesforce rejects the empty record.
            System.assert(String.isNotBlank(saved.Error_Message__c), 'An empty submission must be reported as an error.');
        }
    }

    @IsTest
    static void testLongPayloadOutcome() {
        System.runAs(getRunAsUser()) {
            String longPayload = '{"Name":"' + 'x'.repeat(131080) + '"}';

            Test.startTest();
            Database.SaveResult sr = Database.insert(makeSubmission(formId(FORM_ACCOUNT), longPayload), false);
            Test.stopTest();

            // Either the field length refuses the insert, or the processor rejects the payload.
            if (sr.isSuccess()) {
                assertRejected(reloadSub(sr.getId()), 'exceeds maximum allowed size');
            }
        }
    }

    // ============================================================
    // Typed inserts
    // ============================================================

    @IsTest
    static void testSuccessfulContactInsert() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_CONTACT, payloadBoth(new Map<String, Object>{
                'FirstName' => 'Test',
                'LastName' => 'Contact',
                'Birthdate' => '1990-01-01',
                'Email' => 'test@contact.com'
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Contact created = (Contact) createdRecord(saved, 'Contact', new List<String>{ 'FirstName', 'LastName', 'Birthdate', 'Email' });
            System.assertEquals('Contact', created.LastName);
            System.assertEquals(Date.valueOf('1990-01-01'), created.Birthdate);
            System.assertEquals('test@contact.com', created.Email);
        }
    }

    @IsTest
    static void testSuccessfulOpportunityInsert() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_OPP, payloadBoth(new Map<String, Object>{
                'Name' => 'Test Opp',
                'CloseDate' => '2024-01-01',
                'StageName' => 'Prospecting',
                'Amount' => 5000.5,
                'Probability' => 50
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Opportunity created = (Opportunity) createdRecord(saved, 'Opportunity', new List<String>{ 'Name', 'Amount', 'CloseDate' });
            System.assertEquals('Test Opp', created.Name);
            System.assertEquals(5000.5, created.Amount);
        }
    }

    @IsTest
    static void testSuccessfulEventInsert() {
        System.runAs(getRunAsUser()) {
            Form_Submission__c saved = submit(FORM_EVENT, payloadBoth(new Map<String, Object>{
                'Subject' => 'Test Event',
                'StartDateTime' => '2024-01-01T12:00:00Z',
                'EndDateTime' => '2024-01-01T13:00:00Z'
            }));

            System.assert(String.isBlank(saved.Error_Message__c), 'Unexpected error: ' + saved.Error_Message__c);
            Event created = (Event) createdRecord(saved, 'Event', new List<String>{ 'Subject', 'StartDateTime' });
            System.assertEquals('Test Event', created.Subject);
            System.assertNotEquals(null, created.StartDateTime);
        }
    }

    // ============================================================
    // Value conversion
    // ============================================================

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

            Id accId = accountId('Original Acc');
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
            Decimal currencyVal = (Decimal) FormSubmissionProcessor.convertValue('50000.75', fdCurrency);
            Test.stopTest();

            System.assertEquals(50000.75, currencyVal, 'Currency should convert to Decimal correctly.');
        }
    }
}
