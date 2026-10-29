/**
 * @description Record search for the Form Builder's lookup field settings (fixed record and
 *              selected choices). Used by admins only.
 *
 *              Runs with sharing and WITH USER_MODE semantics (Database.queryWithBinds with
 *              AccessLevel.USER_MODE), so an admin only finds records they can see. The object
 *              and field names used to build the query come from schema describe results, never
 *              from the caller; the search text is passed as a bind variable.
 */
public with sharing class LookupRecordSearchController {

    @TestVisible
    private static final Integer MAX_RESULTS = 20;

    /**
     * @description One search hit.
     */
    public class RecordOption {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
    }

    /**
     * @description Finds records of an object by name.
     * @param objectApiName API name of the object the lookup points to.
     * @param searchTerm Text to find in the record name; blank lists the first records by name.
     * @return Up to MAX_RESULTS records visible to the current user.
     */
    @AuraEnabled
    public static List<RecordOption> searchRecords(String objectApiName, String searchTerm) {
        List<RecordOption> result = new List<RecordOption>();
        Schema.DescribeSObjectResult objDescribe = describe(objectApiName);
        String nameField = objDescribe == null ? null : nameFieldOf(objDescribe);
        if (nameField == null) {
            return result;
        }

        String term = String.isBlank(searchTerm) ? '' : searchTerm.trim();
        Map<String, Object> binds = new Map<String, Object>();
        if (term != '') {
            binds.put('pattern', '%' + escapeLike(term) + '%');
        }

        try {
            for (SObject row : Database.queryWithBinds(buildQuery(objDescribe.getName(), nameField, term != ''), binds, AccessLevel.USER_MODE)) {
                RecordOption option = new RecordOption();
                option.id = row.Id;
                option.name = String.valueOf(row.get(nameField));
                result.add(option);
            }
        } catch (QueryException e) {
            AuraHandledException ex = new AuraHandledException(
                'You do not have access to search these records.'
            );
            ex.setMessage('You do not have access to search these records.');
            throw ex;
        }
        return result;
    }

    private static Schema.DescribeSObjectResult describe(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            return null;
        }
        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName.trim().toLowerCase());
        Schema.DescribeSObjectResult result = objType == null ? null : objType.getDescribe();
        return result != null && result.isAccessible() ? result : null;
    }

    // Object and field names come from describe results; only the search text is a bind variable.
    private static String buildQuery(String objectName, String nameField, Boolean filtered) {
        String safeObject = String.escapeSingleQuotes(objectName);
        String safeName = String.escapeSingleQuotes(nameField);
        return 'SELECT Id, ' + safeName + ' FROM ' + safeObject
            + (filtered ? ' WHERE ' + safeName + ' LIKE :pattern' : '')
            + ' ORDER BY ' + safeName + ' LIMIT ' + MAX_RESULTS;
    }

    private static String nameFieldOf(Schema.DescribeSObjectResult objDescribe) {
        for (Schema.SObjectField field : objDescribe.fields.getMap().values()) {
            Schema.DescribeFieldResult fd = field.getDescribe();
            if (fd.isNameField()) {
                return fd.getName();
            }
        }
        return null;
    }

    private static String escapeLike(String text) {
        return text.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_');
    }
}
