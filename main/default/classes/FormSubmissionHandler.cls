/**
 * @description Trigger handler entry for Form_Submission__c after-insert.
 */
public without sharing class FormSubmissionHandler {

    /**
     * @description Recursion guard — prevents the handler from firing more than once
     *              per transaction in case of trigger re-entry.
     */
    private static Boolean hasRun = false;

    /**
     * @description Entry point for after-insert trigger.
     * @param submissions Trigger.new list of Form_Submission__c.
     */
    public static void handleAfterInsert(List<Form_Submission__c> submissions) {
        if (hasRun) {
            return;
        }
        hasRun = true;
        FormSubmissionProcessor.processAfterInsert(submissions);
    }
}