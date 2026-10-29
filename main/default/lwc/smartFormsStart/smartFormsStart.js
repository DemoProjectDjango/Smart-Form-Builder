import { LightningElement, api } from 'lwc';
import getSiteStatus from '@salesforce/apex/SiteNameCheckController.getSiteStatus';
import doesSiteExist from '@salesforce/apex/SiteNameCheckController.doesSiteExist';
import getFormTemplates from '@salesforce/apex/FormAuraController.getFormTemplates';
import fetchObjectOptions from '@salesforce/apex/FormEditorController.fetchObjectOptions';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
import { normalizeError } from 'c/smartFormsModel';

const REQUIRED_SITE_NAMES = ['PublicForm', 'PublicForms'];
const EXAMPLE_BASE_URL = 'https://your-org.my.salesforce-sites.com/PublicForm?id=';

/**
 * "Get started": public-site readiness, create/edit chooser, site-name checker, setup guide.
 */
export default class SmartFormsStart extends LightningElement {
    checking = true;
    siteReady = false;
    siteReason = '';
    showGuide = false;

    mode = 'new';
    formOptions = [];
    objectOptions = [];
    selectedFormId = '';
    formName = '';
    objectApiName = '';
    nameError = false;
    objectError = false;

    siteName = '';
    siteNameError = false;
    verifying = false;
    verdictOk = null;
    verdictName = '';

    exampleUrl = EXAMPLE_BASE_URL;
    _preset = null;

    /** Pre-selects "Edit an existing form" ({ formId, token }; used by Forms > Edit in Form Builder). */
    @api
    get preset() {
        return this._preset;
    }
    set preset(value) {
        const formId = value && value.formId ? value.formId : '';
        if (!formId || (this._preset && this._preset.token === value.token)) return;
        this._preset = value;
        this.mode = 'edit';
        this.selectedFormId = formId;
        this.loadFormDetails(formId);
    }

    connectedCallback() {
        this.checkSite(false);
        this.loadForms();
        this.loadObjects();
    }

    // ── Loading ──────────────────────────────────────────────

    async checkSite(announce) {
        this.checking = true;
        this.siteReason = '';
        try {
            const results = await Promise.all(REQUIRED_SITE_NAMES.map((n) => getSiteStatus({ siteName: n })));
            const best = results.find((r) => r && r.isReady) || results.find((r) => r && r.exists) || results[0];
            this.siteReady = !!(best && best.isReady);
            if (this.siteReady) {
                this.showGuide = false;
            } else {
                this.showGuide = !announce;
                this.siteReason = (best && best.reason) || 'Public form site not found or not Active.';
            }
        } catch (error) {
            this.siteReady = false;
            this.showGuide = !announce;
            this.siteReason = normalizeError(error);
        } finally {
            this.checking = false;
        }
        if (announce) {
            this.notify(
                this.siteReady ? 'Checked: site PublicForm is Active' : 'Still not ready: site is not Active',
                this.siteReady ? 'info' : 'error'
            );
        }
    }

    async loadForms() {
        const forms = await getFormTemplates().catch(() => []);
        this.formOptions = (forms || []).map((f) => ({ label: f.label, value: f.value }));
    }

    async loadObjects() {
        const objects = await fetchObjectOptions().catch(() => []);
        this.objectOptions = (objects || []).map((o) => ({ label: o.label, value: o.name }));
    }

    async loadFormDetails(formId) {
        const data = await getFormData({ formId }).catch(() => null);
        if (formId !== this.selectedFormId) return;
        this.formName = (data && data.name) || '';
        this.objectApiName = (data && data.objectApiName) || '';
    }

    // ── View model ───────────────────────────────────────────

    get locked() {
        return this.checking || !this.siteReady;
    }

    get statusCardClass() {
        if (this.checking) return 'status-card status-card--wait';
        return this.siteReady ? 'status-card status-card--ok' : 'status-card status-card--bad';
    }

