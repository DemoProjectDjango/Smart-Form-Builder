/**
 * @description Save-time checks for a form's field configuration (the JSON the Form Builder stores
 *              in Form__c.Field_Config__c). Rejects lookup settings that could not be applied safely:
 *              a fixed record or choice that is missing, too many choices, or a record that is not of
 *              an object the lookup can point to.
 */
public inherited sharing class FormConfigValidator {

    /**
     * @description Validates a configuration before it is saved.
     * @param configJson The JSON the Form Builder is about to store.
     * @return An error message, or null when the configuration is acceptable.
     *         A configuration that is not a field list (older shape) is accepted as is.
     */
    public static String validate(String configJson) {
        if (String.isBlank(configJson)) {
            return null;
        }
        try {
            JSON.deserializeUntyped(configJson);
        } catch (JSONException e) {
            return 'The field configuration is not valid JSON.';
        }
        for (FormFieldConfig.Field f : FormFieldConfig.parseAll(configJson)) {
            if (f == null) {
                return 'Every configured field needs an API name.';
            }
            String error = validateLookup(f);
            if (error != null) {
                return error;
            }
        }
        return null;
    }

    private static String validateLookup(FormFieldConfig.Field f) {
        if (f.lookupMode == null) {
            return null;
        }
        if (f.lookupMode == FormFieldConfig.MODE_FIXED) {
            return matchesReference(f.fixedId, f.referenceTo)
                ? null
                : 'Choose a valid record for the lookup field ' + f.apiName + '.';
        }
        Integer count = f.choices.size();
        if (count == 0 || count > FormFieldConfig.MAX_CHOICES) {
            return 'Choose between 1 and ' + FormFieldConfig.MAX_CHOICES + ' records for the lookup field ' + f.apiName + '.';
        }
        for (Id choiceId : f.choices.values()) {
            if (!matchesReference(choiceId, f.referenceTo)) {
                return 'A selected record for ' + f.apiName + ' is not valid.';
            }
        }
        return null;
    }

    /**
     * @description True when the record Id belongs to one of the objects the lookup points to.
     *              When the configuration lists no target objects the check is skipped.
     * @param recordId The record to check.
     * @param referenceTo API names of the objects the lookup can point to.
     * @return Whether the record is acceptable for the lookup.
     */
    public static Boolean matchesReference(Id recordId, List<String> referenceTo) {
        if (recordId == null) {
            return false;
        }
        if (referenceTo == null || referenceTo.isEmpty()) {
            return true;
        }
        String objectName = String.valueOf(recordId.getSobjectType());
        for (String target : referenceTo) {
            if (objectName.equalsIgnoreCase(target)) {
                return true;
            }
        }
        return false;
    }
}
