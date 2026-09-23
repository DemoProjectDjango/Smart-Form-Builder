import { LightningElement, track } from 'lwc';
import getSiteStatus from '@salesforce/apex/SiteNameCheckController.getSiteStatus';

const REQUIRED_SITE_NAMES = ['PublicForm', 'PublicForms'];

const EXAMPLE_BASE_URL =
    'https://your-org.my.salesforce-sites.com/PublicForm?id=';

export default class PublicFormConfiguratorGate extends LightningElement {
    @track isLoading = true;
    @track isReady = false;
    @track statusReason = '';
    @track showModal = false;

    exampleBaseUrl = EXAMPLE_BASE_URL;

    connectedCallback() {
        this.checkStatus();
    }

    async checkStatus() {
        this.isLoading = true;
        this.statusReason = '';
        this.isReady = false;

        try {
            const results = await Promise.all(
                REQUIRED_SITE_NAMES.map((n) => getSiteStatus({ siteName: n }))
            );

            const best =
                results.find((r) => r && r.isReady) ||
                results.find((r) => r && r.exists) ||
                results[0];

            this.isReady = !!(best && best.isReady);

            // ✅ Requirement: if found/ready, modal disappears (including after Recheck)
            if (this.isReady) {
                this.showModal = false;
                this.statusReason = '';
            } else {
                this.showModal = true;
                const reason = best && best.reason ? best.reason : '';
                this.statusReason = reason || 'Public form site not found or not Active.';
            }
        } catch (e) {
            this.isReady = false;
            this.showModal = true;
            this.statusReason = this.normalizeError(e);
        } finally {
            this.isLoading = false;
        }
    }

    openModal() {
        this.showModal = true;
    }

    closeModal() {
        this.showModal = false;
    }

    recheck() {
        this.checkStatus();
    }

    normalizeError(e) {
        try {
            if (!e) return 'Unknown error';
            if (Array.isArray(e.body)) return e.body.map((x) => x.message).join(', ');
            if (e.body && e.body.message) return e.body.message;
            if (e.message) return e.message;
            return 'Unknown error';
        } catch {
            return 'Unknown error';
        }
    }
}