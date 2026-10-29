import { LightningElement } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getSubmissions from '@salesforce/apex/SmartFormsDataController.getSubmissions';
import getSubmissionDetail from '@salesforce/apex/SmartFormsDataController.getSubmissionDetail';
import { formatDate, normalizeError, parseJson } from 'c/smartFormsModel';

const ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;
const LIST_LIMIT = 200;

function describeResult(summary) {
    if (summary.hasError) return { label: 'Error', cls: 'pill pill--bad' };
    const rec = summary.firstRecord;
    if (rec) {
        return { label: `${rec.action || 'Saved'} ${rec.objectLabel || rec.objectApiName || ''}`.trim(), cls: 'pill pill--ok' };
    }
    return { label: 'Received', cls: 'pill pill--off' };
}

/**
 * "Submissions": everything visitors sent, with the record each one created or the error that stopped it.
 */
export default class SmartFormsSubmissions extends NavigationMixin(LightningElement) {
    filter = 'all';
    all = [];
    selectedId = null;
    detail = null;
    payloadView = 'table';
    isLoading = true;

    connectedCallback() {
        this.loadList();
    }

    async loadList() {
        this.isLoading = true;
        try {
            this.all = (await getSubmissions()) || [];
            this.ensureSelection();
        } catch (error) {
            this.all = [];
            this.notify(`Could not load submissions: ${normalizeError(error)}`, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    ensureSelection() {
        if (this.submissions.some((s) => s.id === this.selectedId)) return;
        this.selectedId = null;
        this.detail = null;
        if (this.submissions.length) this.select(this.submissions[0].id);
    }

    async select(id) {
        this.selectedId = id;
        this.detail = null;
        this.payloadView = 'table';
        try {
            const detail = await getSubmissionDetail({ submissionId: id });
            if (this.selectedId === id) this.detail = detail;
        } catch (error) {
            this.notify(`Could not load the submission: ${normalizeError(error)}`, 'error');
        }
    }

    // ── View model ───────────────────────────────────────────

    get submissions() {
        if (this.filter === 'all') return this.all;
        return this.all.filter((s) => (this.filter === 'err' ? s.hasError : !s.hasError));
    }

    get allPressed() {
        return String(this.filter === 'all');
    }

    get okPressed() {
        return String(this.filter === 'ok');
    }

    get errPressed() {
        return String(this.filter === 'err');
    }

    get rows() {
        return this.submissions.map((s) => {
            const result = describeResult(s);
            return {
                key: s.id,
                id: s.id,
                name: s.name,
                formName: s.formName || '\u2014',
                resultLabel: result.label,
                resultClass: result.cls,
                created: formatDate(s.createdDate, true),
                selected: String(s.id === this.selectedId)
            };
        });
    }

    get hasRows() {
        return this.submissions.length > 0;
    }

    get emptyText() {
        if (this.isLoading) return 'Loading submissions\u2026';
        return this.filter === 'all' ? 'No submissions yet.' : 'No submissions match this filter.';
    }

    get atLimit() {
        return this.all.length >= LIST_LIMIT;
    }

    get limitText() {
        return `Showing the latest ${LIST_LIMIT} submissions.`;
    }

    get hasDetail() {
        return !!this.detail;
    }

    get summary() {
        return this.detail ? this.detail.summary : null;
    }

    get headerMeta() {
        const s = this.summary;
        return s ? `${s.formName || '\u2014'} \u00b7 ${formatDate(s.createdDate, true)}` : '';
    }

    get headerResult() {
        return this.summary ? describeResult({ ...this.summary, firstRecord: (this.detail.records || [])[0] }) : { label: '', cls: '' };
    }

    get isError() {
        return !!(this.summary && this.summary.hasError);
    }

    get errorText() {
        return (this.detail && this.detail.errorMessage) || 'Unknown error';
    }

    get resultTitle() {
        const rec = this.records[0];
        if (!rec) return 'Submission received';
        return `Record ${String(rec.action || 'saved').toLowerCase()}`;
    }

    get resultText() {
        const rec = this.records[0];
        if (!rec) return 'No record has been linked to this submission yet.';
        return `This submission ${String(rec.action || 'saved').toLowerCase()} a ${rec.objectLabel || rec.objectApiName} record.`;
    }

    get records() {
        return ((this.detail && this.detail.records) || []).map((r, i) => ({
            ...r,
            key: `${r.recordId}-${i}`,
            objectDisplay: r.objectLabel || r.objectApiName,
            canOpen: ID_PATTERN.test(String(r.recordId || ''))
        }));
    }

    get hasRecords() {
        return this.records.length > 0;
    }

    get payloadEntries() {
        const payload = this.parsedPayload;
        return Object.keys(payload).map((k) => ({
            key: k,
            dtKey: `${k}-dt`,
            ddKey: `${k}-dd`,
            name: k,
            value: typeof payload[k] === 'object' && payload[k] !== null ? JSON.stringify(payload[k]) : String(payload[k])
        }));
    }

    get parsedPayload() {
        const raw = this.detail && this.detail.payloadJson;
        if (!raw) return {};
        const { value: parsed, error } = parseJson(raw);
        if (error) return { payload: raw };
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
    }

    get payloadJsonText() {
        const raw = this.detail && this.detail.payloadJson;
        if (!raw) return '';
        const { value, error } = parseJson(raw);
        return error ? raw : JSON.stringify(value, null, 2);
    }

    get isTableView() {
        return this.payloadView === 'table';
    }

    get isJsonView() {
        return this.payloadView === 'json';
    }

    get tablePressed() {
        return String(this.payloadView === 'table');
    }

    get jsonPressed() {
        return String(this.payloadView === 'json');
    }

    // ── Handlers ─────────────────────────────────────────────

    handleFilter(event) {
        const next = event.currentTarget.dataset.filter;
        if (next === this.filter) return;
        this.filter = next;
        this.ensureSelection();
    }

    handleRowClick(event) {
        const id = event.currentTarget.dataset.id;
        if (id && id !== this.selectedId) this.select(id);
    }

    handleRowKey(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.handleRowClick(event);
        }
    }

    handlePayloadView(event) {
        this.payloadView = event.currentTarget.dataset.view;
    }

    handleOpenRecord(event) {
        const { id, object } = event.currentTarget.dataset;
        if (!ID_PATTERN.test(String(id || ''))) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, objectApiName: object, actionName: 'view' }
        });
    }

    notify(message, variant) {
        this.dispatchEvent(new CustomEvent('notify', { detail: { message, variant } }));
    }
}
