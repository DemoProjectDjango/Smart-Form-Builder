/**
 * @description Metadata helper service for the Form Editor.
 * Centralizes describe logic to keep the controller thin and reduce cyclomatic complexity.
 */
public with sharing class FormEditorMetadataService {

    /**
     * @description Lists createable and accessible sObjects for selection in the editor.
     * @return List of maps with keys: label, name.
     */
    public static List<Map<String, String>> fetchObjectOptions() {
        List<Map<String, String>> objectOptions = new List<Map<String, String>>();

        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
        List<String> objectNames = new List<String>(globalDescribe.keySet());
        objectNames.sort();

        for (String objName : objectNames) {
            Schema.SObjectType objType = globalDescribe.get(objName);
            if (objType == null) {
                continue;
            }

            Schema.DescribeSObjectResult d = objType.getDescribe();
            if (d == null) {
                continue;
            }
            if (!d.isAccessible() || !d.isCreateable()) {
                continue;
            }

            objectOptions.add(new Map<String, String>{
                'label' => d.getLabel() + ' (' + objName + ')',
                'name'  => objName
            });
        }

        return objectOptions;
    }

    /**
     * @description Returns createable/updateable non-calculated fields for a given sObject.
     * Includes picklist values and a "required on create" heuristic.
     * @param objectName API name of the sObject (e.g., Account).
     * @return List of field descriptor maps.
     */
    public static List<Map<String, Object>> fetchFieldsForObject(String objectName) {
        List<Map<String, Object>> fields = new List<Map<String, Object>>();
        if (String.isBlank(objectName)) {
            return fields;
        }

        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectName);
        if (objType == null) {
            return fields;
        }

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        if (objDescribe == null || !objDescribe.isAccessible()) {
            return fields;
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();
        List<String> fieldNames = new List<String>(fieldMap.keySet());
        fieldNames.sort();

        for (String fieldName : fieldNames) {
            Schema.SObjectField sf = fieldMap.get(fieldName);
            if (sf == null) {
                continue;
            }

            Schema.DescribeFieldResult fd = sf.getDescribe();
            if (!isUsableField(fd)) {
                continue;
            }

            fields.add(buildFieldDescriptor(fieldName, fd));
        }

        return fields;
    }

    /**
     * @description Returns true if the field is suitable for create/update in the form editor.
     * @param fd Field describe result.
     * @return True if usable, otherwise false.
     */
    private static Boolean isUsableField(Schema.DescribeFieldResult fd) {
        if (fd == null || !fd.isAccessible()) {
            return false;
        }
        if (!fd.isCreateable()) {
            return false;
        }
        if (!fd.isUpdateable()) {
            return false;
        }
        if (fd.isCalculated()) {
            return false;
        }
        if (fd.isAutoNumber()) {
            return false;
        }
        return true;
    }

    /**
     * @description Builds a single field descriptor map.
     * @param fieldName API name of the field (e.g., Name).
     * @param fd Field describe result.
     * @return Field descriptor map used by the client.
     */
    private static Map<String, Object> buildFieldDescriptor(String fieldName, Schema.DescribeFieldResult fd) {
        return new Map<String, Object>{
            'label'          => fd.getLabel(),
            'name'           => fieldName,
            'type'           => String.valueOf(fd.getType()),
            'picklistValues' => buildPicklistValues(fd),
            'required'       => isRequiredOnCreate(fd),
            'referenceTo'    => buildReferenceTo(fd)
        };
    }

    /**
     * @description Builds picklist values for picklist/multipicklist fields.
     * @param fd Field describe result.
     * @return List of maps with keys: label, value.
     */
    private static List<Map<String, String>> buildPicklistValues(Schema.DescribeFieldResult fd) {
        List<Map<String, String>> picklistValues = new List<Map<String, String>>();
        if (fd == null) {
            return picklistValues;
        }

        Schema.DisplayType t = fd.getType();
        if (t != Schema.DisplayType.Picklist && t != Schema.DisplayType.MultiPicklist) {
            return picklistValues;
        }

        for (Schema.PicklistEntry entry : fd.getPicklistValues()) {
            picklistValues.add(new Map<String, String>{
                'label' => entry.getLabel(),
                'value' => entry.getValue()
            });
        }

        return picklistValues;
    }

    /**
     * @description API names of the objects a lookup field can point to (empty for other types).
     * @param fd Field describe result.
     * @return List of object API names.
     */
    private static List<String> buildReferenceTo(Schema.DescribeFieldResult fd) {
        List<String> targets = new List<String>();
        if (fd != null && fd.getType() == Schema.DisplayType.REFERENCE) {
            for (Schema.SObjectType t : fd.getReferenceTo()) {
                targets.add(String.valueOf(t));
            }
        }
        return targets;
    }

    /**
     * @description Heuristic for whether a field is required on create (client-side hint).
     * @param fd Field describe result.
     * @return True if required on create, otherwise false.
     */
    private static Boolean isRequiredOnCreate(Schema.DescribeFieldResult fd) {
        if (fd == null) {
            return false;
        }
        if (!fd.isCreateable()) {
            return false;
        }
        if (fd.isNillable()) {
            return false;
        }
        if (fd.isDefaultedOnCreate()) {
            return false;
        }
        return true;
    }
}