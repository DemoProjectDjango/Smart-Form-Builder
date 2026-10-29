import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getForms from '@salesforce/apex/SmartFormsDataController.getForms';
import getFormDetail from '@salesforce/apex/SmartFormsDataController.getFormDetail';
import { formatDate, normalizeError, parseFieldConfig } from 'c/smartFormsModel';

const STATUS_PILL = { Active: 'pill pill--ok', Draft: 'pill pill--warn', Archived: 'pill pill--off' };
const EXAMPLE_BASE_URL = 'https://your-org.my.salesforce-sites.com/PublicForm?id=';

/**
 * "Forms": every saved form with its public link, plus a details / visitor-view panel.
 */
export default class SmartFormsForms extends NavigationMixin(LightningElement) {
    @api baseUrl = '';

    forms = [];
    query = '';
    selectedId = null;
    detail = null;
    tab = 'details';
    notFoundPreview = false;
    isLoading = true;
    showGuide = false;
    exampleUrl = EXAMPLE_BASE_URL;

    connectedCallback() {
        this.loadForms();
    }

    async loadForms() {
        this.isLoading = true;
        try {
            this.forms = (await getForms()) || [];
            if (this.forms.length && !this.forms.some((f) => f.id === this.selectedId)) {
                this.select(this.forms[0].id);
            }
        } catch (error) {
            this.forms = [];
            this.notify(`Could not load forms: ${normalizeError(error)}`, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    async select(formId) {
        this.selectedId = formId;
        this.notFoundPreview = false;
        this.detail = null;
        try {
            const detail = await getFormDetail({ formId });
            if (this.selectedId === formId) this.detail = detail;
        } catch (error) {
            this.notify(`Could not load the form: ${normalizeError(error)}`, 'error');
        }
    }

    // ── View model ───────────────────────────────────────────

    get hasUrl() {
        return !!String(this.baseUrl || '').trim();
    }

    get filtered() {
        const q = this.query.trim().toLowerCase();
        return this.forms.filter((f) => !q || String(f.name || '').toLowerCase().includes(q));
    }

    get countText() {
        const n = this.filtered.length;
        return `${n} ${n === 1 ? 'form' : 'forms'}`;
    }

    get rows() {
        return this.filtered.map((f) => ({
            key: f.id,
            id: f.id,
            name: f.name,
            objectLabel: f.objectLabel || '\u2014',
            version: f.version ? `v${f.version}` : '\u2014',
            statusLabel: f.status || 'No status',
            statusClass: STATUS_PILL[f.status] || 'pill pill--off',
            hasLink: this.hasUrl,
            created: formatDate(f.createdDate),
            selected: String(f.id === this.selectedId)
        }));
    }

    get hasRows() {
        return this.filtered.length > 0;
    }

    get emptyText() {
        if (this.isLoading) return 'Loading forms\u2026';
        return this.forms.length ? 'No forms match your search.' : 'No forms yet. Build your first one from Get started.';
    }

    get selected() {
        return this.forms.find((f) => f.id === this.selectedId) || null;
    }

    get hasSelected() {
        return !!this.selected;
    }

    get publicLink() {
        return this.selected && this.hasUrl ? `${String(this.baseUrl).trim()}${this.selected.id}` : '';
    }

    get fields() {
        return this.detail ? parseFieldConfig(this.detail.fieldConfig) : [];
    }

    get questionCount() {
        return this.detail ? this.fields.length : '\u2026';
    }

    get statusLabel() {
        return (this.selected && this.selected.status) || 'No status';
    }

    get statusClass() {
        return (this.selected && STATUS_PILL[this.selected.status]) || 'pill pill--off';
    }

    get facts() {
        const f = this.selected;
        if (!f) return [];
        return [
            ['creates', 'Creates', f.objectLabel || '\u2014'],
            ['version', 'Version', f.version ? String(f.version) : '\u2014'],
            ['status', 'Status', this.statusLabel],
            ['active', 'Active', f.isActive ? 'Yes' : 'No'],
            ['public', 'Is Public', f.isPublic ? 'Yes' : 'No'],
            ['questions', 'Questions', String(this.questionCount)],
            ['created', 'Created', formatDate(f.createdDate)]
        ].map(([key, label, value]) => ({ dtKey: `${key}-dt`, ddKey: `${key}-dd`, label, value }));
    }

    get isDetailsTab() {
        return this.tab === 'details';
    }

    get isVisitorTab() {
        return this.tab === 'visitor';
    }

    get detailsSelected() {
        return String(this.tab === 'details');
    }

    get visitorSelected() {
        return String(this.tab === 'visitor');
    }

    get formPressed() {
        return String(!this.notFoundPreview);
    }

    get wrongLinkPressed() {
        return String(this.notFoundPreview);
    }

    get previewUrl() {
        const base = String(this.baseUrl || '').trim() || EXAMPLE_BASE_URL;
        return this.notFoundPreview ? `${base}a03XXXXXXXXXXXXXXX` : `${base}${this.selectedId}`;
    }

    // ── Handlers ─────────────────────────────────────────────

    handleSearch(event) {
        this.query = event.target.value;
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

    handleTab(event) {
        this.tab = event.currentTarget.dataset.tab;
    }

    handlePreviewState(event) {
        this.notFoundPreview = event.currentTarget.dataset.notfound === 'true';
    }

    handleOpenRowLink(event) {
        event.stopPropagation();
        this.openUrl(`${String(this.baseUrl).trim()}${event.currentTarget.dataset.id}`);
    }

    handleOpenPublic() {
        this.openUrl(this.publicLink);
    }

    openUrl(url) {
        if (!/^https:\/\//i.test(url)) {
            this.notify('The form link must start with https://', 'error');
            return;
        }
        this[NavigationMixin.Navigate]({ type: 'standard__webPage', attributes: { url } });
    }

    async handleCopy() {
        const link = this.publicLink;
        const copied = await navigator.clipboard.writeText(link).then(
            () => true,
            () => false
        );
        if (copied) this.notify('Copied');
        else this.notify('Select the text and copy it manually', 'error');
    }

    handleEditForm() {
        this.dispatchEvent(new CustomEvent('editform', { detail: { formId: this.selectedId } }));
    }

    handleNewForm() {
        this.dispatchEvent(new CustomEvent('newform'));
    }

    handleGoSubmissions() {
        this.dispatchEvent(new CustomEvent('gosubmissions'));
    }

    openGuide() {
        this.showGuide = true;
    }

    closeGuide() {
        this.showGuide = false;
    }

    notify(message, variant) {
        this.dispatchEvent(new CustomEvent('notify', { detail: { message, variant } }));
    }
}
