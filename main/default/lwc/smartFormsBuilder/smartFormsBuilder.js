import { LightningElement, api } from 'lwc';
import fetchFieldsForObject from '@salesforce/apex/FormEditorController.fetchFieldsForObject';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
import saveFormTemplate from '@salesforce/apex/FormAuraController.saveFormTemplate';
import {
    answerLabel,
    buildDependencyJson,
    buildFieldConfigJson,
    buildFormCss,
    buildFormHtml,
    buildFormJs,
    controllingAnswers,
    isControllingType,
    isLookupComplete,
    isLookupType,
    isVisitorField,
    joinOr,
    lookupSummary,
    normalizeError,
    parseFieldConfig
} from 'c/smartFormsModel';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const toField = (d) => ({
    apiName: d.name,
    label: d.label,
    type: String(d.type || 'STRING').toUpperCase(),
    required: !!d.required,
    picklistValues: d.picklistValues || [],
    referenceTo: d.referenceTo || [],
    lookup: null,
    placeholder: '',
    dependency: null
});

const seg = (text, isBold = false) => ({ text, isBold });

/**
 * Form Builder: field picker, canvas, field-editor drawer and visitor preview in one workspace.
 * Replaces the formEditor + formPreviewer pair (no message channel; one source of truth).
 */
export default class SmartFormsBuilder extends LightningElement {
    @api baseUrl = '';

    name = '';
    objectApiName = '';
    objectLabel = '';
    formId = null;
    version = null;
    available = [];
    fields = [];
    search = '';
    dirty = false;
    view = 'edit';
    isLoading = false;
    isSaving = false;
    hasRequest = false;

    selectedApi = null;
    draft = null;
    tryValue = '';
    _focusDrawer = false;
    _returnFocusApi = null;
    _request = null;

    /** { name, objectApiName, objectLabel, formId, token } handed over from "Get started". */
    @api
    get request() {
        return this._request;
    }
    set request(value) {
        if (!value || (this._request && this._request.token === value.token)) return;
        this._request = value;
        this.initialise(value);
    }

    // ── Loading ──────────────────────────────────────────────

    async initialise(req) {
        this.hasRequest = true;
        this.closeDrawerState();
        this.name = req.name || '';
        this.objectApiName = req.objectApiName || '';
        this.objectLabel = req.objectLabel || req.objectApiName || '';
        this.formId = req.formId || null;
        this.version = null;
        this.fields = [];
        this.available = [];
        this.search = '';
        this.dirty = false;
        this.view = 'edit';
        this.isLoading = true;
        const requestToken = req.token;
        try {
            if (req.formId) {
                const data = await getFormData({ formId: req.formId });
                if (this._request.token !== requestToken) return;
                if (data) {
                    this.version = data.version;
                    this.fields = parseFieldConfig(data.fieldConfig);
                    this.objectApiName = data.objectApiName || this.objectApiName;
                }
            }
            await this.loadAvailable(this.objectApiName);
            if (this._request.token !== requestToken) return;
            this.addRequiredFields();
        } catch (error) {
            this.notify(`Failed to load the form: ${normalizeError(error)}`, 'error');
        } finally {
            if (this._request && this._request.token === requestToken) this.isLoading = false;
        }
    }

    async loadAvailable(objectApiName) {
        if (!objectApiName) {
            this.available = [];
            return;
        }
        const rows = await fetchFieldsForObject({ objectName: objectApiName });
        this.available = (Array.isArray(rows) ? rows : []).map(toField);
    }

    /** Fields Salesforce needs to create a record are added automatically. */
    addRequiredFields() {
        const have = new Set(this.fields.map((f) => f.apiName));
        const missing = this.available.filter((f) => f.required && !have.has(f.apiName));
        if (missing.length) this.fields = [...this.fields, ...missing];
    }

    // ── View model ───────────────────────────────────────────

    get hasNoRequest() {
        return !this.hasRequest;
    }

    get isEditView() {
        return this.view === 'edit';
    }

    get isVisitorView() {
        return this.view === 'visitor';
    }

    get editPressed() {
        return String(this.view === 'edit');
    }

    get visitorPressed() {
        return String(this.view === 'visitor');
    }

    get canvasTitle() {
        return this.name || 'Untitled form';
    }

    get objectChip() {
        return `Creates: ${this.objectLabel}`;
    }

    get versionChip() {
        return this.version ? `Version ${this.version}` : 'New form';
    }

