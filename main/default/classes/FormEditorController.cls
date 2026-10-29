/**
 * @description Controller for Form Editor LWC/Aura components.
 *              Provides template CRUD, object/field describe metadata, status updates,
 *              and dependency lookups to authenticated editor LWCs.
 *              Declared with sharing — sharing rules on Form__c apply.
 *              All SOQL uses WITH USER_MODE to enforce FLS and sharing.
 */
public with sharing class FormEditorController {

    /**
     * @description Returns Form__c templates as label/value pairs (for dropdowns).
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getFormTemplates() {
        if (!Schema.sObjectType.Form__c.isAccessible()) {
            return new List<Map<String, String>>();
        }
        List<Map<String, String>> options = new List<Map<String, String>>();
        for (Form__c f : [
            SELECT Id, Name
            FROM Form__c
            WHERE Name != null
            WITH USER_MODE
            ORDER BY Name ASC
            LIMIT 200
        ]) {
            options.add(new Map<String, String>{ 'label' => f.Name, 'value' => f.Id });
        }
        return options;
    }

    /**
     * @description Fetches a single Form__c template for editor load.
     * @param formId Form__c Id.
     * @return Map of template properties, or null if no access / invalid Id.
     */
    @AuraEnabled
    public static Map<String, Object> getFormData(Id formId) {
        if (formId == null) { return null; }
        if (!Schema.sObjectType.Form__c.isAccessible()) { return null; }

        List<Form__c> results = [
            SELECT Id, Name,
                   HTML_Template__c, CSS_Template__c, JS_Template__c,
                   Field_Dependencies__c, Version__c,
                   Object_API_Name__c, Field_Config__c
            FROM Form__c
            WHERE Id = :formId
            WITH USER_MODE
            LIMIT 1
        ];

        if (results.isEmpty()) { return null; }
        Form__c f = results[0];

        return new Map<String, Object>{
            'id'            => f.Id,
            'name'          => f.Name,
            'html'          => f.HTML_Template__c,
            'css'           => f.CSS_Template__c,
            'js'            => f.JS_Template__c,
            'dependencies'  => f.Field_Dependencies__c,
            'version'       => f.Version__c,
            'objectApiName' => f.Object_API_Name__c,
            'fieldConfig'   => f.Field_Config__c
        };
    }

    /**
     * @description Lists accessible and createable sObjects for the editor object picker.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> fetchObjectOptions() {
        return FormEditorMetadataService.fetchObjectOptions();
    }

    /**
     * @description Returns createable/updateable non-calculated fields for a given sObject.
     * @param objectName API name of the sObject.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> fetchFieldsForObject(String objectName) {
        return FormEditorMetadataService.fetchFieldsForObject(objectName);
    }

    /**
     * @description Updates editable fields on Form__c (e.g. status toggles).
     * @param form Form__c record with Id and fields to update.
     */
    @AuraEnabled
    public static void updateFormStatus(Form__c form) {
        if (form == null || form.Id == null) {
            throw new AuraHandledException('Form record is missing.');
        }
        if (!Schema.sObjectType.Form__c.isUpdateable()) {
            throw new AuraHandledException('You do not have permission to update Form__c.');
        }
        try {
            update as user form;
        } catch (Exception e) {
            throw new AuraHandledException('Error updating form status: ' + e.getMessage());
        }
    }

    /**
     * @description Returns the Field_Dependencies__c JSON for a form.
     * @param formId Form__c Id.
     */
    @AuraEnabled(cacheable=true)
    public static String fetchFieldDependencies(Id formId) {
        if (formId == null) { return ''; }
        if (!Schema.sObjectType.Form__c.isAccessible()) { return ''; }

        List<Form__c> results = [
            SELECT Field_Dependencies__c
            FROM Form__c
            WHERE Id = :formId
            WITH USER_MODE
            LIMIT 1
        ];
        return results.isEmpty() ? '' : results[0].Field_Dependencies__c;
    }
}