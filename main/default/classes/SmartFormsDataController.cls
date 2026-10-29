/**
 * @description Read-only data provider for the Smart Forms & Surveys (native) app shell (Forms and Submissions tabs).
 *              Declared with sharing; every query uses WITH USER_MODE so object permissions,
 *              field-level security and sharing rules of the running user are enforced.
 *              Payload content originates from anonymous visitors and is returned verbatim as
 *              data - clients must render it as text only.
 *
 *              Callers without access to the objects/fields receive an AuraHandledException that
 *              explains how to get access, instead of a raw query error.
 *
 *              A submission is considered failed when Error_Message__c is populated (this is
 *              how FormSubmissionProcessor reports failures; Status__c is not maintained).
 *              Long text fields cannot be filtered in SOQL, so the Submissions list reads the
 *              latest MAX_ROWS submissions and the client filters them by hasError.
 */
public with sharing class SmartFormsDataController {

    @TestVisible
    private static final Integer MAX_ROWS = 200;

    /**
     * @description Form row for the Forms tab. fieldConfig is only populated by getFormDetail.
     */
    public class FormSummary {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String objectLabel;
        @AuraEnabled public Decimal version;
        @AuraEnabled public String status;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Boolean isPublic;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public String fieldConfig;
    }

    /**
     * @description Record created or updated by a submission.
     */
    public class RelatedRecord {
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String objectLabel;
        @AuraEnabled public String recordId;
        @AuraEnabled public String action;
    }

    /**
     * @description Submission row for the Submissions tab.
     */
    public class SubmissionSummary {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public Id formId;
        @AuraEnabled public String formName;
        @AuraEnabled public Boolean hasError;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public RelatedRecord firstRecord;
    }

    /**
     * @description Full submission view: payload, error and related records.
     */
    public class SubmissionDetail {
        @AuraEnabled public SubmissionSummary summary;
        @AuraEnabled public String payloadJson;
        @AuraEnabled public String errorMessage;
        @AuraEnabled public List<RelatedRecord> records = new List<RelatedRecord>();
    }

    /**
     * @description Returns the configured public form base URL (site URL ending in "?id=").
     *              Delegates to FormBuilderSettingsService so callers need access to this class only.
     * @return The base URL, or an empty string when it is not configured.
     */
    @AuraEnabled(cacheable=true)
    public static String getPublicFormBaseUrl() {
        return FormBuilderSettingsService.getPublicFormBaseUrl();
    }

    /**
     * @description Lists saved forms, newest first.
     * @return Up to MAX_ROWS forms visible to the current user.
     */
    @AuraEnabled
    public static List<FormSummary> getForms() {
        List<FormSummary> result = new List<FormSummary>();
        List<Form__c> rows;
        try {
            rows = [
                SELECT Id, Name, Object_API_Name__c, Version__c, Status__c,
                       Active__c, Is_Public__c, CreatedDate
                FROM Form__c
                WITH USER_MODE
                ORDER BY CreatedDate DESC
                LIMIT :MAX_ROWS
            ];
        } catch (QueryException e) {
            throw accessDenied();
        }
        Map<String, Schema.SObjectType> describeMap = Schema.getGlobalDescribe();
        for (Form__c f : rows) {
            result.add(toFormSummary(f, describeMap));
        }
        return result;
    }

    /**
     * @description Returns one form including its saved field configuration JSON.
     * @param formId Form__c Id.
     * @return The form, or null when the Id is blank or the form is not visible.
     */
    @AuraEnabled
    public static FormSummary getFormDetail(Id formId) {
        if (formId == null) {
            return null;
        }
        List<Form__c> rows;
        try {
            rows = [
                SELECT Id, Name, Object_API_Name__c, Version__c, Status__c,
                       Active__c, Is_Public__c, CreatedDate, Field_Config__c
                FROM Form__c
                WHERE Id = :formId
                WITH USER_MODE
                LIMIT 1
            ];
        } catch (QueryException e) {
            throw accessDenied();
        }
        if (rows.isEmpty()) {
            return null;
        }
        FormSummary summary = toFormSummary(rows[0], Schema.getGlobalDescribe());
        summary.fieldConfig = rows[0].Field_Config__c;
        return summary;
    }

    /**
     * @description Lists the latest submissions, newest first.
     * @return Up to MAX_ROWS submissions visible to the current user; hasError marks failed ones.
     */
    @AuraEnabled
    public static List<SubmissionSummary> getSubmissions() {
        List<SubmissionSummary> result = new List<SubmissionSummary>();
        List<Form_Submission__c> rows = loadLatestSubmissions();
        if (rows.isEmpty()) {
            return result;
        }
        Map<String, Schema.SObjectType> describeMap = Schema.getGlobalDescribe();
        Map<Id, RelatedRecord> firstRecords = loadFirstRecords(rows, describeMap);
        for (Form_Submission__c row : rows) {
            SubmissionSummary s = new SubmissionSummary();
            s.id = row.Id;
            s.name = row.Name;
            s.formId = row.Form__c;
            s.formName = row.Form__r?.Name;
            s.hasError = String.isNotBlank(row.Error_Message__c);
            s.createdDate = row.CreatedDate;
            s.firstRecord = firstRecords.get(row.Id);
            result.add(s);
        }
        return result;
    }

    /**
     * @description Returns one submission with its payload, error message and related records.
     * @param submissionId Form_Submission__c Id.
     * @return The submission, or null when the Id is blank or the record is not visible.
     */
    @AuraEnabled
    public static SubmissionDetail getSubmissionDetail(Id submissionId) {
        if (submissionId == null) {
            return null;
        }
        List<Form_Submission__c> rows;
        try {
            rows = [
                SELECT Id, Name, Form__c, Form__r.Name, CreatedDate,
                       Payload_JSON__c, Error_Message__c
                FROM Form_Submission__c
                WHERE Id = :submissionId
                WITH USER_MODE
                LIMIT 1
            ];
        } catch (QueryException e) {
            throw accessDenied();
        }
        if (rows.isEmpty()) {
            return null;
        }
        Form_Submission__c row = rows[0];
        SubmissionDetail detail = new SubmissionDetail();
        detail.summary = new SubmissionSummary();
        detail.summary.id = row.Id;
        detail.summary.name = row.Name;
        detail.summary.formId = row.Form__c;
        detail.summary.formName = row.Form__r?.Name;
        detail.summary.hasError = String.isNotBlank(row.Error_Message__c);
        detail.summary.createdDate = row.CreatedDate;
        detail.payloadJson = row.Payload_JSON__c;
        detail.errorMessage = row.Error_Message__c;
        detail.records = loadRecords(new Set<Id>{ submissionId }, Schema.getGlobalDescribe()).get(submissionId);
        if (detail.records == null) {
            detail.records = new List<RelatedRecord>();
        }
        return detail;
    }

    /**
     * @description Counts failed submissions among the latest MAX_ROWS (tab badge).
     * @return Number of submissions with an error message.
     */
    @AuraEnabled
    public static Integer getErrorCount() {
        Integer failed = 0;
        for (Form_Submission__c row : loadLatestSubmissions()) {
            if (String.isNotBlank(row.Error_Message__c)) {
                failed++;
            }
        }
        return failed;
    }

    private static AuraHandledException accessDenied() {
        AuraHandledException ex = new AuraHandledException(
            'You do not have access to everything this page needs. Ask an administrator to assign the FormBuilder_Admin permission set.'
        );
        ex.setMessage(
            'You do not have access to everything this page needs. Ask an administrator to assign the FormBuilder_Admin permission set.'
        );
        return ex;
    }

    private static List<Form_Submission__c> loadLatestSubmissions() {
        try {
            return [
                SELECT Id, Name, Form__c, Form__r.Name, Error_Message__c, CreatedDate
                FROM Form_Submission__c
                WITH USER_MODE
                ORDER BY CreatedDate DESC
                LIMIT :MAX_ROWS
            ];
        } catch (QueryException e) {
            throw accessDenied();
        }
    }

    private static Map<Id, RelatedRecord> loadFirstRecords(
        List<Form_Submission__c> submissions,
        Map<String, Schema.SObjectType> describeMap
    ) {
        Map<Id, RelatedRecord> firstRecords = new Map<Id, RelatedRecord>();
        Map<Id, List<RelatedRecord>> all = loadRecords(new Map<Id, Form_Submission__c>(submissions).keySet(), describeMap);
        for (Id submissionId : all.keySet()) {
            firstRecords.put(submissionId, all.get(submissionId)[0]);
        }
        return firstRecords;
    }

    private static Map<Id, List<RelatedRecord>> loadRecords(
        Set<Id> submissionIds,
        Map<String, Schema.SObjectType> describeMap
    ) {
        Map<Id, List<RelatedRecord>> bySubmission = new Map<Id, List<RelatedRecord>>();
        List<Form_Submission_Record__c> rows;
        try {
            rows = [
                SELECT Form_Submission__c, Object_API_Name__c, Record_Id__c, Action__c
                FROM Form_Submission_Record__c
                WHERE Form_Submission__c IN :submissionIds
                WITH USER_MODE
                ORDER BY CreatedDate ASC
                LIMIT 2000
            ];
        } catch (QueryException e) {
            throw accessDenied();
        }
        for (Form_Submission_Record__c r : rows) {
            RelatedRecord rec = new RelatedRecord();
            rec.objectApiName = r.Object_API_Name__c;
            rec.objectLabel = labelFor(r.Object_API_Name__c, describeMap);
            rec.recordId = r.Record_Id__c;
            rec.action = r.Action__c;
            if (!bySubmission.containsKey(r.Form_Submission__c)) {
                bySubmission.put(r.Form_Submission__c, new List<RelatedRecord>());
            }
            bySubmission.get(r.Form_Submission__c).add(rec);
        }
        return bySubmission;
    }

    private static FormSummary toFormSummary(Form__c f, Map<String, Schema.SObjectType> describeMap) {
        FormSummary s = new FormSummary();
        s.id = f.Id;
        s.name = f.Name;
        s.objectApiName = f.Object_API_Name__c;
        s.objectLabel = labelFor(f.Object_API_Name__c, describeMap);
        s.version = f.Version__c;
        s.status = f.Status__c;
        s.isActive = f.Active__c;
        s.isPublic = f.Is_Public__c;
        s.createdDate = f.CreatedDate;
        return s;
    }

    private static String labelFor(String objectApiName, Map<String, Schema.SObjectType> describeMap) {
        if (String.isBlank(objectApiName)) {
            return '';
        }
        Schema.SObjectType objType = describeMap.get(objectApiName.trim().toLowerCase());
        return objType == null ? objectApiName : objType.getDescribe().getLabel();
    }
}
