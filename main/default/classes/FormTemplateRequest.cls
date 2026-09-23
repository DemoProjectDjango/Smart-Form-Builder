/**
 * @description Data transfer object for form template save requests.
 *              Carries all fields required to create or update a Form__c record.
 */
public class FormTemplateRequest {
    /** @description Display name of the form. */
    @AuraEnabled public String name;
    /** @description Raw HTML template content. */
    @AuraEnabled public String html;
    /** @description Raw CSS template content. */
    @AuraEnabled public String css;
    /** @description Raw JavaScript template content. */
    @AuraEnabled public String js;
    /** @description JSON string of field dependency rules. */
    @AuraEnabled public String fieldDependenciesJson;
    /** @description API name of the target Salesforce object. */
    @AuraEnabled public String objectApiName;
    /** @description JSON string of field configuration. */
    @AuraEnabled public String fieldConfigJson;
    /** @description Id of an existing Form__c record to update, or null for create. */
    @AuraEnabled public Id formId;
}