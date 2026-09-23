/**
 * @description Service class for retrieving Form Builder application settings
 *              stored in the Form_Builder_Settings__c custom setting.
 */
public with sharing class FormBuilderSettingsService {

    /**
     * @description Returns the configured public form base URL from org-level
     *              Form_Builder_Settings__c hierarchy custom setting.
     * @return The public form base URL string, or an empty string if not configured.
     */
    @AuraEnabled(cacheable=true)
    public static String getPublicFormBaseUrl() {
        String urlVal = '';

        // Hierarchy Custom Setting
        Form_Builder_Settings__c orgDefaults = Form_Builder_Settings__c.getOrgDefaults();
        if (orgDefaults != null && orgDefaults.Public_Form_Base_Url__c != null) {
            urlVal = String.valueOf(orgDefaults.Public_Form_Base_Url__c);
        }

        return urlVal == null ? '' : urlVal.trim();
    }
}