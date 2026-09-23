import { LightningElement, track, wire } from 'lwc';
import { publish, subscribe, MessageContext } from 'lightning/messageService';
import FORM_PREVIEW_CHANNEL from '@salesforce/messageChannel/formPreviewChannel__c';
import getFormTemplates from '@salesforce/apex/FormAuraController.getFormTemplates';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';

export default class FormPreviewer extends LightningElement {
    @track selectedFields = [];
    @track formName = '';
    @track selectedApiName = null;
    @track isModalOpen = false;
    @track fieldBeingEdited = null;

    @track selectedFormId = null;
    @track formOptions = [{ label: 'None', value: null }];

    @track controllingFieldOptions = [];
    @track selectedControllingValues = [];
    @track dependentFieldsList = [];

    subscription = null;

    @wire(MessageContext) messageContext;

    @wire(getFormTemplates)
    wiredForms({ error, data }) {
        if (data) {
            this.formOptions = [
                { label: 'None', value: null },
                ...data
            ];
        } else if (error) {
            // Handle form templates loading error silently
        }
    }

    connectedCallback() {
        this.subscription = subscribe(
            this.messageContext,
            FORM_PREVIEW_CHANNEL,
            (message) => this.handleMessage(message)
        );
    }

    handleFormChange(event) {
        const formId = event.detail.value;
        this.selectedFormId = formId;

        if (!formId) {
            this.selectedFields = [];
            this.formName = '';
            return;
        }

        getFormData({ formId })
            .then(data => {
                if (data) {
                    this.formName = data.name;
                    publish(this.messageContext, FORM_PREVIEW_CHANNEL, {
                        action: 'loadForm',
                        source: 'selector',
                        formId: formId
                    });
                }
            })
            .catch(() => {
                // Form loading error handled
            });
    }

    handleMessage(message) {
        if (!message || message.source === 'previewer') return;

        if (message.action === 'loadForm') {
            // Optional: can clear or show loading state
            return;
        }

        this.formName = message.formName || '';
        const fields = Array.isArray(message.fields) ? message.fields : [];

        this.selectedFields = fields.map((f, idx) => ({
            ...f,
            placeholder: f.placeholder || '',
            displayOrder: idx + 1,
            dependency: f.dependency || null,
            isInput: ['string','email','phone','url','number','currency','percent','checkbox','boolean','date','datetime'].includes((f.type || 'string').toLowerCase()),
            isTextarea: (f.type || '').toLowerCase() === 'textarea',
            isSelect: ['picklist','multipicklist'].includes((f.type || '').toLowerCase()),
            isMulti: (f.type || '').toLowerCase() === 'multipicklist',
            inputType: this.computeInputType(f.type),
            rowClass: this.computeRowClass(f.apiName),
            disableUp: idx === 0,
            disableDown: idx === fields.length - 1
        }));

        this.refreshRowState();
    }

    computeInputType(type) {
        const t = (type || 'string').toLowerCase();
        if (t === 'email') return 'email';
        if (t === 'phone') return 'tel';
        if (t === 'url') return 'url';
        if (['number','currency','percent'].includes(t)) return 'number';
        if (['checkbox','boolean'].includes(t)) return 'checkbox';
        if (t === 'date') return 'date';
        if (t === 'datetime') return 'datetime-local';
        return 'text';
    }

    computeRowClass(apiName) {
        return apiName === this.selectedApiName
            ? 'preview-field-item preview-field-item_selected'
            : 'preview-field-item';
    }

    refreshRowState() {
        this.selectedFields = this.selectedFields.map((f, idx, arr) => ({
            ...f,
            rowClass: this.computeRowClass(f.apiName),
            disableUp: idx === 0,
            disableDown: idx === arr.length - 1
        }));
    }

    handleEditField(event) {
        event.stopPropagation();
        const apiName = event.currentTarget.dataset.apiName;
        const field = this.selectedFields.find(f => f.apiName === apiName);
        if (!field) return;

        this.fieldBeingEdited = {
            ...JSON.parse(JSON.stringify(field)),
            isDependent: !!(field.dependency && field.dependency.controllingApi),
            dependency: field.dependency || { controllingApi: '', controllingValues: [] }
        };
        this.selectedApiName = apiName;
        this.isModalOpen = true;

        this.controllingFieldOptions = this.selectedFields
            .filter(f => f.apiName !== apiName && (f.isSelect || f.inputType === 'checkbox'))
            .map(f => ({
                label: `${f.label} (${f.apiName})`,
                value: f.apiName
            }));

        this.updateControllingValues();
        this.updateDependentFieldsList();
    }

    updateControllingValues() {
        const ctrlApi = this.fieldBeingEdited.dependency?.controllingApi || '';
        if (!ctrlApi) {
            this.selectedControllingValues = [];
            return;
        }

        const ctrlField = this.selectedFields.find(f => f.apiName === ctrlApi);
        if (!ctrlField) {
            this.selectedControllingValues = [];
            return;
        }

        let values = [];
        if (ctrlField.inputType === 'checkbox') {
            values = [
                { label: 'Checked', value: 'true' },
                { label: 'Unchecked', value: 'false' }
            ];
        } else if (Array.isArray(ctrlField.picklistValues)) {
            values = ctrlField.picklistValues;
        }

        this.selectedControllingValues = values.map(pv => ({
            label: pv.label,
            value: pv.value,
            isChecked: this.fieldBeingEdited.dependency?.controllingValues?.includes(pv.value) || false
        }));
    }