    get pickedCount() {
        return `${this.fields.length} on form`;
    }

    get saveDisabled() {
        return this.isSaving || this.isLoading;
    }

    get visitorUrl() {
        const base = String(this.baseUrl || '').trim();
        return base ? `${base}${this.formId || 'your-form-id'}` : 'Your public form link appears here once the site URL is set';
    }

    get pickerRows() {
        const q = this.search.trim().toLowerCase();
        const selected = new Set(this.fields.map((f) => f.apiName));
        return this.available
            .filter((d) => !q || d.apiName.toLowerCase().includes(q) || d.label.toLowerCase().includes(q))
            .map((d) => ({
                key: d.apiName,
                apiName: d.apiName,
                label: d.label,
                type: d.type,
                required: d.required,
                checked: selected.has(d.apiName)
            }));
    }

    get hasPickerRows() {
        return this.pickerRows.length > 0;
    }

    get pickerEmptyText() {
        if (this.isLoading) return 'Loading fields\u2026';
        return this.search.trim() ? 'No fields match your search' : 'No fields available';
    }

    get hasFields() {
        return this.fields.length > 0;
    }

    get canvasRows() {
        const last = this.fields.length - 1;
        return this.fields.map((f, i) => {
            const ctrl = f.dependency ? this.fields.find((x) => x.apiName === f.dependency.controllingApi) : null;
            const answers = f.dependency
                ? joinOr((f.dependency.controllingValues || []).map((v) => (ctrl ? answerLabel(ctrl, v) : v)))
                : '';
            return {
                key: f.apiName,
                apiName: f.apiName,
                index: i,
                number: i + 1,
                label: f.label,
                required: f.required,
                type: f.type,
                isLookup: isLookupType(f.type),
                lookupBadge: isVisitorField(f) ? 'Lookup' : 'Hidden from visitors',
                lookupBadgeClass: isVisitorField(f) ? 'chip' : 'chip chip--hidden',
                rowClass: 'frow',
                selected: String(f.apiName === this.selectedApi),
                hasDependency: !!f.dependency,
                dependencyText: f.dependency
                    ? `Shown when ${ctrl ? ctrl.label : f.dependency.controllingApi} is ${answers}`
                    : '',
                ghost: this.ghostFor(f),
                disableUp: i === 0,
                disableDown: i === last,
                editLabel: `Edit ${f.label}`,
                deleteLabel: `Delete ${f.label}`,
                editDependencyTitle: 'Edit criteria'
            };
        });
    }

    ghostFor(f) {
        const values = (f.picklistValues || []).map((p) => p.label);
        const base = { isArea: false, isCheck: false, isInput: false, text: '' };
        if (isLookupType(f.type)) return { ...base, isInput: true, text: lookupSummary(f) };
        switch (f.type) {
            case 'TEXTAREA':
                return { ...base, isArea: true, text: f.placeholder || 'Long text' };
            case 'BOOLEAN':
                return { ...base, isCheck: true, text: f.label };
            case 'PICKLIST':
                return { ...base, isInput: true, text: values.join(' \u00b7 ') };
            case 'MULTIPICKLIST':
                return { ...base, isInput: true, text: `Choose one or more: ${values.join(', ')}` };
            case 'DATE':
                return { ...base, isInput: true, text: 'dd/mm/yyyy' };
            case 'DATETIME':
                return { ...base, isInput: true, text: 'dd/mm/yyyy, --:--' };
            default:
                return { ...base, isInput: true, text: f.placeholder || '' };
        }
    }

    // ── Drawer view model ────────────────────────────────────

    get drawerOpen() {
        return this.draft !== null;
    }

    get draftTypeLine() {
        return this.draft ? `${this.draft.type} \u00b7 ${this.draft.apiName}` : '';
    }

    get draftTitle() {
        return this.draft ? `Edit \u201c${this.draft.label}\u201d` : 'Edit field';
    }

    get draftDependentChecked() {
        return !!(this.draft && this.draft.isDependent);
    }

    get draftIsLookup() {
        return !!this.draft && isLookupType(this.draft.type);
    }

    get draftLookup() {
        return this.draft ? this.draft.lookup : null;
    }

    get draftReferenceTo() {
        return this.draft ? this.draft.referenceTo || [] : [];
    }

    get showPlaceholder() {
        return !this.draftIsLookup;
    }

