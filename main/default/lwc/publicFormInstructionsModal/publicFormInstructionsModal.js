import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class PublicFormInstructionsModal extends LightningElement {
    @api open = false;

    @api siteLabel = 'PublicForm';
    @api exampleUrl = 'https://your-domain.my.salesforce-sites.com/PublicForm?id=';
    @api permissionSetName = 'FormBuilder User Access';
    @api visualforcePageName = 'PublicForm';
    @api customSettingName = 'Form Builder Settings';
    @api customSettingFieldLabel = 'Public Form Base Url';

    apexClasses = [
        'FormAuraController',
        'FormBuilderSettingsService',
        'FormController',
        'FormEditorController',
        'FormEditorMetadataService',
        'FormSubmissionHandler',
        'FormSubmissionProcessor',
        'FormTemplateRequest',
        'SiteNameCheckController'
    ];

    objectNames = [
        'Forms',
        'Form_Submissions',
        'Form_Submission_Records'
    ];

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async copyExampleUrl() {
        try {
            await this.copyToClipboard(this.exampleUrl);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Copied',
                    message: 'Example URL copied to clipboard.',
                    variant: 'success'
                })
            );
        } catch (e) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Copy failed',
                    message: `Could not copy automatically. Please copy it manually. Error: ${e.message || e}`,
                    variant: 'warning'
                })
            );
        }
    }

    async copyToClipboard(text) {
        if (navigator?.clipboard?.writeText) {
            return navigator.clipboard.writeText(text);
        }

        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);

        return Promise.resolve();
    }
}