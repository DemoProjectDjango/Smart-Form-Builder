import { createElement } from 'lwc';
import SmartFormsBuilder from 'c/smartFormsBuilder';
import fetchFieldsForObject from '@salesforce/apex/FormEditorController.fetchFieldsForObject';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
import saveFormTemplate from '@salesforce/apex/FormAuraController.saveFormTemplate';

jest.mock('@salesforce/apex/FormEditorController.fetchFieldsForObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.getFormData', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormAuraController.saveFormTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/LookupRecordSearchController.searchRecords', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

const FIELDS = [{ name: 'Name', label: 'Account Name', type: 'STRING', required: true, picklistValues: [], referenceTo: [] }];

let token = 500;
function mount({ connected = false, formId = null } = {}) {
    const el = createElement('c-smart-forms-builder', { is: SmartFormsBuilder });
    el.captchaConnected = connected;
    document.body.appendChild(el);
    token += 1;
    el.request = { name: 'Contact us', objectApiName: 'account', objectLabel: 'Account', formId, token };
    return el;
}

const toggle = (el) => el.shadowRoot.querySelector('[data-id="captcha"]');
const hint = (el) => el.shadowRoot.querySelector('[data-id="captcha-hint"]').textContent;
const setup = (el) => el.shadowRoot.querySelector('[data-id="setup-protection"]');
const flip = (el, checked) => {
    toggle(el).checked = checked;
    toggle(el).dispatchEvent(new CustomEvent('change', { bubbles: true }));
};
const save = async (el) => {
    el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
    await flush();
};
const sentPayload = () => JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson);

describe('c-smart-forms-builder spam check', () => {
    beforeEach(() => {
        fetchFieldsForObject.mockResolvedValue(FIELDS);
        getFormData.mockResolvedValue({ id: 'a03NEW', version: 1, objectApiName: 'account', fieldConfig: '[]', captchaEnabled: false });
        saveFormTemplate.mockResolvedValue('a03NEW');
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('is switched off and unavailable until spam protection is connected', async () => {
        const el = mount({ connected: false });
        await flush();
        expect(toggle(el).checked).toBe(false);
        expect(toggle(el).disabled).toBe(true);
        expect(hint(el)).toContain('Connect Cloudflare Turnstile first');

        const goProtection = jest.fn();
        el.addEventListener('goprotection', goProtection);
        setup(el).click();
        expect(goProtection).toHaveBeenCalledTimes(1);
    });

    it('is on by default for a new form once spam protection is connected', async () => {
        const el = mount({ connected: true });
        await flush();
        expect(toggle(el).checked).toBe(true);
        expect(toggle(el).disabled).toBe(false);
        expect(setup(el)).toBeNull();

        await save(el);
        const sent = sentPayload();
        expect(sent.captchaEnabled).toBe(true);
        expect(sent.html).toContain('id="sf-captcha"');
        expect(sent.js).toContain('turnstile.render');
        expect(sent.js).toContain('_captcha');
    });

    it('turns on by itself when protection gets connected while a new form is still untouched', async () => {
        const el = mount({ connected: false });
        await flush();
        expect(toggle(el).checked).toBe(false);

        el.captchaConnected = true;
        await flush();
        expect(toggle(el).checked).toBe(true);
        expect(setup(el)).toBeNull();
    });

    it('respects a choice the admin already made', async () => {
        const el = mount({ connected: false });
        await flush();
        el.captchaConnected = true;
        await flush();
        flip(el, false);
        await flush();

        el.captchaConnected = false;
        el.captchaConnected = true;
        await flush();
        expect(toggle(el).checked).toBe(false);
    });

    it('publishes a form without any spam check when the admin switches it off', async () => {
        const el = mount({ connected: true });
        await flush();
        flip(el, false);
        await flush();
        expect(hint(el)).toContain('Switch on to add a short check');

        await save(el);
        const sent = sentPayload();
        expect(sent.captchaEnabled).toBe(false);
        expect(sent.html).not.toContain('sf-captcha');
        expect(sent.js).not.toContain('_captcha');
    });

    it('marks the form as having unapplied changes when the switch moves', async () => {
        const el = mount({ connected: true });
        await flush();
        flip(el, false);
        await flush();
        expect(el.shadowRoot.querySelector('.dirty')).not.toBeNull();
    });

    it('keeps an existing unprotected form unprotected, even when protection is connected', async () => {
        const el = mount({ connected: true, formId: 'a03EXISTING' });
        await flush();
        expect(toggle(el).checked).toBe(false);
        expect(toggle(el).disabled).toBe(false);

        await save(el);
        expect(sentPayload().captchaEnabled).toBe(false);
    });

    it('opens an existing protected form with the switch on', async () => {
        getFormData.mockResolvedValue({ id: 'a03EXISTING', version: 2, objectApiName: 'account', fieldConfig: '[]', captchaEnabled: true });
        const el = mount({ connected: true, formId: 'a03EXISTING' });
        await flush();
        expect(toggle(el).checked).toBe(true);
        expect(hint(el)).toContain('Visitors complete a short check');
    });

    it('refuses to publish a protected form after the keys were removed, and lets the admin switch it off', async () => {
        getFormData.mockResolvedValue({ id: 'a03EXISTING', version: 2, objectApiName: 'account', fieldConfig: '[]', captchaEnabled: true });
        const el = mount({ connected: false, formId: 'a03EXISTING' });
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();

        expect(toggle(el).checked).toBe(true);
        expect(toggle(el).disabled).toBe(false);
        expect(hint(el)).toContain('no longer connected');

        await save(el);
        expect(saveFormTemplate).not.toHaveBeenCalled();
        expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'error' }));

        flip(el, false);
        await flush();
        expect(toggle(el).disabled).toBe(true);
        await save(el);
        expect(saveFormTemplate).toHaveBeenCalledTimes(1);
        expect(sentPayload().captchaEnabled).toBe(false);
    });

    it('mentions the spam check in the visitor view only when it is on', async () => {
        const el = mount({ connected: true });
        await flush();
        const visitorTab = () => el.shadowRoot.querySelector('.seg button[data-view="visitor"]');
        visitorTab().click();
        await flush();
        expect(el.shadowRoot.querySelector('.visitor-note').textContent).toContain('spam check above the Submit button');

        el.shadowRoot.querySelector('.seg button[data-view="edit"]').click();
        await flush();
        flip(el, false);
        await flush();
        visitorTab().click();
        await flush();
        expect(el.shadowRoot.querySelector('.visitor-note').textContent).not.toContain('spam check');
    });
});