    get showDependency() {
        return !this.draftIsLookup;
    }

    /** A lookup can only be required when visitors choose from a list. */
    get showRequiredSwitch() {
        return !this.draftIsLookup || (!!this.draft.lookup && this.draft.lookup.mode === 'choices');
    }

    get controllerOptions() {
        if (!this.draft) return [];
        return this.fields.filter((f) => f.apiName !== this.draft.apiName && isControllingType(f.type));
    }

    get hasControllers() {
        return this.controllerOptions.length > 0;
    }

    get showCriteria() {
        return !!(this.draft && this.draft.isDependent);
    }

    get showControllerPicker() {
        return this.showCriteria && this.hasControllers;
    }

    get showAddController() {
        return this.showCriteria && !this.hasControllers;
    }

    get ctrlSelectOptions() {
        const current = this.draft ? this.draft.dependency.controllingApi : '';
        return this.controllerOptions.map((o) => ({
            key: o.apiName,
            value: o.apiName,
            label: `${o.label} (${o.type === 'BOOLEAN' ? 'checkbox' : 'picklist'})`,
            selected: o.apiName === current
        }));
    }

    get addableControllers() {
        if (!this.draft) return [];
        const have = new Set(this.fields.map((f) => f.apiName));
        return this.available
            .filter((d) => isControllingType(d.type) && d.apiName !== this.draft.apiName && !have.has(d.apiName))
            .map((d) => ({ key: d.apiName, apiName: d.apiName, label: d.label, type: d.type }));
    }

    get hasAddableControllers() {
        return this.addableControllers.length > 0;
    }

    get draftController() {
        if (!this.draft) return null;
        return this.fields.find((f) => f.apiName === this.draft.dependency.controllingApi) || null;
    }

    get hasDraftController() {
        return !!this.draftController;
    }

    get answerChips() {
        const chosen = this.draft ? this.draft.dependency.controllingValues : [];
        return controllingAnswers(this.draftController).map((a) => {
            const on = chosen.includes(a.value);
            return { key: a.value, value: a.value, label: a.label, pressed: String(on), on };
        });
    }

    get chosenAnswers() {
        return this.draft ? this.draft.dependency.controllingValues : [];
    }

    get criteriaComplete() {
        return !!(this.draftController && this.chosenAnswers.length);
    }

    get criteriaIncomplete() {
        return !this.criteriaComplete;
    }

    get criteriaTitle() {
        return this.draft ? `Show \u201c${this.draft.label}\u201d when\u2026` : '';
    }

    get summarySegments() {
        const ctrl = this.draftController;
        if (!this.draft || !ctrl || !this.chosenAnswers.length) return [];
        return [
            seg(this.draft.label, true),
            seg(' appears only when '),
            seg(ctrl.label, true),
            seg(' is '),
            seg(joinOr(this.chosenAnswers.map((v) => answerLabel(ctrl, v))), true),
            seg('. Otherwise it stays hidden and its answer is cleared.')
        ].map((s, i) => ({ ...s, key: `seg-${i}` }));
    }

    get summaryWarning() {
        return `${this.draftController ? 'Choose at least one answer in step 2.' : 'Choose a question in step 1.'} Until then, this field always shows.`;
    }

    get tryOptions() {
        return controllingAnswers(this.draftController).map((a) => ({
            key: a.value,
            value: a.value,
            label: a.label,
            selected: a.value === this.tryValue
        }));
    }

    get tryShown() {
        return this.chosenAnswers.includes(this.tryValue);
    }

    get tryLabel() {
        return `\u201c${this.draft ? this.draft.label : ''}\u201d is`;
    }

    get dependents() {
        if (!this.draft || !isControllingType(this.draft.type)) return [];
        return this.fields
            .filter((f) => f.dependency && f.dependency.controllingApi === this.draft.apiName)
            .map((f) => ({
                key: f.apiName,
                label: f.label,
                text:
                    joinOr((f.dependency.controllingValues || []).map((v) => answerLabel(this.draft, v))) || 'None selected'
            }));
    }

    get hasDependents() {
        return this.dependents.length > 0;
    }

    // ── Builder handlers ─────────────────────────────────────

    handleName(event) {
        this.name = event.target.value;
    }

    handleSearch(event) {
        this.search = event.target.value;
    }

    handleView(event) {
        this.view = event.currentTarget.dataset.view;
    }

