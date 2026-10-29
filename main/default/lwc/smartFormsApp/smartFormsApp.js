import { LightningElement, wire } from 'lwc';
import getPublicFormBaseUrl from '@salesforce/apex/SmartFormsDataController.getPublicFormBaseUrl';
import getErrorCount from '@salesforce/apex/SmartFormsDataController.getErrorCount';

const VIEWS = ['start', 'builder', 'forms', 'submissions', 'help', 'contact'];

/**
 * Smart Forms & Surveys (native) app shell: left sidebar navigation and the five views
 * (Get started, Form Builder, Forms, Submissions, Help & FAQ).
 */
export default class SmartFormsApp extends LightningElement {
    productName = 'Smart Forms & Surveys (native)';
    view = 'start';
    baseUrl = '';
    errorCount = 0;
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
