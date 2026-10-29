@SuppressWarnings('PMD.CognitiveComplexity, PMD.CyclomaticComplexity')
public with sharing class FormSubmissionProcessor {

    private static final Integer MAX_ERROR_LEN = 131072;
    private static final Integer MAX_PAYLOAD_FIELDS = 200;
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

        Map<Id, Form__c> fetchForms(Set<Id> formIds) {
            Map<Id, Form__c> outMap = new Map<Id, Form__c>();
            if (formIds == null || formIds.isEmpty()) { return outMap; }
            for (Form__c f : [
                SELECT Id, Object_API_Name__c, Field_Config__c
                FROM Form__c
                WHERE Id IN :formIds
                WITH SYSTEM_MODE
            ]) {
                if (f == null || String.isBlank(f.Object_API_Name__c)) { continue; }
                outMap.put(f.Id, f);
            }
            return outMap;
        }

        // Not all-or-none: a rejected record is reported per record (and stored as the
        // submission's error message) instead of throwing out of the trigger.
        Database.SaveResult[] executeTargetInsert(List<SObject> records) {
            return Database.insert(records, false, AccessLevel.SYSTEM_MODE);
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
        public Id targetRecordId;
        public SObject record;
        public String errorMessage;
    }

    private class DmlContext {
        public Map<String, Boolean> canCreateByObj = new Map<String, Boolean>();
        public List<WorkItem> insertItems   = new List<WorkItem>();
        public List<SObject>  insertRecords = new List<SObject>();
    }

    // Everything needed to turn one submission into a record.
    private class BuildContext {
        public Map<Id, String> formToObject;
        public Map<Id, Map<String, FormFieldConfig.Field>> configByForm;
        public Map<String, Schema.SObjectType> typeByName;
    }

    // One configured field of the record being built.
    private class FieldTarget {
        public SObject record;
        public String fieldName;
        public Schema.DescribeFieldResult describe;
        public FormFieldConfig.Field config;
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    public static void processAfterInsert(List<Form_Submission__c> submissions) {
        if (submissions == null || submissions.isEmpty()) { return; }

        List<Form_Submission__c> candidates = filterCandidates(submissions);
        if (candidates.isEmpty()) { return; }

        Set<Id> formIds = collectFormIds(candidates);
        Map<Id, Form__c> forms = exec.fetchForms(formIds);

        if (forms.isEmpty()) {
            writeSameError(candidates, 'No access to Form__c.Object_API_Name__c or forms not found.');
            return;
        }

        Map<Id, String> formToObject = new Map<Id, String>();
        Map<Id, Map<String, FormFieldConfig.Field>> configByForm = new Map<Id, Map<String, FormFieldConfig.Field>>();
        for (Id fid : forms.keySet()) {
            String canon = canonicalObjectApiName(forms.get(fid).Object_API_Name__c.trim());
            if (String.isNotBlank(canon)) {
                formToObject.put(fid, canon);
                configByForm.put(fid, FormFieldConfig.parse(forms.get(fid).Field_Config__c));
            }
        }

        if (formToObject.isEmpty()) {
            writeSameError(candidates, 'Forms have invalid Object_API_Name__c values.');
            return;
        }

        List<WorkItem> items = buildWorkItems(candidates, formToObject, configByForm);
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
        Map<Id, String> formToObject,
        Map<Id, Map<String, FormFieldConfig.Field>> configByForm
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
        BuildContext ctx = new BuildContext();
        ctx.formToObject = formToObject;
        ctx.configByForm = configByForm;
        ctx.typeByName = typeByName;
        for (Form_Submission__c sub : candidates) {
            items.add(buildSingleWorkItem(sub, ctx));
        }
        return items;
    }

    private static WorkItem buildSingleWorkItem(Form_Submission__c sub, BuildContext ctx) {
        WorkItem wi = new WorkItem();
        wi.submissionId = (sub == null) ? null : sub.Id;

        if (sub == null || !ctx.formToObject.containsKey(sub.Form__c)) {
            wi.errorMessage = 'No matching form or object mapping.';
            return wi;
        }

        wi.objectApiName = ctx.formToObject.get(sub.Form__c);

        if (!ctx.typeByName.containsKey(wi.objectApiName)) {
            wi.errorMessage = 'Unknown or inaccessible object: ' + wi.objectApiName;
            return wi;
        }

        if (String.isBlank(sub.Payload_JSON__c) || sub.Payload_JSON__c.length() > MAX_ERROR_LEN) {
            wi.errorMessage = 'Payload is missing or exceeds maximum allowed size.';
            return wi;
        }

        Map<String, Object> payload = readPayload(sub.Payload_JSON__c, wi);
        if (payload == null) { return wi; }

        Map<String, FormFieldConfig.Field> config = ctx.configByForm.get(sub.Form__c);
        Map<String, Object> fields = submittedFields(payload);
        wi.errorMessage = checkSubmission(config, payload, fields);
        if (String.isNotBlank(wi.errorMessage)) { return wi; }

        wi.record = ctx.typeByName.get(wi.objectApiName).newSObject();
        wi.errorMessage = applyPayloadFields(wi, fields, config);
        return wi;
    }

    // Parses the payload; on failure records the reason on the work item and returns null.
    private static Map<String, Object> readPayload(String payloadJson, WorkItem wi) {
        try {
            Object raw = JSON.deserializeUntyped(payloadJson);
            if (raw instanceof Map<String, Object>) { return (Map<String, Object>) raw; }
            wi.errorMessage = 'Payload must be a JSON object.';
        } catch (Exception ex) {
            wi.errorMessage = 'Invalid JSON payload: ' + ex.getMessage();
        }
        return null;
    }

    // The visitor's answers: either the payload itself or its nested "fields" object.
    private static Map<String, Object> submittedFields(Map<String, Object> payload) {
        Object fieldsObj = payload.get('fields');
        if (fieldsObj instanceof Map<String, Object>) { return (Map<String, Object>) fieldsObj; }
        Map<String, Object> fields = payload.clone();
        fields.remove('fields');
        return fields;
    }

    // Rules every public submission must meet before any field is read. Null when acceptable.
    private static String checkSubmission(
        Map<String, FormFieldConfig.Field> config, Map<String, Object> payload, Map<String, Object> fields
    ) {
        if (config == null || config.isEmpty()) {
            return 'This form has no saved field configuration. Open it in the Form Builder and save it again.';
        }
        if (hasIdKey(payload) || hasIdKey(fields)) {
            return 'Updating existing records is not allowed from public forms.';
        }
        if (fields.size() > MAX_PAYLOAD_FIELDS) {
            return 'The submission contains too many fields.';
        }
        return null;
    }

    private static Boolean hasIdKey(Map<String, Object> values) {
        for (String key : values.keySet()) {
            if (key != null && key.trim().equalsIgnoreCase('Id')) { return true; }
        }
        return false;
    }

    // Writes only the fields the form is configured for (the allow-list). Anything else the
    // visitor sent is ignored. Lookup fields are written only from the admin's configuration:
    // a fixed record, or one of the selected choices submitted as an opaque key.
    private static String applyPayloadFields(
        WorkItem wi, Map<String, Object> payload, Map<String, FormFieldConfig.Field> config
    ) {
        Map<String, Schema.DescribeFieldResult> fieldMap = getFieldMap(wi.objectApiName);
        if (fieldMap.isEmpty()) { return null; }

        Map<String, Object> submitted = new Map<String, Object>();
        for (String key : payload.keySet()) {
            if (key != null) { submitted.put(key.trim().toLowerCase(), payload.get(key)); }
        }

        for (FormFieldConfig.Field cfg : config.values()) {
            String fieldName = canonicalFieldApiName(wi.objectApiName, cfg.apiName);
            Schema.DescribeFieldResult fd = fieldName == null ? null : fieldMap.get(fieldName);
            if (fd == null || !fd.isCreateable()) { continue; }
            FieldTarget target = new FieldTarget();
            target.record = wi.record;
            target.fieldName = fieldName;
            target.describe = fd;
            target.config = cfg;
            Object raw = submitted.get(cfg.apiName.toLowerCase());
            String error = fd.getType() == Schema.DisplayType.REFERENCE
                ? applyLookup(target, raw)
                : applyValue(target, raw);
            if (error != null) { return error; }
        }
        return null;
    }

    private static String applyValue(FieldTarget target, Object raw) {
        if (raw == null) { return null; }
        if (!isAllowedPicklistValue(raw, target)) {
            return 'Invalid value for ' + target.config.apiName + '.';
        }
        try {
            target.record.put(target.fieldName, convertValue(raw, target.describe));
        } catch (Exception ex) {
            return 'Failed to set field ' + target.config.apiName + ': ' + ex.getMessage();
        }
        return null;
    }

    private static Boolean isAllowedPicklistValue(Object raw, FieldTarget target) {
        Schema.DisplayType t = target.describe.getType();
        if ((t != Schema.DisplayType.PICKLIST && t != Schema.DisplayType.MULTIPICKLIST) || target.config.picklistValues.isEmpty()) {
            return true;
        }
        String text = raw instanceof List<Object> ? toMultiPicklist(raw) : String.valueOf(raw);
        if (String.isBlank(text)) { return true; }
        List<String> parts = t == Schema.DisplayType.MULTIPICKLIST ? text.split(';') : new List<String>{ text };
        for (String part : parts) {
            if (!target.config.picklistValues.contains(part.trim())) { return false; }
        }
        return true;
    }

    private static String applyLookup(FieldTarget target, Object raw) {
        FormFieldConfig.Field cfg = target.config;
        Id chosen;
        if (cfg.lookupMode == FormFieldConfig.MODE_FIXED) {
            chosen = cfg.fixedId;
        } else if (cfg.lookupMode == FormFieldConfig.MODE_CHOICES) {
            String key = raw == null ? null : String.valueOf(raw).trim();
            if (String.isBlank(key)) { return null; }
            chosen = cfg.choices.get(key);
            if (chosen == null) { return 'Invalid selection for ' + cfg.apiName + '.'; }
        } else {
            // Not configured: the field is hidden from visitors, so nothing they send is used.
            return null;
        }
        if (chosen == null || !referencesTarget(target.describe, chosen)) {
            return 'The record configured for ' + cfg.apiName + ' is not valid.';
        }
        target.record.put(target.fieldName, chosen);
        return null;
    }

    private static Boolean referencesTarget(Schema.DescribeFieldResult fd, Id chosen) {
        for (Schema.SObjectType allowed : fd.getReferenceTo()) {
            if (allowed == chosen.getSobjectType()) { return true; }
        }
        return false;
    }

    // ── DML ───────────────────────────────────────────────────────────────────

    private static void runTargetDml(List<WorkItem> items) {
        if (items == null || items.isEmpty()) { return; }
        DmlContext ctx = new DmlContext();
        for (WorkItem wi : items) {
            if (!isDmlReady(wi)) { continue; }
            if (!canOperate(wi.objectApiName, ctx.canCreateByObj)) {
                wi.errorMessage = 'Unknown or inaccessible object for insert: ' + wi.objectApiName;
                continue;
            }
            ctx.insertItems.add(wi);
            ctx.insertRecords.add(wi.record);
        }
        if (!ctx.insertRecords.isEmpty()) {
            applySaveResults(ctx.insertItems, exec.executeTargetInsert(ctx.insertRecords));
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

    private static void applySaveResults(List<WorkItem> alignedItems, Database.SaveResult[] results) {
        if (alignedItems == null || results == null) { return; }
        Integer size = Math.min(alignedItems.size(), results.size());
        for (Integer i = 0; i < size; i++) {
            WorkItem wi = alignedItems[i];
            Database.SaveResult sr = results[i];
            if (wi == null) { continue; }
            if (sr != null && sr.isSuccess()) {
                wi.targetRecordId = sr.getId();
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
            tr.Action__c          = 'Created';
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