import { LightningElement, api } from 'lwc';
import searchRecords from '@salesforce/apex/LookupRecordSearchController.searchRecords';
import { MAX_CHOICES, normalizeError, normalizeLookup } from 'c/smartFormsModel';

/**
 * Lookup field settings for the Form Builder drawer. A lookup field is hidden from visitors until the
 * admin picks one of two modes: a fixed record, or a short list of records visitors choose from.
 * Visitors never see or send record Ids: choices are submitted as opaque keys (o1, o2, ...).
 */
export default class SmartFormsLookupConfig extends LightningElement {
    @api fieldLabel = '';
    @api referenceTo = [];

    _lookup = null;
    objectApi = '';
    searchTerm = '';
    results = [];
    searched = false;
    searching = false;
    errorText = '';

    @api
    get value() {
        return this._lookup;
    }
    set value(v) {
        this._lookup = normalizeLookup(v);
    }

    // ── View model ───────────────────────────────────────────

    get maxChoices() {
        return MAX_CHOICES;
    }

    get isFixed() {
        return !!this._lookup && this._lookup.mode === 'fixed';
    }

    get isChoices() {
        return !!this._lookup && this._lookup.mode === 'choices';
    }

    get hasMode() {
        return this.isFixed || this.isChoices;
    }

    get fixedPressed() {
        return String(this.isFixed);
    }

    get choicesPressed() {
        return String(this.isChoices);
    }

    get targetObject() {
        return this.objectApi || (this.referenceTo || [])[0] || '';
    }

    get targets() {
        return (this.referenceTo || []).map((name) => ({ key: name, value: name, label: name, selected: name === this.targetObject }));
    }

    get hasSeveralTargets() {
        return (this.referenceTo || []).length > 1;
    }

    get record() {
        return this.isFixed ? this._lookup.record : { id: '', label: '', showToVisitors: false };
    }

    get hasRecord() {
        return !!this.record.id;
    }

    get showToVisitors() {
        return this.record.showToVisitors;
    }

    get choices() {
        return this.isChoices
            ? this._lookup.choices.map((c) => ({ ...c, labelAria: `Name shown for choice ${c.label || c.key}`, removeAria: `Remove ${c.label || c.key}` }))
            : [];
    }

    get choiceCount() {
        return this.isChoices ? this._lookup.choices.length : 0;
    }

    get choiceCountText() {
        return `${this.choiceCount} of ${MAX_CHOICES} selected`;
    }

    get limitReached() {
        return this.choiceCount >= MAX_CHOICES;
    }

    get hasChoices() {
        return this.choiceCount > 0;
    }

    get resultRows() {
        const chosen = new Set(this.isChoices ? this._lookup.choices.map((c) => c.id) : [this.record.id]);
        return this.results.map((r) => ({
            key: r.id,
            id: r.id,
            name: r.name,
            picked: chosen.has(r.id),
            disabled: chosen.has(r.id) || (this.isChoices && this.limitReached),
            actionLabel: this.isFixed ? (chosen.has(r.id) ? 'Selected' : 'Use this record') : chosen.has(r.id) ? 'Added' : 'Add'
        }));
    }

    get hasResults() {
        return this.results.length > 0;
    }

    get noResults() {
        return this.searched && !this.searching && this.results.length === 0 && !this.errorText;
    }

    get searchDisabled() {
        return this.searching || !this.targetObject;
    }

    // ── Handlers ─────────────────────────────────────────────

    handleMode(event) {
        const mode = event.currentTarget.dataset.mode;
        if (this._lookup && this._lookup.mode === mode) return;
        this.results = [];
        this.searched = false;
        this.errorText = '';
        this.commit(
            mode === 'fixed'
                ? { mode: 'fixed', record: { id: '', label: '', showToVisitors: false } }
                : { mode: 'choices', choices: [] }
        );
    }

    handleClear() {
        this.results = [];
        this.searched = false;
        this.commit(null);
    }

    handleObject(event) {
        this.objectApi = event.target.value;
        this.results = [];
        this.searched = false;
    }

    handleTerm(event) {
        this.searchTerm = event.target.value;
    }

    handleTermKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.handleSearch();
        }
    }

    async handleSearch() {
        if (this.searchDisabled) return;
        this.searching = true;
        this.errorText = '';
        try {
            this.results = (await searchRecords({ objectApiName: this.targetObject, searchTerm: this.searchTerm })) || [];
        } catch (error) {
            this.results = [];
            this.errorText = normalizeError(error);
        }
        this.searched = true;
        this.searching = false;
    }

    handlePick(event) {
        const { id, name } = event.currentTarget.dataset;
        if (!id) return;
        if (this.isFixed) {
            this.commit({ mode: 'fixed', record: { id, label: name, showToVisitors: this.record.showToVisitors } });
            return;
        }
        const choices = this._lookup.choices;
        if (choices.some((c) => c.id === id) || choices.length >= MAX_CHOICES) return;
        this.commit({ mode: 'choices', choices: [...choices, { key: this.nextKey(choices), id, label: name }] });
    }

    nextKey(choices) {
        const used = new Set(choices.map((c) => c.key));
        let n = 1;
        while (used.has(`o${n}`)) n += 1;
        return `o${n}`;
    }

    handleShowToggle(event) {
        this.commit({ mode: 'fixed', record: { ...this.record, showToVisitors: event.target.checked } });
    }

    handleFixedLabel(event) {
        this.commit({ mode: 'fixed', record: { ...this.record, label: event.target.value } });
    }

    handleChoiceLabel(event) {
        const key = event.target.dataset.key;
        this.commit({
            mode: 'choices',
            choices: this._lookup.choices.map((c) => (c.key === key ? { ...c, label: event.target.value } : c))
        });
    }

    handleRemoveChoice(event) {
        const key = event.currentTarget.dataset.key;
        this.commit({ mode: 'choices', choices: this._lookup.choices.filter((c) => c.key !== key) });
    }

    commit(lookup) {
        this._lookup = normalizeLookup(lookup);
        this.dispatchEvent(new CustomEvent('lookupchange', { detail: { lookup: this._lookup } }));
    }
}
