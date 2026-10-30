import { LightningElement, wire } from 'lwc';
import getPublicFormBaseUrl from '@salesforce/apex/SmartFormsDataController.getPublicFormBaseUrl';
import getErrorCount from '@salesforce/apex/SmartFormsDataController.getErrorCount';
import getCaptchaStatus from '@salesforce/apex/CaptchaSettingsController.getStatus';

const VIEWS = ['start', 'builder', 'forms', 'submissions', 'protection', 'help', 'contact'];

/**
 * Smart Forms & Surveys (native) app shell: left sidebar navigation and its views
 * (Get started, Form Builder, Forms, Submissions, Spam protection, Help & FAQ, Contact).
 */
export default class SmartFormsApp extends LightningElement {
    productName = 'Smart Forms & Surveys (native)';
    view = 'start';
    baseUrl = '';
    errorCount = 0;
    captchaConnected = false;
    builderRequest = null;
    startPreset = null;
    toasts = [];

    _token = 0;
    _toastId = 0;

    @wire(getPublicFormBaseUrl)
    wiredBaseUrl({ data }) {
        this.baseUrl = (data || '').trim();
    }

    connectedCallback() {
        this.refreshErrorCount();
        this.refreshCaptchaStatus();
    }

    /** Whether spam protection is connected decides if forms may switch on the spam check. */
    async refreshCaptchaStatus() {
        const status = await getCaptchaStatus().catch(() => null);
        this.captchaConnected = !!(status && status.connected);
    }

    async refreshErrorCount() {
        this.errorCount = (await getErrorCount().catch(() => 0)) || 0;
    }

    // ── View model ───────────────────────────────────────────

    get tabs() {
        return [
            { id: 'start', label: 'Get started', icon: 'book' },
            { id: 'builder', label: 'Form Builder', icon: 'edit' },
            { id: 'forms', label: 'Forms', icon: 'logo' },
            { id: 'submissions', label: 'Submissions', icon: 'ok', badge: this.errorCount },
            { id: 'protection', label: 'Spam protection', icon: 'shield' },
            { id: 'help', label: 'Help & FAQ', icon: 'info', separated: true },
            { id: 'contact', label: 'Contact', icon: 'mail' }
        ].map((t) => ({
            ...t,
            key: t.id,
            hasBadge: !!t.badge,
            badgeLabel: t.badge ? `${t.badge} with errors` : '',
            tabClass: t.separated ? 'tab tab--sep' : 'tab',
            current: this.view === t.id ? 'page' : null
        }));
    }

    get isStart() {
        return this.view === 'start';
    }

    get isBuilder() {
        return this.view === 'builder';
    }

    get isForms() {
        return this.view === 'forms';
    }

    get isSubmissions() {
        return this.view === 'submissions';
    }

    get isProtection() {
        return this.view === 'protection';
    }

    get isHelp() {
        return this.view === 'help';
    }

    get isContact() {
        return this.view === 'contact';
    }

    get hideStart() {
        return !this.isStart;
    }

    get hideBuilder() {
        return !this.isBuilder;
    }

    // ── Navigation ───────────────────────────────────────────

    goTo(view) {
        if (!VIEWS.includes(view) || view === this.view) return;
        this.view = view;
        if (view !== 'submissions') this.refreshErrorCount();
        const top = this.template.querySelector('[data-id="top"]');
        if (top && typeof top.scrollIntoView === 'function') top.scrollIntoView({ block: 'start' });
    }

    handleTab(event) {
        this.goTo(event.currentTarget.dataset.view);
    }

    handleNavigate(event) {
        this.goTo(event.detail.view);
    }

    handleGoStart() {
        this.goTo('start');
    }

    handleGoSubmissions() {
        this.goTo('submissions');
    }

    handleGoProtection() {
        this.goTo('protection');
    }

    handleProtectionChange(event) {
        this.captchaConnected = !!(event.detail && event.detail.connected);
    }

    handleOpenBuilder(event) {
        this._token += 1;
        this.builderRequest = { ...event.detail, token: this._token };
        this.goTo('builder');
    }

    handleEditForm(event) {
        this._token += 1;
        this.startPreset = { formId: event.detail.formId, token: this._token };
        this.goTo('start');
    }

    handleSaved() {
        this.refreshErrorCount();
    }

    // ── Toast ────────────────────────────────────────────────

    handleNotify(event) {
        const { message, variant } = event.detail || {};
        if (!message) return;
        this._toastId += 1;
        this.toasts = [
            {
                id: `toast-${this._toastId}`,
                message,
                toastClass: variant === 'error' ? 'toast toast--bad' : 'toast'
            }
        ];
    }
}