    get statusIcon() {
        return this.siteReady ? 'check' : 'warn';
    }

    get showReady() {
        return !this.checking && this.siteReady;
    }

    get showMissing() {
        return !this.checking && !this.siteReady;
    }

    get panelClass() {
        return this.locked ? 'panel locked-overlay' : 'panel';
    }

    get isEditMode() {
        return this.mode === 'edit';
    }

    get newPressed() {
        return String(this.mode === 'new');
    }

    get editPressed() {
        return String(this.mode === 'edit');
    }

    get formSelectOptions() {
        return this.formOptions.map((o) => ({ ...o, selected: o.value === this.selectedFormId }));
    }

    get objectSelectOptions() {
        const current = String(this.objectApiName || '').toLowerCase();
        return this.objectOptions.map((o) => ({
            ...o,
            selected: String(o.value).toLowerCase() === current
        }));
    }

    get objectLocked() {
        return this.locked || !!this.selectedFormId;
    }

    get nameInvalid() {
        return String(this.nameError);
    }

    get objectInvalid() {
        return String(this.objectError);
    }

    get verdictText() {
        if (this.verdictOk === null) return '';
        return this.verdictOk
            ? `Verified: a site named \u201c${this.verdictName}\u201d exists`
            : `Failed: no site named \u201c${this.verdictName}\u201d was found`;
    }

    get verdictClass() {
        return this.verdictOk ? 'verdict verdict--ok' : 'verdict verdict--bad';
    }

    get verdictIcon() {
        return this.verdictOk ? 'ok' : 'bad';
    }

    // ── Handlers ─────────────────────────────────────────────

    handleMode(event) {
        const next = event.currentTarget.dataset.mode;
        if (next === this.mode) return;
        this.mode = next;
        if (next === 'new') {
            this.selectedFormId = '';
            this.formName = '';
            this.objectApiName = '';
            this.nameError = false;
            this.objectError = false;
            Promise.resolve().then(() => {
                const input = this.template.querySelector('[data-id="name"]');
                if (input) input.focus();
            });
        }
    }

    handleFormSelect(event) {
        this.selectedFormId = event.target.value;
        if (!this.selectedFormId) {
            this.formName = '';
            this.objectApiName = '';
            return;
        }
        this.loadFormDetails(this.selectedFormId);
    }

    handleName(event) {
        this.formName = event.target.value;
        if (this.formName.trim()) this.nameError = false;
    }

    handleObject(event) {
        this.objectApiName = event.target.value;
        if (this.objectApiName) this.objectError = false;
    }

    handleNext() {
        const name = (this.formName || '').trim();
        this.nameError = !name;
        this.objectError = !this.objectApiName;
        if (this.nameError || this.objectError) return;
        const chosen = this.objectOptions.find(
            (o) => String(o.value).toLowerCase() === String(this.objectApiName).toLowerCase()
        );
        this.dispatchEvent(
            new CustomEvent('openbuilder', {
                detail: {
                    name,
                    objectApiName: this.objectApiName,
                    objectLabel: chosen ? chosen.label.replace(/\s*\([^)]*\)$/, '') : this.objectApiName,
                    formId: this.selectedFormId || null
                }
            })
        );
    }

    handleSiteName(event) {
        this.siteName = event.target.value;
        if (this.siteName.trim()) this.siteNameError = false;
    }

    handleSiteNameKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.handleVerify();
        }
    }

    async handleVerify() {
        const name = (this.siteName || '').trim();
        this.siteNameError = !name;
        this.verdictOk = null;
        if (!name) return;
        this.verifying = true;
        const exists = await doesSiteExist({ siteName: name }).catch(() => null);
        this.verifying = false;
        if (exists === null) {
            this.notify('Error checking site name. Please try again.', 'error');
            return;
        }
        this.verdictOk = !!exists;
        this.verdictName = name;
    }

    handleRecheck() {
        this.checkSite(true);
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
