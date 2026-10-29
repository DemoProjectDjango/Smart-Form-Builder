import { createElement } from 'lwc';
import SmartFormsForms from 'c/smartFormsForms';
import { NavigationMixin } from 'lightning/navigation';
import getForms from '@salesforce/apex/SmartFormsDataController.getForms';
import getFormDetail from '@salesforce/apex/SmartFormsDataController.getFormDetail';

jest.mock('@salesforce/apex/SmartFormsDataController.getForms', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SmartFormsDataController.getFormDetail', () => ({ default: jest.fn() }), { virtual: true });

// Lets queued promise callbacks (mocked Apex calls, re-renders) settle.
const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

const FORMS = [
    { id: 'a03AAA', name: 'Website enquiry', objectLabel: 'Lead', version: 4, status: 'Active', isActive: true, isPublic: true, createdDate: '2026-10-02T10:00:00Z' },
    { id: 'a03BBB', name: 'Support request', objectLabel: 'Case', version: 1, status: null, isActive: false, isPublic: true, createdDate: '2026-10-21T10:00:00Z' }
];

function mount(props = {}) {
    const el = createElement('c-smart-forms-forms', { is: SmartFormsForms });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
}

describe('c-smart-forms-forms', () => {
    beforeEach(() => {
        getForms.mockResolvedValue(FORMS);
        getFormDetail.mockImplementation(({ formId }) =>
            Promise.resolve({
                ...FORMS.find((f) => f.id === formId),
                fieldConfig: JSON.stringify([{ apiName: 'Email', label: 'Email', type: 'EMAIL', required: true }])
            })
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('lists forms and selects the first one', async () => {
        const el = mount({ baseUrl: 'https://acme.example.com/?id=' });
        await flush();
        const rows = el.shadowRoot.querySelectorAll('tbody tr');
        expect(rows.length).toBe(2);
        expect(rows[0].getAttribute('aria-selected')).toBe('true');
        expect(rows[1].textContent).toContain('No status');
        expect(el.shadowRoot.querySelector('.muted.small[aria-live]').textContent).toBe('2 forms');
        expect(el.shadowRoot.querySelector('.panel__head h2').textContent).toBe('Website enquiry');
        expect(el.shadowRoot.querySelector('.linkbox code').textContent).toBe('https://acme.example.com/?id=a03AAA');
        expect(el.shadowRoot.querySelector('dl.kv').textContent).toContain('Questions1');
    });

    it('filters by name and switches the selected form', async () => {
        const el = mount({ baseUrl: 'https://acme.example.com/?id=' });
        await flush();
        const search = el.shadowRoot.querySelector('input[type="search"]');
        search.value = 'support';
        search.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(el.shadowRoot.querySelectorAll('tbody tr').length).toBe(1);
        el.shadowRoot.querySelector('tbody tr').click();
        await flush();
        expect(el.shadowRoot.querySelector('.panel__head h2').textContent).toBe('Support request');
        search.value = 'zzz';
        search.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(el.shadowRoot.querySelector('.plain-row').textContent).toContain('No forms match your search.');
    });

    it('opens the public link through navigation, only for https urls', async () => {
        const el = mount({ baseUrl: 'https://acme.example.com/?id=' });
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        el.shadowRoot.querySelector('.row .btn--primary').click();
        expect(el[NavigationMixin.Navigate]).toBeUndefined();

        const insecure = mount({ baseUrl: 'http://acme.example.com/?id=' });
        const insecureNotify = jest.fn();
        insecure.addEventListener('notify', (e) => insecureNotify(e.detail));
        await flush();
        insecure.shadowRoot.querySelector('.row .btn--primary').click();
        expect(insecureNotify).toHaveBeenCalledWith({ message: 'The form link must start with https://', variant: 'error' });
    });

    it('explains when the site url is not configured', async () => {
        const el = mount({ baseUrl: '' });
        await flush();
        expect(el.shadowRoot.querySelector('.note--warn').textContent).toContain('Site URL not configured');
        expect(el.shadowRoot.querySelector('.row .btn--primary').disabled).toBe(true);
        expect(el.shadowRoot.querySelector('tbody tr').textContent).toContain('Not available');
        el.shadowRoot.querySelector('.inline-btn').click();
        await flush();
        expect(el.shadowRoot.querySelector('c-public-form-instructions-modal').open).toBe(true);
    });

    it('previews the visitor view including the wrong-link state', async () => {
        const el = mount({ baseUrl: 'https://acme.example.com/?id=' });
        await flush();
        el.shadowRoot.querySelector('[data-tab="visitor"]').click();
        await flush();
        const visitor = el.shadowRoot.querySelector('c-smart-forms-visitor');
        expect(visitor.formName).toBe('Website enquiry');
        expect(visitor.notFound).toBe(false);
        el.shadowRoot.querySelector('[data-notfound="true"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('c-smart-forms-visitor').notFound).toBe(true);
    });

    it('raises editform, gosubmissions and newform events', async () => {
        const el = mount({ baseUrl: 'https://acme.example.com/?id=' });
        const edit = jest.fn();
        const subs = jest.fn();
        const fresh = jest.fn();
        el.addEventListener('editform', (e) => edit(e.detail));
        el.addEventListener('gosubmissions', subs);
        el.addEventListener('newform', fresh);
        await flush();
        const [editBtn, subsBtn] = el.shadowRoot.querySelectorAll('.panel__body > .row:last-of-type .btn');
        editBtn.click();
        subsBtn.click();
        el.shadowRoot.querySelector('.view-head .btn--primary').click();
        expect(edit).toHaveBeenCalledWith({ formId: 'a03AAA' });
        expect(subs).toHaveBeenCalled();
        expect(fresh).toHaveBeenCalled();
    });

    it('shows an empty state and reports load errors', async () => {
        getForms.mockResolvedValue([]);
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('.plain-row').textContent).toContain('No forms yet');
        expect(el.shadowRoot.querySelector('.empty').textContent).toContain('Select a form');

        getForms.mockRejectedValue({ body: { message: 'denied' } });
        const failing = mount();
        const notify = jest.fn();
        failing.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        expect(failing.shadowRoot.querySelector('.plain-row')).not.toBeNull();
    });
});
