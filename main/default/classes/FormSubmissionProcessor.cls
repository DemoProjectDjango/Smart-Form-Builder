@SuppressWarnings('PMD.CognitiveComplexity, PMD.CyclomaticComplexity')
public with sharing class FormSubmissionProcessor {

    private static final Integer MAX_ERROR_LEN = 131072;
    private static Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
    private static Map<String, Schema.DescribeSObjectResult> objectDescribeCache =
        new Map<String, Schema.DescribeSObjectResult>();
    private static Map<String, Map<String, Schema.DescribeFieldResult>> fieldDescribeCache =
        new Map<String, Map<String, Schema.DescribeFieldResult>>();

    // ── Inner executor ────────────────────────────────────────────────────────
    /**
     * @description Private without sharing inner class that handles all DML and
     *              SOQL operations requiring SYSTEM_MODE in the guest user context.
     *
     *              WHY without sharing here:
     *              When FormSubmissionProcessor runs in a trigger context initiated by
     *              a guest user, Salesforce performs cross-reference entity validation
     *              on lookup fields (e.g. Form__c on Form_Submission__c) even when
     *              AccessLevel.SYSTEM_MODE is specified. This validation respects the
     *              sharing context of the executing class. Declaring this inner class
     *              without sharing bypasses that cross-reference check, which is required
     *              for the trigger to complete successfully in the guest user context.
     *
     *              This class is private and not accessible outside FormSubmissionProcessor,
     *              limiting scope to only the operations listed below.
     */
    private without sharing class SystemModeExecutor {

        Map<Id, String> fetchFormObjectApiNames(Set<Id> formIds) {
            Map<Id, String> outMap = new Map<Id, String>();
            if (formIds == null || formIds.isEmpty()) { return outMap; }
            for (Form__c f : [
                SELECT Id, Object_API_Name__c
                FROM Form__c
                WHERE Id IN :formIds
                WITH SYSTEM_MODE
            ]) {
                if (f == null || String.isBlank(f.Object_API_Name__c)) { continue; }
                outMap.put(f.Id, f.Object_API_Name__c.trim());
            }
            return outMap;
        }

        Database.SaveResult[] executeTargetInsert(List<SObject> records) {
            return Database.insert(records, AccessLevel.SYSTEM_MODE);
        }

        Database.SaveResult[] executeTargetUpdate(List<SObject> records) {
            return Database.update(records, AccessLevel.SYSTEM_MODE);
        }

        void insertTrackingRecords(List<Form_Submission_Record__c> tracking) {
            if (!tracking.isEmpty()) {
                Database.insert(tracking, AccessLevel.SYSTEM_MODE);
            }
        }

        void updateErrorOnSubmissions(List<Form_Submission__c> updates) {
            if (!updates.isEmpty()) {
                Database.update(updates, AccessLevel.SYSTEM_MODE);
            }
        }
    }

    private static SystemModeExecutor exec = new SystemModeExecutor();

    // ── Inner data classes ────────────────────────────────────────────────────

    private class WorkItem {
        public Id submissionId;
        public String objectApiName;
        public Boolean isUpdate;
        public Id targetRecordId;
        public SObject record;
        public String errorMessage;
    }

    private class DmlContext {
        public Map<String, Boolean> canCreateByObj = new Map<String, Boolean>();
        public Map<String, Boolean> canUpdateByObj = new Map<String, Boolean>();
        public List<WorkItem> insertItems   = new List<WorkItem>();
        public List<SObject>  insertRecords = new List<SObject>();
        public List<WorkItem> updateItems   = new List<WorkItem>();
        public List<SObject>  updateRecords = new List<SObject>();
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    public static void processAfterInsert(List<Form_Submission__c> submissions) {
        if (submissions == null || submissions.isEmpty()) { return; }

        List<Form_Submission__c> candidates = filterCandidates(submissions);
        if (candidates.isEmpty()) { return; }

        Set<Id> formIds = collectFormIds(candidates);
        Map<Id, String> formToObjectRaw = exec.fetchFormObjectApiNames(formIds);

        if (formToObjectRaw.isEmpty()) {
            writeSameError(candidates, 'No access to Form__c.Object_API_Name__c or forms not found.');
            return;
        }

        Map<Id, String> formToObject = new Map<Id, String>();
        for (Id fid : formToObjectRaw.keySet()) {
            String canon = canonicalObjectApiName(formToObjectRaw.get(fid));
            if (String.isNotBlank(canon)) { formToObject.put(fid, canon); }
        }

        if (formToObject.isEmpty()) {
            writeSameError(candidates, 'Forms have invalid Object_API_Name__c values.');
            return;
        }

        List<WorkItem> items = buildWorkItems(candidates, formToObject);
        runTargetDml(items);
        insertTracking(items);
        updateSubmissionErrors(items);
    }

    // ── Filtering ─────────────────────────────────────────────────────────────

    private static List<Form_Submission__c> filterCandidates(List<Form_Submission__c> submissions) {
        List<Form_Submission__c> out = new List<Form_Submission__c>();
        for (Form_Submission__c sub : submissions) {
            if (sub == null || sub.Form__c == null || String.isBlank(sub.Payload_JSON__c)) { continue; }
            out.add(sub);
        }
        return out;
    }

    private static Set<Id> collectFormIds(List<Form_Submission__c> candidates) {
        Set<Id> ids = new Set<Id>();
        for (Form_Submission__c sub : candidates) {
            if (sub != null && sub.Form__c != null) { ids.add(sub.Form__c); }
        }
        return ids;
    }

    // ── Work item building ────────────────────────────────────────────────────

    private static List<WorkItem> buildWorkItems(
        List<Form_Submission__c> candidates,
        Map<Id, String> formToObject
    ) {
        List<WorkItem> items = new List<WorkItem>();
        Set<String> objectNames = new Set<String>();
        for (Form_Submission__c sub : candidates) {
            if (sub != null && formToObject.containsKey(sub.Form__c)) {
                objectNames.add(formToObject.get(sub.Form__c));
            }
        }
        Map<String, Schema.SObjectType> typeByName = new Map<String, Schema.SObjectType>();
        for (String name : objectNames) {
            Schema.SObjectType t = globalDescribe.get(name);
            if (t != null) { typeByName.put(name, t); }
        }
        for (Form_Submission__c sub : candidates) {
            items.add(buildSingleWorkItem(sub, formToObject, typeByName));
        }
        return items;
    }

    private static WorkItem buildSingleWorkItem(
        Form_Submission__c sub,
        Map<Id, String> formToObject,
        Map<String, Schema.SObjectType> typeByName
    ) {
        WorkItem wi = new WorkItem();
        wi.submissionId = (sub == null) ? null : sub.Id;

        if (sub == null || !formToObject.containsKey(sub.Form__c)) {
            wi.errorMessage = 'No matching form or object mapping.';
            return wi;
        }

        wi.objectApiName = formToObject.get(sub.Form__c);

        if (!typeByName.containsKey(wi.objectApiName)) {
            wi.errorMessage = 'Unknown or inaccessible object: ' + wi.objectApiName;
            return wi;
        }

        if (String.isBlank(sub.Payload_JSON__c) || sub.Payload_JSON__c.length() > MAX_ERROR_LEN) {
            wi.errorMessage = 'Payload is missing or exceeds maximum allowed size.';
            return wi;
        }

        Map<String, Object> payload;
        try {
            Object raw = JSON.deserializeUntyped(sub.Payload_JSON__c);
            if (!(raw instanceof Map<String, Object>)) {
                wi.errorMessage = 'Payload must be a JSON object.';
                return wi;
            }
            payload = (Map<String, Object>) raw;
        } catch (Exception ex) {
            wi.errorMessage = 'Invalid JSON payload: ' + ex.getMessage();
            return wi;
        }

        String recordIdStr = payload.containsKey('Id') ? String.valueOf(payload.get('Id')) : null;
        wi.isUpdate      = String.isNotBlank(recordIdStr) && recordIdStr != 'null';
        wi.targetRecordId = wi.isUpdate ? safeToId(recordIdStr) : null;

        if (wi.isUpdate && wi.targetRecordId == null) {
            wi.errorMessage = 'Payload contains an invalid record Id.';
            return wi;
        }

        Schema.SObjectType sot = typeByName.get(wi.objectApiName);
        wi.record = wi.isUpdate ? sot.newSObject(wi.targetRecordId) : sot.newSObject();

        Object fieldsObj = payload.get('fields');
        Map<String, Object> fields;
        if (fieldsObj instanceof Map<String, Object>) {
            fields = (Map<String, Object>) fieldsObj;
        } else {
            fields = payload.clone();
            fields.remove('Id');
            fields.remove('fields');
        }

        String fieldErr = applyPayloadFields(wi.record, wi.objectApiName, fields);
        if (String.isNotBlank(fieldErr)) { wi.errorMessage = fieldErr; }
        return wi;
    }

    private static String applyPayloadFields(
        SObject record, String objectApiName, Map<String, Object> payload
    ) {
        if (record == null || String.isBlank(objectApiName) || payload == null) {
            return 'Missing target record or payload.';
        }
        Map<String, Schema.DescribeFieldResult> fieldMap = getFieldMap(objectApiName);
        if (fieldMap.isEmpty()) { return null; }

        for (String rawFieldName : payload.keySet()) {
            if (rawFieldName == null || rawFieldName == 'Id' || rawFieldName == 'id') { continue; }
            String fieldName = canonicalFieldApiName(objectApiName, rawFieldName);
            if (String.isBlank(fieldName) || fieldName == 'Id') { continue; }
            Schema.DescribeFieldResult fd = fieldMap.get(fieldName);
            if (fd == null) { continue; }
            try {
                record.put(fieldName, convertValue(payload.get(rawFieldName), fd));
            } catch (Exception ex) {
                return 'Failed to set field ' + fieldName + ': ' + ex.getMessage();
            }
        }
        return null;
    }

    // ── DML ───────────────────────────────────────────────────────────────────

    private static void runTargetDml(List<WorkItem> items) {
        if (items == null || items.isEmpty()) { return; }
        DmlContext ctx = new DmlContext();
        for (WorkItem wi : items) {
            if (!isDmlReady(wi)) { continue; }
            if (wi.isUpdate) {
                if (!canOperate(wi.objectApiName, ctx.canUpdateByObj)) {
                    wi.errorMessage = 'Unknown or inaccessible object for update: ' + wi.objectApiName;
                    continue;
                }
                ctx.updateItems.add(wi);
                ctx.updateRecords.add(wi.record);
            } else {
                if (!canOperate(wi.objectApiName, ctx.canCreateByObj)) {
                    wi.errorMessage = 'Unknown or inaccessible object for insert: ' + wi.objectApiName;
                    continue;
                }
                ctx.insertItems.add(wi);
                ctx.insertRecords.add(wi.record);
            }
        }
        if (!ctx.insertRecords.isEmpty()) {
            applySaveResults(ctx.insertItems, exec.executeTargetInsert(ctx.insertRecords), false);
        }
        if (!ctx.updateRecords.isEmpty()) {
            applySaveResults(ctx.updateItems, exec.executeTargetUpdate(ctx.updateRecords), true);
        }
    }

    private static Boolean isDmlReady(WorkItem wi) {
        return wi != null && String.isBlank(wi.errorMessage) && wi.record != null && String.isNotBlank(wi.objectApiName);
    }

    private static Boolean canOperate(String objectApiName, Map<String, Boolean> cache) {
        if (String.isBlank(objectApiName)) { return false; }
        if (!cache.containsKey(objectApiName)) {
            cache.put(objectApiName, getObjectDescribe(objectApiName) != null);
        }
        return cache.get(objectApiName);
    }

    private static void applySaveResults(
        List<WorkItem> alignedItems, Database.SaveResult[] results, Boolean isUpdate
    ) {
        if (alignedItems == null || results == null) { return; }
        Integer size = Math.min(alignedItems.size(), results.size());
        for (Integer i = 0; i < size; i++) {
            WorkItem wi = alignedItems[i];
            Database.SaveResult sr = results[i];
            if (wi == null) { continue; }
            if (sr != null && sr.isSuccess()) {
                wi.targetRecordId = isUpdate ? wi.targetRecordId : sr.getId();
            } else {
                wi.errorMessage = firstError(sr);
            }
        }
    }

    private static String firstError(Database.SaveResult sr) {
        if (sr == null) { return 'Unknown DML error.'; }
        Database.Error[] errs = sr.getErrors();
        if (errs == null || errs.isEmpty() || errs[0] == null) { return 'Unknown DML error.'; }
        return String.valueOf(errs[0].getMessage());
    }

    // ── Tracking + errors ─────────────────────────────────────────────────────

    private static void insertTracking(List<WorkItem> items) {
        if (items == null || items.isEmpty()) { return; }
        List<Form_Submission_Record__c> tracking = new List<Form_Submission_Record__c>();
        for (WorkItem wi : items) {
            if (wi == null || wi.submissionId == null || String.isNotBlank(wi.errorMessage) || wi.targetRecordId == null) { continue; }
            Form_Submission_Record__c tr = new Form_Submission_Record__c();
            tr.Form_Submission__c = wi.submissionId;
            tr.Record_Id__c       = wi.targetRecordId;
            tr.Object_API_Name__c = wi.objectApiName;
            tr.Action__c          = (wi.isUpdate == true) ? 'Updated' : 'Created';
            tracking.add(tr);
        }
        exec.insertTrackingRecords(tracking);
    }

    private static void updateSubmissionErrors(List<WorkItem> items) {
        if (items == null || items.isEmpty()) { return; }
        List<Form_Submission__c> updates = new List<Form_Submission__c>();
        for (WorkItem wi : items) {
            if (wi == null || wi.submissionId == null || String.isBlank(wi.errorMessage)) { continue; }
            Form_Submission__c u = new Form_Submission__c();
            u.Id               = wi.submissionId;
            u.Error_Message__c = safeError(wi.errorMessage);
            updates.add(u);
        }
        exec.updateErrorOnSubmissions(updates);
    }

    private static void writeSameError(List<Form_Submission__c> candidates, String message) {
        if (candidates == null || candidates.isEmpty()) { return; }
        List<Form_Submission__c> updates = new List<Form_Submission__c>();
        for (Form_Submission__c sub : candidates) {
            if (sub == null || sub.Id == null) { continue; }
            Form_Submission__c u = new Form_Submission__c();
            u.Id               = sub.Id;
            u.Error_Message__c = safeError(message);
            updates.add(u);
        }
        exec.updateErrorOnSubmissions(updates);
    }

    private static String safeError(String msg) {
        return ((msg == null) ? 'Unknown error.' : msg).left(MAX_ERROR_LEN);
    }

    // ── Describe cache ────────────────────────────────────────────────────────

    private static Schema.DescribeSObjectResult getObjectDescribe(String objectApiName) {
        if (String.isBlank(objectApiName)) { return null; }
        if (!objectDescribeCache.containsKey(objectApiName)) {
            Schema.SObjectType t = globalDescribe.get(objectApiName);
            objectDescribeCache.put(objectApiName, (t == null) ? null : t.getDescribe());
        }
        return objectDescribeCache.get(objectApiName);
    }

    private static Map<String, Schema.DescribeFieldResult> getFieldMap(String objectApiName) {
        if (String.isBlank(objectApiName)) { return new Map<String, Schema.DescribeFieldResult>(); }
        if (fieldDescribeCache.containsKey(objectApiName)) { return fieldDescribeCache.get(objectApiName); }
        Map<String, Schema.DescribeFieldResult> perObj = new Map<String, Schema.DescribeFieldResult>();
        Schema.DescribeSObjectResult dsr = getObjectDescribe(objectApiName);
        if (dsr != null) {
            for (String fn : dsr.fields.getMap().keySet()) {
                Schema.SObjectField sf = dsr.fields.getMap().get(fn);
                if (sf != null) { perObj.put(fn, sf.getDescribe()); }
            }
        }
        fieldDescribeCache.put(objectApiName, perObj);
        return perObj;
    }

    // ── Canonicalization ──────────────────────────────────────────────────────

    private static String canonicalObjectApiName(String raw) {
        if (String.isBlank(raw)) { return null; }
        String trimmed = raw.trim();
        if (globalDescribe.containsKey(trimmed)) { return trimmed; }
        for (String key : globalDescribe.keySet()) {
            if (key != null && key.equalsIgnoreCase(trimmed)) { return key; }
        }
        return null;
    }

    private static String canonicalFieldApiName(String objectApiName, String rawField) {
        if (String.isBlank(objectApiName) || String.isBlank(rawField)) { return null; }
        Map<String, Schema.DescribeFieldResult> fmap = getFieldMap(objectApiName);
        String f = rawField.trim();
        if (fmap.containsKey(f)) { return f; }
        for (String key : fmap.keySet()) {
            if (key != null && key.equalsIgnoreCase(f)) { return key; }
        }
        return null;
    }

    private static Id safeToId(String idStr) {
        if (String.isBlank(idStr)) { return null; }
        try { return Id.valueOf(idStr); } catch (Exception ex) { return null; }
    }

    // ── Value conversion ──────────────────────────────────────────────────────

    @TestVisible
    private static Object convertValue(Object rawValue, Schema.DescribeFieldResult fd) {
        if (rawValue == null || fd == null) { return rawValue; }
        Schema.DisplayType t = fd.getType();
        if (t == Schema.DisplayType.BOOLEAN)     { return Boolean.valueOf(String.valueOf(rawValue)); }
        if (t == Schema.DisplayType.INTEGER)     { try { return Integer.valueOf(String.valueOf(rawValue)); } catch (Exception e) { return null; } }
        if (t == Schema.DisplayType.DOUBLE
         || t == Schema.DisplayType.CURRENCY
         || t == Schema.DisplayType.PERCENT)     { try { return Decimal.valueOf(String.valueOf(rawValue)); } catch (Exception e) { return null; } }
        if (t == Schema.DisplayType.DATE)        { try { return Date.valueOf(String.valueOf(rawValue)); } catch (Exception e) { return null; } }
        if (t == Schema.DisplayType.DATETIME)    { return parseDatetime(String.valueOf(rawValue)); }
        if (t == Schema.DisplayType.MULTIPICKLIST) { return toMultiPicklist(rawValue); }
        if (t == Schema.DisplayType.REFERENCE)   { return safeToId(String.valueOf(rawValue)); }
        return String.valueOf(rawValue);
    }

    private static String toMultiPicklist(Object rawValue) {
        if (rawValue instanceof List<Object>) {
            List<String> svals = new List<String>();
            for (Object x : (List<Object>) rawValue) { if (x != null) { svals.add(String.valueOf(x)); } }
            return String.join(svals, ';');
        }
        return String.valueOf(rawValue);
    }

    private static Datetime parseDatetime(String input) {
        if (String.isBlank(input)) { return null; }
        String s = input.trim().replace('T', ' ');
        if (s.endsWith('Z')) { s = s.substring(0, s.length() - 1); }
        Integer dotPos = s.indexOf('.');
        if (dotPos > -1) { s = s.substring(0, dotPos); }
        try { return Datetime.valueOf(s); } catch (Exception ex) { return null; }
    }
}