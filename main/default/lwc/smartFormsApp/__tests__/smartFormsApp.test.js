import { createElement } from 'lwc';
import { createApexTestWireAdapter } from '@salesforce/sfdx-lwc-jest';
import SmartFormsApp from 'c/smartFormsApp';
import getPublicFormBaseUrl from '@salesforce/apex/SmartFormsDataController.getPublicFormBaseUrl';
import getErrorCount from '@salesforce/apex/SmartFormsDataController.getErrorCount';
import getSiteStatus from '@salesforce/apex/SiteNameCheckController.getSiteStatus';
import getFormTemplates from '@salesforce/apex/FormAuraController.getFormTemplates';
import fetchObjectOptions from '@salesforce/apex/FormEditorController.fetchObjectOptions';
import fetchFieldsForObject from '@salesforce/apex/FormEditorController.fetchFieldsForObject';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
import getForms from '@salesforce/apex/SmartFormsDataController.getForms';
import getFormDetail from '@salesforce/apex/SmartFormsDataController.getFormDetail';
import getCaptchaStatus from '@salesforce/apex/CaptchaSettingsController.getStatus';

jest.mock('@salesforce/apex/CaptchaSettingsController.getStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SmartFormsDataController.getPublicFormBaseUrl', () => {
    const { createApexTestWireAdapter: adapter } = require('@salesforce/sfdx-lwc-jest');
    return { default: adapter(jest.fn()) };
}, { virtual: true });
jest.mock('@salesforce/apex/SmartFormsDataController.getErrorCount', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SmartFormsDataController.getForms', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SmartFormsDataController.getFormDetail', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SiteNameCheckController.getSiteStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SiteNameCheckController.doesSiteExist', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormAuraController.getFormTemplates', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormAuraController.saveFormTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.fetchObjectOptions', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.fetchFieldsForObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.getFormData', () => ({ default: jest.fn() }), { virtual: true });

// Lets queued promise callbacks (mocked Apex calls, re-renders) settle.
const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

function mount() {
    const el = createElement('c-smart-forms-app', { is: SmartFormsApp });
    document.body.appendChild(el);
    return el;
}

const tab = (el, view) => el.shadowRoot.querySelector(`.tab[data-view="${view}"]`);
const current = (el) => el.shadowRoot.querySelector('.tab[aria-current="page"]').dataset.view;