    handlePick(event) {
        const api = event.target.dataset.pick;
        if (!api) return;
        if (event.target.checked) {
            const def = this.available.find((d) => d.apiName === api);
            if (def && !this.fields.some((f) => f.apiName === api)) this.fields = [...this.fields, { ...def }];
        } else {
            this.fields = this.fields.filter((f) => f.apiName !== api);
        }
        this.dirty = true;
    }

    handleSelectAll() {
        const have = new Set(this.fields.map((f) => f.apiName));
        this.fields = [...this.fields, ...this.available.filter((d) => !have.has(d.apiName)).map((d) => ({ ...d }))];
        this.dirty = true;
        this.notify(`All ${this.available.length} fields added`);
    }

    handleDeselectAll() {
        this.fields = [];
        this.dirty = true;
        this.notify('All fields removed');
    }

    handleMove(event) {
        const index = Number(event.currentTarget.dataset.index);
        const delta = Number(event.currentTarget.dataset.delta);
        const to = index + delta;
        if (Number.isNaN(index) || to < 0 || to >= this.fields.length) return;
        const next = [...this.fields];
        next.splice(to, 0, next.splice(index, 1)[0]);
        this.fields = next;
        this.dirty = true;
    }

    handleDelete(event) {
        const api = event.currentTarget.dataset.api;
        this.fields = this.fields.filter((f) => f.apiName !== api);
        this.dirty = true;
    }

    handleApply() {
        this.dirty = false;
        this.notify('Changes applied to the form');
    }

