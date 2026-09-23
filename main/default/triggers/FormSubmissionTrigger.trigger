trigger FormSubmissionTrigger on Form_Submission__c (after insert) {
    FormSubmissionHandler.handleAfterInsert(Trigger.new);
}