    updateDependentFieldsList() {
        const isControllingType = this.fieldBeingEdited.isSelect || this.fieldBeingEdited.inputType === 'checkbox';
        if (!isControllingType) {
            this.dependentFieldsList = [];
            return;
        }

        this.dependentFieldsList = this.selectedFields
            .filter(f => f.dependency && f.dependency.controllingApi === this.fieldBeingEdited.apiName)
            .map(f => ({
                apiName: f.apiName,
                label: f.label,
                triggerValues: (f.dependency?.controllingValues || []).join(', ') || 'None selected'
            }));
    }

    closeModal() {
        this.isModalOpen = false;
        this.fieldBeingEdited = null;
        this.selectedApiName = null;
        this.controllingFieldOptions = [];
        this.selectedControllingValues = [];
        this.dependentFieldsList = [];
    }

    handleFieldNameChange(event) {
        this.fieldBeingEdited.label = event.target.value;
    }

    handlePlaceholderChange(event) {
        this.fieldBeingEdited.placeholder = event.target.value;
    }

    handleRequiredChange(event) {
        this.fieldBeingEdited.required = event.target.checked;
    }

    handleDependentChange(event) {
        this.fieldBeingEdited.isDependent = event.target.checked;
        if (!this.fieldBeingEdited.isDependent) {
            this.fieldBeingEdited.dependency = { controllingApi: '', controllingValues: [] };
            this.updateControllingValues();
        }
    }

    handleControllingFieldChange(event) {
        const value = event.detail.value || '';
        this.fieldBeingEdited.dependency.controllingApi = value;
        this.fieldBeingEdited.dependency.controllingValues = [];
        this.updateControllingValues();
    }

    handleValueSelectionChange(event) {
        event.stopPropagation();
        const value = event.target.dataset.value;
        const checked = event.target.checked;

        let values = [...(this.fieldBeingEdited.dependency.controllingValues || [])];
        if (checked) {
            if (!values.includes(value)) values.push(value);
        } else {
            values = values.filter(v => v !== value);
        }
        this.fieldBeingEdited.dependency.controllingValues = values;

        this.selectedControllingValues = this.selectedControllingValues.map(pv =>
            pv.value === value ? { ...pv, isChecked: checked } : pv
        );
    }

    saveFieldChanges() {
        if (!this.fieldBeingEdited) return;

        const finalDependency = this.fieldBeingEdited.isDependent &&
            this.fieldBeingEdited.dependency.controllingApi &&
            this.fieldBeingEdited.dependency.controllingValues.length > 0
            ? this.fieldBeingEdited.dependency
            : null;

        this.selectedFields = this.selectedFields.map(field =>
            field.apiName === this.selectedApiName
                ? {
                      ...field,
                      label: this.fieldBeingEdited.label,
                      placeholder: this.fieldBeingEdited.placeholder,
                      type: this.fieldBeingEdited.type,
                      required: this.fieldBeingEdited.required,
                      dependency: finalDependency,
                      inputType: this.fieldBeingEdited.inputType,
                      isSelect: this.fieldBeingEdited.isSelect,
                      isMulti: this.fieldBeingEdited.isMulti,
                      isInput: this.fieldBeingEdited.isInput,
                      isTextarea: this.fieldBeingEdited.isTextarea
                  }
                : field
        );

        this.publishUpdate();
        this.closeModal();
    }

    publishUpdate() {
        publish(this.messageContext, FORM_PREVIEW_CHANNEL, {
            source: 'previewer',
            action: 'update',
            formName: this.formName,
            fields: this.selectedFields.map(f => ({
                label: f.label,
                apiName: f.apiName,
                type: f.type,
                required: f.required,
                picklistValues: f.picklistValues || [],
                placeholder: f.placeholder || '',
                displayOrder: f.displayOrder,
                dependency: f.dependency || null
            }))
        });
    }

    applyPreviewChanges() {
        this.publishUpdate();
    }

    stopBubble(event) {
        event.stopPropagation();
    }

    moveUp(event) {
        event.stopPropagation();
        this.move(event.currentTarget.dataset.apiName, -1);
    }

    moveDown(event) {
        event.stopPropagation();
        this.move(event.currentTarget.dataset.apiName, 1);
    }

    move(apiName, delta) {
        const arr = [...this.selectedFields];
        const from = arr.findIndex(f => f.apiName === apiName);
        const to = from + delta;

        if (from < 0 || to < 0 || to >= arr.length) return;

        [arr[from], arr[to]] = [arr[to], arr[from]];
        this.selectedFields = arr;
        this.refreshRowState();
        this.publishReorder();
    }

    publishReorder() {
        publish(this.messageContext, FORM_PREVIEW_CHANNEL, {
            source: 'previewer',
            action: 'reorder',
            formName: this.formName,
            fields: this.selectedFields.map((f, i) => ({
                label: f.label,
                apiName: f.apiName,
                type: f.type,
                required: f.required,
                picklistValues: f.picklistValues || [],
                placeholder: f.placeholder || '',
                displayOrder: i + 1,
                dependency: f.dependency || null
            }))
        });
    }

    handleDeleteField(event) {
        event.stopPropagation();
        const apiName = event.currentTarget.dataset.apiName;
        this.selectedFields = this.selectedFields.filter(f => f.apiName !== apiName);
        this.refreshRowState();
        this.publishDeselect(apiName);
    }

    publishDeselect(apiName) {
        publish(this.messageContext, FORM_PREVIEW_CHANNEL, {
            action: 'deselectField',
            source: 'previewer',
            apiName: apiName,
            fields: this.selectedFields.map(f => ({
                label: f.label,
                apiName: f.apiName,
                type: f.type,
                required: f.required,
                picklistValues: f.picklistValues || [],
                placeholder: f.placeholder || '',
                displayOrder: f.displayOrder,
                dependency: f.dependency || null
            }))
        });
    }

    get hasFields() {
        return this.selectedFields.length > 0;
    }
}