describe('c-smart-forms-app', () => {
    beforeEach(() => {
        getErrorCount.mockResolvedValue(2);
        getSiteStatus.mockResolvedValue({ exists: true, isReady: true });
        getFormTemplates.mockResolvedValue([]);
        fetchObjectOptions.mockResolvedValue([{ label: 'Lead (lead)', name: 'lead' }]);
        fetchFieldsForObject.mockResolvedValue([{ name: 'LastName', label: 'Last Name', type: 'STRING', required: true, picklistValues: [] }]);
        getForms.mockResolvedValue([]);
        getFormDetail.mockResolvedValue(null);
        getFormData.mockResolvedValue(null);
        getCaptchaStatus.mockResolvedValue({ connected: false, canManage: true, secretSaved: false, siteKey: '', formsUsing: 0 });
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('renders the brand bar, seven tabs and the error badge', async () => {
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('.appname').textContent).toBe('Smart Forms & Surveys (native)');
        expect(el.shadowRoot.querySelector('nav').getAttribute('aria-label')).toBe('Smart Forms & Surveys (native)');
        expect(el.shadowRoot.querySelector('.sidebar nav.tabs')).not.toBeNull();
        expect(el.shadowRoot.querySelector('.avatar')).toBeNull();
        expect(el.shadowRoot.querySelector('header')).toBeNull();
        expect(Array.from(el.shadowRoot.querySelectorAll('.tab')).map((t) => t.dataset.view)).toEqual([
            'start',
            'builder',
            'forms',
            'submissions',
            'protection',
            'help',
            'contact'
        ]);
        expect(current(el)).toBe('start');
        expect(el.shadowRoot.querySelector('.tab .count').textContent).toBe('2');
        expect(getPublicFormBaseUrl).toBeDefined();
        expect(createApexTestWireAdapter).toBeDefined();
    });

    it('switches views from the tab strip and loads data views on demand', async () => {
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('c-smart-forms-forms')).toBeNull();

        tab(el, 'forms').click();
        await flush();
        expect(current(el)).toBe('forms');
        expect(el.shadowRoot.querySelector('c-smart-forms-forms')).not.toBeNull();
        expect(getForms).toHaveBeenCalled();

        tab(el, 'help').click();
        await flush();
        expect(el.shadowRoot.querySelector('c-smart-forms-help')).not.toBeNull();
        expect(el.shadowRoot.querySelector('c-smart-forms-forms')).toBeNull();
    });

    it('hands the chosen form from Get started to the builder', async () => {
        const el = mount();
        await flush();
        const builder = el.shadowRoot.querySelector('c-smart-forms-builder');
        expect(builder.parentElement.hidden).toBe(true);

        el.shadowRoot.querySelector('c-smart-forms-start').dispatchEvent(
            new CustomEvent('openbuilder', { detail: { name: 'Enquiry', objectApiName: 'lead', objectLabel: 'Lead', formId: null } })
        );
        await flush();
        expect(current(el)).toBe('builder');
        expect(builder.parentElement.hidden).toBe(false);
        expect(builder.request).toMatchObject({ name: 'Enquiry', objectApiName: 'lead' });
        expect(fetchFieldsForObject).toHaveBeenCalledWith({ objectName: 'lead' });
    });

    it('returns to Get started in edit mode when a form is edited from Forms', async () => {
        const el = mount();
        await flush();
        tab(el, 'forms').click();
        await flush();
        el.shadowRoot.querySelector('c-smart-forms-forms').dispatchEvent(new CustomEvent('editform', { detail: { formId: 'a03AAA' } }));
        await flush();
        expect(current(el)).toBe('start');
        expect(el.shadowRoot.querySelector('c-smart-forms-start').preset).toMatchObject({ formId: 'a03AAA' });
    });

    it('shows one toast at a time, styled by variant', async () => {
        const el = mount();
        await flush();
        const start = el.shadowRoot.querySelector('c-smart-forms-start');
        start.dispatchEvent(new CustomEvent('notify', { detail: { message: 'Saved', variant: undefined } }));
        await flush();
        expect(el.shadowRoot.querySelector('.toast').textContent).toBe('Saved');
        start.dispatchEvent(new CustomEvent('notify', { detail: { message: 'Broke', variant: 'error' } }));
        await flush();
        expect(el.shadowRoot.querySelectorAll('.toast').length).toBe(1);
        expect(el.shadowRoot.querySelector('.toast--bad').textContent).toBe('Broke');
    });

    it('opens Spam protection and tells the builder when it becomes connected', async () => {
        getCaptchaStatus.mockResolvedValue({ connected: false, canManage: true, secretSaved: false, siteKey: '', formsUsing: 0 });
        const el = mount();
        await flush();
        const builder = el.shadowRoot.querySelector('c-smart-forms-builder');
        expect(builder.captchaConnected).toBe(false);

        tab(el, 'protection').click();
        await flush();
        expect(current(el)).toBe('protection');
        const protection = el.shadowRoot.querySelector('c-smart-forms-spam-protection');
        expect(protection).not.toBeNull();

        protection.dispatchEvent(new CustomEvent('protectionchange', { detail: { connected: true } }));
        await flush();
        expect(builder.captchaConnected).toBe(true);

        protection.dispatchEvent(new CustomEvent('protectionchange', { detail: { connected: false } }));
        await flush();
        expect(builder.captchaConnected).toBe(false);
    });

    it('knows at start-up that spam protection is already connected', async () => {
        getCaptchaStatus.mockResolvedValue({ connected: true, canManage: false });
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('c-smart-forms-builder').captchaConnected).toBe(true);
    });

    it('still starts when the spam protection status cannot be read', async () => {
        getCaptchaStatus.mockRejectedValue(new Error('denied'));
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('c-smart-forms-builder').captchaConnected).toBe(false);
        expect(current(el)).toBe('start');
    });

    it('sends the builder\'s "set up spam protection" request to the Spam protection tab', async () => {
        const el = mount();
        await flush();
        el.shadowRoot.querySelector('c-smart-forms-builder').dispatchEvent(new CustomEvent('goprotection'));
        await flush();
        expect(current(el)).toBe('protection');
    });

    it('navigates when Help asks it to', async () => {
        const el = mount();
        await flush();
        tab(el, 'help').click();
        await flush();
        el.shadowRoot.querySelector('c-smart-forms-help').dispatchEvent(new CustomEvent('navigate', { detail: { view: 'submissions' } }));
        await flush();
        expect(current(el)).toBe('submissions');
    });

    it('opens the Contact view and returns to Get started from it', async () => {
        const el = mount();
        await flush();
        tab(el, 'contact').click();
        await flush();
        expect(current(el)).toBe('contact');
        el.shadowRoot.querySelector('c-smart-forms-contact').dispatchEvent(new CustomEvent('navigate', { detail: { view: 'start' } }));
        await flush();
        expect(current(el)).toBe('start');
    });
});
