import { LightningElement, api } from 'lwc';
import { isFieldShown } from 'c/smartFormsModel';

/**
 * Interactive preview of the public form page (dark glass card inside a browser frame).
 * Mirrors the generated page: required checks and dependent-field visibility.
 * Nothing is submitted anywhere.
 */
export default class SmartFormsVisitor extends LightningElement {
    @api formName = '';
    @api url = '';
    @api notFound = false;

    _fields = [];
    values = {};
    invalid = {};
    message = '';
    messageOk = false;

    @api
    get fields() {
        return this._fields;
    }
    set fields(value) {
        this._fields = Array.isArray(value) ? value : [];
        this.values = {};
        this.invalid = {};
        this.message = '';
    }

    get title() {
        return this.formName || 'Untitled form';
    }

    get displayUrl() {
        return String(this.url || '').replace(/^https?:\/\//, '');
    }

    get hasFields() {
        return this._fields.length > 0;
    }

    get rows() {
        return this._fields
            .filter((f) => isFieldShown(f, this.values))
            .map((f) => {
                const type = String(f.type || 'STRING').toUpperCase();
                return {
                    key: f.apiName,
                    apiName: f.apiName,
                    label: f.label,
                    required: !!f.required,
                    placeholder: f.placeholder || '',
                    inputId: `vf-${f.apiName}`,
                    wrapClass: this.invalid[f.apiName] ? 'vf-field invalid' : 'vf-field',
                    isBoolean: type === 'BOOLEAN',
                    isPicklist: type === 'PICKLIST',
                    isMulti: type === 'MULTIPICKLIST',
                    isTextarea: type === 'TEXTAREA',
                    isDate: type === 'DATE',
                    isDatetime: type === 'DATETIME',
                    isText: !['BOOLEAN', 'PICKLIST', 'MULTIPICKLIST', 'TEXTAREA', 'DATE', 'DATETIME'].includes(type),
                    options: (f.picklistValues || []).map((p) => ({
                        key: `${f.apiName}-${p.value}`,
                        value: p.value,
                        label: p.label
                    }))
                };
            });
    }

    get messageClass() {
        return this.messageOk ? 'vf-msg vf-msg--ok' : 'vf-msg vf-msg--bad';
    }

    handleChange(event) {
        const target = event.target;
        const api = target.dataset.api;
        if (!api) return;
        let value;
        if (target.type === 'checkbox') value = target.checked;
        else if (target.multiple) value = Array.from(target.selectedOptions).map((o) => o.value);
        else value = target.value;
        this.values = { ...this.values, [api]: value };
        this.pruneHiddenAnswers();
    }

    /** Answers to fields that just became hidden are cleared (chains of dependencies settle in a few passes). */
    pruneHiddenAnswers() {
        let next = this.values;
        for (let pass = 0; pass < this._fields.length; pass += 1) {
            let changed = false;
            this._fields.forEach((f) => {
                if (!isFieldShown(f, next) && next[f.apiName] !== undefined) {
                    next = { ...next };
                    delete next[f.apiName];
                    changed = true;
                }
            });
            if (!changed) break;
        }
        this.values = next;
    }

    handleSubmit(event) {
        event.preventDefault();
        const invalid = {};
        this._fields.forEach((f) => {
            if (!f.required || !isFieldShown(f, this.values)) return;
            const v = this.values[f.apiName];
            const empty = Array.isArray(v) ? v.length === 0 : typeof v === 'boolean' ? !v : !String(v || '').trim();
            if (empty) invalid[f.apiName] = true;
        });
        this.invalid = invalid;
        if (Object.keys(invalid).length) {
            this.messageOk = false;
            this.message = 'Please fill all required fields';
            return;
        }
        this.messageOk = true;
        this.message = 'Preview only: nothing was submitted.';
        const form = this.template.querySelector('form');
        if (form) form.reset();
        this.values = {};
    }
}
