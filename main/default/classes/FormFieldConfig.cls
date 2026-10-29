/**
 * @description Parses the saved field configuration of a form (Form__c.Field_Config__c, a JSON
 *              array written by the Form Builder). See FormConfigValidator for save-time checks.
 *
 *              The configuration is the server-side allow-list for public submissions:
 *              only the fields listed here are ever written, and a lookup field is only
 *              written when the admin configured it as a fixed record or as a list of
 *              selected choices. Visitors never supply record Ids; a choice is submitted
 *              as an opaque key (o1, o2, ...) that is mapped to a record Id here.
 *
 *              Holds no data access of its own, so it is safe to call from any context.
 */
public inherited sharing class FormFieldConfig {

    public static final Integer MAX_CHOICES = 25;
    public static final String MODE_FIXED = 'fixed';
    public static final String MODE_CHOICES = 'choices';

    private static final Pattern CHOICE_KEY = Pattern.compile('o[0-9]{1,3}');

    /**
     * @description One configured form field.
     */
    public class Field {
        public String apiName;
        public String type;
        public Boolean required = false;
        public Set<String> picklistValues = new Set<String>();
        public List<String> referenceTo = new List<String>();
        public String lookupMode;
        public Id fixedId;
        public Map<String, Id> choices = new Map<String, Id>();
    }

    /**
     * @description Parses the stored JSON into an allow-list keyed by lower-cased API name.
     * @param configJson Form__c.Field_Config__c.
     * @return The configured fields; empty when the JSON is blank, invalid or not a field list.
     */
    public static Map<String, Field> parse(String configJson) {
        Map<String, Field> result = new Map<String, Field>();
        for (Field f : parseAll(configJson)) {
            if (f != null) {
                result.put(f.apiName.toLowerCase(), f);
            }
        }
        return result;
    }

    /**
     * @description Parses every entry of the stored JSON array.
     * @param configJson Form__c.Field_Config__c.
     * @return One entry per array item, in order; null for an item that is not a usable field.
     */
    public static List<Field> parseAll(String configJson) {
        List<Field> fields = new List<Field>();
        if (String.isBlank(configJson)) {
            return fields;
        }
        try {
            Object parsed = JSON.deserializeUntyped(configJson);
            if (parsed instanceof List<Object>) {
                for (Object item : (List<Object>) parsed) {
                    fields.add(toField(item));
                }
            }
        } catch (JSONException e) {
            return new List<Field>();
        }
        return fields;
    }

    private static Field toField(Object item) {
        if (!(item instanceof Map<String, Object>)) {
            return null;
        }
        Map<String, Object> raw = (Map<String, Object>) item;
        String apiName = stringOf(raw.get('apiName'));
        if (String.isBlank(apiName)) {
            return null;
        }
        Field f = new Field();
        f.apiName = apiName.trim();
        String type = stringOf(raw.get('type'));
        f.type = String.isBlank(type) ? null : type.toUpperCase();
        Object requiredFlag = raw.get('required');
        f.required = requiredFlag instanceof Boolean && (Boolean) requiredFlag;
        readPicklistValues(f, raw.get('picklistValues'));
        readReferenceTo(f, raw.get('referenceTo'));
        readLookup(f, raw.get('lookup'));
        return f;
    }

    private static void readPicklistValues(Field f, Object values) {
        if (!(values instanceof List<Object>)) {
            return;
        }
        for (Object v : (List<Object>) values) {
            if (v instanceof Map<String, Object>) {
                String value = stringOf(((Map<String, Object>) v).get('value'));
                if (value != null) {
                    f.picklistValues.add(value);
                }
            }
        }
    }

    private static void readReferenceTo(Field f, Object targets) {
        if (!(targets instanceof List<Object>)) {
            return;
        }
        for (Object t : (List<Object>) targets) {
            String name = stringOf(t);
            if (String.isNotBlank(name)) {
                f.referenceTo.add(name);
            }
        }
    }

    private static void readLookup(Field f, Object lookup) {
        if (!(lookup instanceof Map<String, Object>)) {
            return;
        }
        Map<String, Object> cfg = (Map<String, Object>) lookup;
        String mode = stringOf(cfg.get('mode'));
        if (mode == MODE_FIXED) {
            f.lookupMode = MODE_FIXED;
            Object record = cfg.get('record');
            if (record instanceof Map<String, Object>) {
                f.fixedId = toId(((Map<String, Object>) record).get('id'));
            }
        } else if (mode == MODE_CHOICES) {
            f.lookupMode = MODE_CHOICES;
            readChoices(f, cfg.get('choices'));
        }
    }

    private static void readChoices(Field f, Object choices) {
        if (!(choices instanceof List<Object>)) {
            return;
        }
        for (Object c : (List<Object>) choices) {
            if (!(c instanceof Map<String, Object>)) {
                continue;
            }
            Map<String, Object> choice = (Map<String, Object>) c;
            String key = stringOf(choice.get('key'));
            Id choiceId = toId(choice.get('id'));
            if (key != null && CHOICE_KEY.matcher(key).matches() && choiceId != null) {
                f.choices.put(key, choiceId);
            }
        }
    }

    private static String stringOf(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Id toId(Object value) {
        String text = stringOf(value);
        if (String.isBlank(text)) {
            return null;
        }
        try {
            return Id.valueOf(text);
        } catch (StringException e) {
            return null;
        }
    }
}