    async handleSave() {
        const name = (this.name || '').trim();
        if (!name) {
            this.notify('Form name is required.', 'error');
            const input = this.template.querySelector('[data-id="name"]');
            if (input) input.focus();
            return;
        }
        if (!this.objectApiName) {
            this.notify('Select an object first.', 'error');
            return;
        }
        if (!this.fields.length) {
            this.notify('Select at least one field.', 'error');
            return;
        }
        const lookupProblem = this.lookupProblem();
        if (lookupProblem) {
            this.notify(lookupProblem, 'error');
            return;
        }
        if (!this.fields.some(isVisitorField)) {
            this.notify('Add at least one field visitors can fill in. Lookup fields stay hidden until you configure them.', 'error');
            return;
        }
        this.isSaving = true;
        try {
            const payload = {
                name,
                objectApiName: this.objectApiName,
                formId: this.formId || null,
                html: buildFormHtml(name, this.fields),
                css: buildFormCss(),
                js: buildFormJs(this.fields),
                fieldDependenciesJson: buildDependencyJson(this.fields),
                fieldConfigJson: buildFieldConfigJson(this.fields)
            };
            const savedId = await saveFormTemplate({ reqJson: JSON.stringify(payload) });
            if (savedId) {
                this.formId = savedId;
                const data = await getFormData({ formId: savedId });
                if (data) this.version = data.version;
            }
            this.dirty = false;
            this.notify(`Form saved successfully${this.version ? ` \u00b7 version ${this.version}` : ''}`);
            this.dispatchEvent(new CustomEvent('saved', { detail: { formId: this.formId } }));
        } catch (error) {
            this.notify(normalizeError(error) || 'Failed to save form.', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    /** First problem with a lookup field's settings, or ''. */
    lookupProblem() {
        for (const f of this.fields) {
            if (!isLookupType(f.type)) continue;
            if (f.lookup && !isLookupComplete(f)) {
                return `Finish the lookup settings for \u201c${f.label}\u201d, or clear them.`;
            }
            const createRequired = this.available.some((a) => a.apiName === f.apiName && a.required);
            if (createRequired && !isLookupComplete(f)) {
                return `\u201c${f.label}\u201d is required by Salesforce but hidden from visitors. Choose a fixed record or selected records for it.`;
            }
        }
        return '';
    }

    handleGoStart() {
        this.dispatchEvent(new CustomEvent('gostart'));
    }

    // ── Edit field drawer ────────────────────────────────────

    handleEdit(event) {
        const api = event.currentTarget.dataset.api;
        const field = this.fields.find((f) => f.apiName === api);
        if (!field) return;
        this._returnFocusApi = api;
        this.selectedApi = api;
        this.draft = {
            ...field,
            lookup: field.lookup ? JSON.parse(JSON.stringify(field.lookup)) : null,
            isDependent: !!(field.dependency && field.dependency.controllingApi),
            dependency: field.dependency
                ? { controllingApi: field.dependency.controllingApi, controllingValues: [...(field.dependency.controllingValues || [])] }
                : { controllingApi: '', controllingValues: [] }
        };
        this.tryValue = '';
        this._focusDrawer = true;
    }

    closeDrawerState() {
        this.draft = null;
        this.selectedApi = null;
        this.tryValue = '';
    }

    handleCloseDrawer() {
        this.closeDrawerState();
        const api = this._returnFocusApi;
        this._returnFocusApi = null;
        Promise.resolve().then(() => {
            if (!api) return;
            const btn = Array.from(this.template.querySelectorAll('[data-edit-btn]')).find((b) => b.dataset.api === api);
            if (btn) btn.focus();
        });
    }

    handleDrawerKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this.handleCloseDrawer();
            return;
        }
        if (event.key !== 'Tab') return;
        const drawer = this.template.querySelector('[data-id="drawer"]');
        if (!drawer) return;
        const items = Array.from(drawer.querySelectorAll(FOCUSABLE));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = this.template.activeElement;
        if (event.shiftKey && (active === first || !drawer.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    handleDraftLabel(event) {
        this.draft = { ...this.draft, label: event.target.value };
    }

    handleDraftPlaceholder(event) {
        this.draft = { ...this.draft, placeholder: event.target.value };
    }

    handleDraftRequired(event) {
        this.draft = { ...this.draft, required: event.target.checked };
    }

    handleLookupChange(event) {
        const lookup = event.detail.lookup;
        this.draft = { ...this.draft, lookup, required: lookup && lookup.mode === 'choices' ? this.draft.required : false };
    }

    handleDraftDependent(event) {
        const on = event.target.checked;
        let dependency = this.draft.dependency;
        if (!on) {
            dependency = { controllingApi: '', controllingValues: [] };
        } else if (!dependency.controllingApi) {
            const first = this.controllerOptions[0];
            if (first) dependency = { controllingApi: first.apiName, controllingValues: [] };
        }
        this.draft = { ...this.draft, isDependent: on, dependency };
        this.tryValue = '';
    }

    handleDraftController(event) {
        this.draft = { ...this.draft, dependency: { controllingApi: event.target.value, controllingValues: [] } };
        this.tryValue = '';
    }

    handleChip(event) {
        const value = event.currentTarget.dataset.value;
        const current = this.draft.dependency.controllingValues;
        const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
        this.draft = { ...this.draft, dependency: { ...this.draft.dependency, controllingValues: next } };
    }

    handleAddController(event) {
        const api = event.currentTarget.dataset.api;
        const def = this.available.find((d) => d.apiName === api);
        if (!def) return;
        this.fields = [...this.fields, { ...def }];
        this.draft = { ...this.draft, dependency: { controllingApi: api, controllingValues: [] } };
        this.notify(`\u201c${def.label}\u201d added to the form`);
    }

    handleTry(event) {
        this.tryValue = event.target.value;
    }

    handleDrawerSave() {
        const d = this.draft;
        if (isLookupType(d.type) && d.lookup && !isLookupComplete(d)) {
            this.notify('Finish the lookup settings (choose a record, or at least one record), or clear them to hide the field.', 'error');
            return;
        }
        if (d.isDependent && (!d.dependency.controllingApi || !d.dependency.controllingValues.length)) {
            this.notify('Finish the criteria, or turn off \u201cOnly show this field for certain answers\u201d', 'error');
            return;
        }
        const label = (d.label || '').trim() || d.apiName;
        this.fields = this.fields.map((f) =>
            f.apiName === d.apiName
                ? {
                      ...f,
                      label,
                      placeholder: d.placeholder || '',
                      required: d.required,
                      lookup: isLookupType(f.type) ? d.lookup : null,
                      dependency: d.isDependent && !isLookupType(f.type) ? d.dependency : null
                  }
                : f
        );
        this.dirty = true;
        this.handleCloseDrawer();
        this.notify('Field updated');
    }

    // ── Lifecycle ────────────────────────────────────────────

    renderedCallback() {
        if (this._focusDrawer && this.drawerOpen) {
            const input = this.template.querySelector('[data-id="d-label"]');
            if (input) {
                input.focus();
                this._focusDrawer = false;
            }
        }
    }

    notify(message, variant) {
        this.dispatchEvent(new CustomEvent('notify', { detail: { message, variant } }));
    }
}
