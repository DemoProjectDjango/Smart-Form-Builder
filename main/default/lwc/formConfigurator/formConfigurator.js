import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

import getFormTemplates from '@salesforce/apex/FormAuraController.getFormTemplates';
import fetchObjectOptions from '@salesforce/apex/FormEditorController.fetchObjectOptions';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
export default class FormConfigurator extends NavigationMixin(LightningElement) {
    @track formOptions = [];
    @track objectOptions = [];
    @track selectedFormId = null;
    @track formName = '';
    @track selectedObject = '';

    connectedCallback() {
        this.loadForms();
        this.loadObjects();
    }

    async loadForms() {
        try {
            const forms = await getFormTemplates();
            this.formOptions = (forms || []).map(f => ({ label: f.label, value: f.value }));
        } catch {
            this.formOptions = [];
        }
    }

    async loadObjects() {
        try {
            const objects = await fetchObjectOptions();
            this.objectOptions = (objects || []).map(o => ({ label: o.label, value: o.name }));
        } catch {
            this.objectOptions = [];
        }
    }

    async handleFormSelection(event) {
        this.selectedFormId = event.detail.value;

        if (!this.selectedFormId) {
            this.formName = '';
            this.selectedObject = '';
            return;
        }

        try {
            const data = await getFormData({ formId: this.selectedFormId });
            this.formName = data?.name || '';
            this.selectedObject = data?.objectApiName || '';
        } catch {
            this.formName = '';
            this.selectedObject = '';
        }
    }

    handleNameChange(event) {
        this.formName = event.detail.value;
    }

    handleObjectChange(event) {
        this.selectedObject = event.detail.value;
    }

    

    async handleNext() {
        const cleanFormName = (this.formName || '').trim();
        if (!cleanFormName || !this.selectedObject) return;

        const navState = {
            c__objectName: this.selectedObject,
            c__formName: cleanFormName
        };
        if (this.selectedFormId) {
            navState.c__formId = this.selectedFormId;
        }

        try {
            const namespaces = ['twinforce', ''];
            for (const ns of namespaces) {
                const tabApiName = ns ? `${ns}__Form_Builder` : 'Form_Builder';
                try {
                    this[NavigationMixin.Navigate]({
                        type: 'standard__navItemPage',
                        attributes: { apiName: tabApiName },
                        state: navState
                    });
                    break; // navigation succeeded, stop trying other namespaces
                } catch (err) {
                    // try next namespace
                    console.warn(`Navigation with ${tabApiName} failed, trying next if available.`, err);
                }
            }
        } catch (error) {
            console.error('Navigation failed:', error);
        }
    }
}