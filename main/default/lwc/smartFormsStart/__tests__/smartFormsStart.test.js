import { createElement } from 'lwc';
import SmartFormsStart from 'c/smartFormsStart';
import getSiteStatus from '@salesforce/apex/SiteNameCheckController.getSiteStatus';
import doesSiteExist from '@salesforce/apex/SiteNameCheckController.doesSiteExist';
import getFormTemplates from '@salesforce/apex/FormAuraController.getFormTemplates';
import fetchObjectOptions from '@salesforce/apex/FormEditorController.fetchObjectOptions';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';

jest.mock('@salesforce/apex/SiteNameCheckController.getSiteStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SiteNameCheckController.doesSiteExist', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormAuraController.getFormTemplates', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.fetchObjectOptions', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.getFormData', () => ({ default: jest.fn() }), { virtual: true });

// Lets queued promise callbacks (mocked Apex calls, re-renders) settle.
const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

function mount(props = {}) {
    const el = createElement('c-smart-forms-start', { is: SmartFormsStart });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
}

const setValue = (control, value, type = 'input') => {
    control.value = value;
    control.dispatchEvent(new CustomEvent(type));
};

describe('c-smart-forms-start', () => {
    beforeEach(() => {
        getSiteStatus.mockResolvedValue({ exists: true, isReady: true });
        getFormTemplates.mockResolvedValue([{ label: 'Website enquiry', value: 'a03AAA' }]);
        fetchObjectOptions.mockResolvedValue([
            { label: 'Lead (lead)', name: 'lead' },
            { label: 'Case (case)', name: 'case' }
        ]);
        getFormData.mockResolvedValue({ name: 'Website enquiry', objectApiName: 'lead' });
        doesSiteExist.mockResolvedValue(true);
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('shows the ready card and unlocks the build panel', async () => {
        const el = mount();
        await flush();
        expect(getSiteStatus).toHaveBeenCalledWith({ siteName: 'PublicForm' });
        expect(getSiteStatus).toHaveBeenCalledWith({ siteName: 'PublicForms' });
        expect(el.shadowRoot.querySelector('.status-card--ok h2').textContent).toBe('Your public site is ready');
        expect(el.shadowRoot.querySelector('.panel.locked-overlay')).toBeNull();
        expect(el.shadowRoot.querySelector('c-public-form-instructions-modal').open).toBe(false);
    });

    it('locks building and opens the setup guide when the site is not ready', async () => {
        getSiteStatus.mockResolvedValue({ exists: true, isReady: false, reason: 'Site exists but is not Active.' });
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('.status-card--bad').textContent).toContain('Reason: Site exists but is not Active.');
        expect(el.shadowRoot.querySelector('.panel.locked-overlay')).not.toBeNull();
        expect(el.shadowRoot.querySelector('.lock-content button.btn--primary').disabled).toBe(true);
        expect(el.shadowRoot.querySelector('c-public-form-instructions-modal').open).toBe(true);
    });

    it('treats a failed site check as not ready', async () => {
        getSiteStatus.mockRejectedValue({ body: { message: 'No Sites access' } });
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('.status-card--bad').textContent).toContain('No Sites access');
    });

    it('announces the recheck result', async () => {
        const el = mount();
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        el.shadowRoot.querySelector('.status-card .btn--sm').click();
        await flush();
        expect(notify).toHaveBeenCalledWith({ message: 'Checked: site PublicForm is Active', variant: 'info' });
    });

    it('validates the name and object before handing over to the builder', async () => {
        const el = mount();
        const opened = jest.fn();
        el.addEventListener('openbuilder', (e) => opened(e.detail));
        await flush();

        el.shadowRoot.querySelector('.lock-content button.btn--primary').click();
        await flush();
        expect(opened).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelectorAll('.field .err').length).toBe(2);

        setValue(el.shadowRoot.querySelector('[data-id="name"]'), '  Website enquiry ');
        setValue(el.shadowRoot.querySelector('select.select'), 'lead', 'change');
        el.shadowRoot.querySelector('.lock-content button.btn--primary').click();
        expect(opened).toHaveBeenCalledWith({ name: 'Website enquiry', objectApiName: 'lead', objectLabel: 'Lead', formId: null });
    });

    it('fills name and object from an existing form and locks the object', async () => {
        const el = mount();
        const opened = jest.fn();
        el.addEventListener('openbuilder', (e) => opened(e.detail));
        await flush();

        el.shadowRoot.querySelector('[data-mode="edit"]').click();
        await flush();
        const picker = el.shadowRoot.querySelector('select.select');
        setValue(picker, 'a03AAA', 'change');
        await flush();
        expect(getFormData).toHaveBeenCalledWith({ formId: 'a03AAA' });
        expect(el.shadowRoot.querySelector('[data-id="name"]').value).toBe('Website enquiry');
        const objectSelect = el.shadowRoot.querySelectorAll('select.select')[1];
        expect(objectSelect.disabled).toBe(true);

        el.shadowRoot.querySelector('.lock-content button.btn--primary').click();
        expect(opened).toHaveBeenCalledWith(expect.objectContaining({ formId: 'a03AAA', objectApiName: 'lead' }));
    });

    it('preselects edit mode from the preset', async () => {
        const el = mount();
        await flush();
        el.preset = { formId: 'a03AAA', token: 1 };
        await flush();
        expect(el.shadowRoot.querySelector('[data-mode="edit"]').getAttribute('aria-pressed')).toBe('true');
        expect(el.shadowRoot.querySelector('[data-id="name"]').value).toBe('Website enquiry');
    });

    it('verifies a site name and reports the verdict', async () => {
        const el = mount();
        await flush();
        const verify = el.shadowRoot.querySelector('.verify-row .btn');
        verify.click();
        await flush();
        expect(el.shadowRoot.querySelector('.err[role="alert"]')).not.toBeNull();

        setValue(el.shadowRoot.querySelector('.verify-row input'), 'PublicForm');
        verify.click();
        await flush();
        expect(el.shadowRoot.querySelector('.verdict--ok').textContent).toContain('Verified: a site named “PublicForm” exists');

        doesSiteExist.mockResolvedValue(false);
        verify.click();
        await flush();
        expect(el.shadowRoot.querySelector('.verdict--bad').textContent).toContain('Failed: no site named “PublicForm” was found');
    });
});
