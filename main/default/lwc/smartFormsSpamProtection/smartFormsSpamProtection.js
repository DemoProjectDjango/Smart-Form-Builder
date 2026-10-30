import { LightningElement, api } from 'lwc';
import getStatus from '@salesforce/apex/CaptchaSettingsController.getStatus';
import saveKeys from '@salesforce/apex/CaptchaSettingsController.saveKeys';
import testConnection from '@salesforce/apex/CaptchaSettingsController.testConnection';
import clearKeys from '@salesforce/apex/CaptchaSettingsController.clearKeys';
import { normalizeError } from 'c/smartFormsModel';

const EMPTY = { siteKey: '', secretSaved: false, connected: false, canManage: false, formsUsing: 0, message: '' };

/**
 * "Spam protection" view: guided setup for Cloudflare Turnstile. The admin pastes the site key and secret
 * key from their own Cloudflare widget; the secret is write-only (it is never sent back to the browser).
 * Forms can require the check only after the connection test has passed.
 */
export default class SmartFormsSpamProtection extends LightningElement {
    /** Public form link base (ends in "?id="); used to tell the admin which hostname to allow. */
    @api baseUrl = '';

    status = { ...EMPTY };
    siteKey = '';
    secretKey = '';
    loaded = false;
    busy = '';
    message = '';
    messageBad = false;
    confirmingClear = false;

    connectedCallback() {
        this.load();
    }

    async load() {
        this.busy = 'load';
        try {
            this.apply(await getStatus());
        } catch (error) {
            this.show(normalizeError(error), true);
        }
        this.loaded = true;
        this.busy = '';
    }

    apply(status) {
        this.status = { ...EMPTY, ...status };
        this.siteKey = this.status.siteKey;
        this.secretKey = '';
    }

    show(text, bad) {
        this.message = text || '';
        this.messageBad = !!bad;
        if (text) {
            this.dispatchEvent(new CustomEvent('notify', { detail: { message: text, variant: bad ? 'error' : 'success' } }));
        }
    }

    announce(connected) {
        this.dispatchEvent(new CustomEvent('protectionchange', { detail: { connected, canManage: this.status.canManage } }));
    }

    // ── View model ───────────────────────────────────────────

    get canManage() {
        return !!this.status.canManage;
    }

    get readOnly() {
        return !this.canManage;
    }

    get isConnected() {
        return !!this.status.connected;
    }

    get statusText() {
        if (!this.loaded) return 'Checking…';
        if (this.isConnected) return 'Connected';
        return this.status.secretSaved ? 'Keys saved, not tested' : 'Not connected';
    }

    get statusClass() {
        return this.isConnected ? 'chip chip--ok' : 'chip';
    }

    get formHost() {
        const match = /^https?:\/\/([^/?#\s]+)/i.exec(String(this.baseUrl || '').trim());
        return match ? match[1] : '';
    }

    get hostHint() {
        return this.formHost ? `Your public form link uses ${this.formHost}.` : 'Use the domain from your public form link.';
    }

    get secretPlaceholder() {
        return this.status.secretSaved ? 'Saved. Leave blank to keep it' : 'Paste the secret key';
    }

    get hasUnsavedChanges() {
        return this.siteKey.trim() !== this.status.siteKey || this.secretKey.trim() !== '';
    }

    get saveDisabled() {
        return !!this.busy || this.readOnly || !this.siteKey.trim() || (!this.secretKey.trim() && !this.status.secretSaved);
    }

    get testDisabled() {
        return !!this.busy || this.readOnly || !this.status.secretSaved || this.hasUnsavedChanges;
    }

    get clearDisabled() {
        return !!this.busy || this.readOnly;
    }

    get hasKeys() {
        return !!this.status.siteKey || this.status.secretSaved;
    }

    get messageClass() {
        return this.messageBad ? 'note note--bad' : 'note note--ok';
    }

    get hasMessage() {
        return !!this.message;
    }

    get hasFormsUsing() {
        return this.status.formsUsing > 0;
    }

    get formsUsingText() {
        const n = this.status.formsUsing;
        return `${n} ${n === 1 ? 'form requires' : 'forms require'} the spam check. ${n === 1 ? 'It' : 'They'} will stop accepting submissions until new keys are saved and tested.`;
    }

    get saveLabel() {
        return this.busy === 'save' ? 'Saving…' : 'Save and test';
    }

    get testLabel() {
        return this.busy === 'test' ? 'Testing…' : 'Test connection';
    }

    // ── Handlers ─────────────────────────────────────────────

    handleSiteKey(event) {
        this.siteKey = event.target.value;
    }

    handleSecretKey(event) {
        this.secretKey = event.target.value;
    }

    async handleSave() {
        if (this.saveDisabled) return;
        this.busy = 'save';
        this.message = '';
        try {
            this.apply(await saveKeys({ siteKey: this.siteKey, secretKey: this.secretKey }));
            this.announce(false);
            await this.runTest();
        } catch (error) {
            this.show(normalizeError(error), true);
        }
        this.busy = '';
    }

    async handleTest() {
        if (this.testDisabled) return;
        this.busy = 'test';
        this.message = '';
        try {
            await this.runTest();
        } catch (error) {
            this.show(normalizeError(error), true);
        }
        this.busy = '';
    }

    async runTest() {
        const status = await testConnection();
        this.apply(status);
        this.announce(this.isConnected);
        this.show(
            this.isConnected
                ? 'Connected. You can now switch on the spam check for any form in the Form Builder.'
                : status.message || 'The connection test failed.',
            !this.isConnected
        );
    }

    handleAskClear() {
        this.confirmingClear = true;
    }

    handleCancelClear() {
        this.confirmingClear = false;
    }

    async handleClear() {
        this.busy = 'clear';
        this.message = '';
        try {
            this.apply(await clearKeys());
            this.announce(false);
            this.show('Keys removed.', false);
        } catch (error) {
            this.show(normalizeError(error), true);
        }
        this.confirmingClear = false;
        this.busy = '';
    }
}
