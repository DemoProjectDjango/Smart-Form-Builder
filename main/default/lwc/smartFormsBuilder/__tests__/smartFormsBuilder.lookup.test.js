import { createElement } from 'lwc';
import SmartFormsBuilder from 'c/smartFormsBuilder';
import fetchFieldsForObject from '@salesforce/apex/FormEditorController.fetchFieldsForObject';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
import saveFormTemplate from '@salesforce/apex/FormAuraController.saveFormTemplate';
import searchRecords from '@salesforce/apex/LookupRecordSearchController.searchRecords';

jest.mock('@salesforce/apex/FormEditorController.fetchFieldsForObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.getFormData', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormAuraController.saveFormTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/LookupRecordSearchController.searchRecords', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

const PARENT_ID = '001000000000001AAA';

const FIELDS = (extra = []) => [
    { name: 'Name', label: 'Account Name', type: 'STRING', required: true, picklistValues: [], referenceTo: [] },
    { name: 'OwnerId', label: 'Owner ID', type: 'REFERENCE', required: false, picklistValues: [], referenceTo: ['User'] },
    ...extra
];

let token = 100;
function mount() {
    const el = createElement('c-smart-forms-builder', { is: SmartFormsBuilder });
    document.body.appendChild(el);
    token += 1;
    el.request = { name: 'Lookup form', objectApiName: 'account', objectLabel: 'Account', formId: null, token };
    return el;
}

const rowFor = (el, label) => Array.from(el.shadowRoot.querySelectorAll('.frow')).find((r) => r.textContent.includes(label));
const pick = (el, api) => {
    const box = el.shadowRoot.querySelector(`input[data-pick="${api}"]`);
    box.checked = true;
    box.dispatchEvent(new CustomEvent('change', { bubbles: true }));
};
const save = async (el) => {
    el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
    await flush();
};
const lastToast = (el) => {
    const handler = jest.fn();
    el.addEventListener('notify', (e) => handler(e.detail));
    return handler;
};

describe('c-smart-forms-builder lookup fields', () => {
    beforeEach(() => {
        fetchFieldsForObject.mockResolvedValue(FIELDS());
        getFormData.mockResolvedValue({ id: 'a03NEW', version: 1, objectApiName: 'account', fieldConfig: '[]' });
        saveFormTemplate.mockResolvedValue('a03NEW');
        searchRecords.mockResolvedValue([{ id: PARENT_ID, name: 'Acme Parent' }]);
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('marks a lookup field as hidden from visitors and leaves it out of the published form', async () => {
        const el = mount();
        await flush();
        pick(el, 'OwnerId');
        await flush();
        expect(rowFor(el, 'Owner ID').textContent).toContain('Hidden from visitors');

        await save(el);
        const req = JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson);
        expect(req.html).toContain('data-api-name="Name"');
        expect(req.html).not.toContain('OwnerId');
        const config = JSON.parse(req.fieldConfigJson);
        expect(config.find((f) => f.apiName === 'OwnerId')).toMatchObject({ type: 'REFERENCE', referenceTo: ['User'], lookup: null });
    });

    it('blocks saving when Salesforce requires a lookup that visitors cannot fill in', async () => {
        fetchFieldsForObject.mockResolvedValue(
            FIELDS([{ name: 'AccountId', label: 'Account', type: 'REFERENCE', required: true, picklistValues: [], referenceTo: ['Account'] }])
        );
        const el = mount();
        const toast = lastToast(el);
        await flush();
        await save(el);
        expect(saveFormTemplate).not.toHaveBeenCalled();
        expect(toast).toHaveBeenLastCalledWith({
            message: expect.stringContaining('is required by Salesforce but hidden from visitors'),
            variant: 'error'
        });
    });

    it('blocks saving when no field is left for visitors', async () => {
        fetchFieldsForObject.mockResolvedValue([FIELDS()[1]]);
        const el = mount();
        const toast = lastToast(el);
        await flush();
        pick(el, 'OwnerId');
        await flush();
        await save(el);
        expect(saveFormTemplate).not.toHaveBeenCalled();
        expect(toast).toHaveBeenLastCalledWith({ message: expect.stringContaining('Add at least one field visitors can fill in'), variant: 'error' });
    });

    it('shows lookup settings in the drawer instead of placeholder and dependency options', async () => {
        const el = mount();
        await flush();
        pick(el, 'OwnerId');
        await flush();
        rowFor(el, 'Owner ID').querySelector('[data-edit-btn]').click();
        await flush();
        expect(el.shadowRoot.querySelector('c-smart-forms-lookup-config')).not.toBeNull();
        expect(el.shadowRoot.querySelector('#d-ph, [for="d-ph"]')).toBeNull();
        expect(el.shadowRoot.querySelector('.depbox')).toBeNull();
        expect(el.shadowRoot.querySelectorAll('.drawer__body .switch').length).toBe(0);
    });

    it('configures a fixed record, keeps its Id out of the page, and saves the setting', async () => {
        const el = mount();
        await flush();
        pick(el, 'OwnerId');
        await flush();
        rowFor(el, 'Owner ID').querySelector('[data-edit-btn]').click();
        await flush();

        const cfg = el.shadowRoot.querySelector('c-smart-forms-lookup-config');
        cfg.shadowRoot.querySelector('[data-mode="fixed"]').click();
        await flush();
        const search = cfg.shadowRoot.querySelector('input[type="search"]');
        search.value = 'acme';
        search.dispatchEvent(new CustomEvent('input'));
        cfg.shadowRoot.querySelector('.lk__row .btn').click();
        await flush();
        expect(searchRecords).toHaveBeenCalledWith({ objectApiName: 'User', searchTerm: 'acme' });
        cfg.shadowRoot.querySelector('.lk__results button').click();
        await flush();

        el.shadowRoot.querySelector('.drawer__foot .btn--primary').click();
        await flush();
        expect(rowFor(el, 'Owner ID').textContent).toContain('Fixed record (hidden): Acme Parent');

        await save(el);
        const req = JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson);
        expect(req.html).not.toContain(PARENT_ID);
        expect(req.js).not.toContain(PARENT_ID);
        const owner = JSON.parse(req.fieldConfigJson).find((f) => f.apiName === 'OwnerId');
        expect(owner.lookup).toEqual({ mode: 'fixed', record: { id: PARENT_ID, label: 'Acme Parent', showToVisitors: false } });
    });

    it('turns selected records into a visitor dropdown with opaque keys', async () => {
        const el = mount();
        await flush();
        pick(el, 'OwnerId');
        await flush();
        rowFor(el, 'Owner ID').querySelector('[data-edit-btn]').click();
        await flush();
        const cfg = el.shadowRoot.querySelector('c-smart-forms-lookup-config');
        cfg.shadowRoot.querySelector('[data-mode="choices"]').click();
        await flush();
        cfg.shadowRoot.querySelector('.lk__row .btn').click();
        await flush();
        cfg.shadowRoot.querySelector('.lk__results button').click();
        await flush();
        el.shadowRoot.querySelector('.drawer__foot .btn--primary').click();
        await flush();
        expect(rowFor(el, 'Owner ID').textContent).toContain('Visitors choose from 1 record');

        await save(el);
        const req = JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson);
        expect(req.html).toContain('<option value="o1">Acme Parent</option>');
        expect(req.html).not.toContain(PARENT_ID);
        expect(JSON.parse(req.fieldConfigJson).find((f) => f.apiName === 'OwnerId').lookup.choices).toEqual([
            { key: 'o1', id: PARENT_ID, label: 'Acme Parent' }
        ]);

        el.shadowRoot.querySelector('.seg button[data-view="visitor"]').click();
        await flush();
        const visitor = el.shadowRoot.querySelector('c-smart-forms-visitor');
        expect(visitor.shadowRoot.querySelector('select option[value="o1"]').textContent).toBe('Acme Parent');
    });

    it('will not save a lookup drawer that is only half configured', async () => {
        const el = mount();
        await flush();
        pick(el, 'OwnerId');
        await flush();
        rowFor(el, 'Owner ID').querySelector('[data-edit-btn]').click();
        await flush();
        const toast = lastToast(el);
        el.shadowRoot.querySelector('c-smart-forms-lookup-config').shadowRoot.querySelector('[data-mode="choices"]').click();
        await flush();
        el.shadowRoot.querySelector('.drawer__foot .btn--primary').click();
        await flush();
        expect(toast).toHaveBeenLastCalledWith({ message: expect.stringContaining('Finish the lookup settings'), variant: 'error' });
        expect(el.shadowRoot.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('reloads saved lookup settings when an existing form is opened', async () => {
        getFormData.mockResolvedValue({
            id: 'a03OLD',
            version: 2,
            objectApiName: 'account',
            fieldConfig: JSON.stringify([
                { apiName: 'Name', label: 'Account Name', type: 'STRING', required: true },
                {
                    apiName: 'OwnerId',
                    label: 'Owner ID',
                    type: 'REFERENCE',
                    referenceTo: ['User'],
                    lookup: { mode: 'fixed', record: { id: PARENT_ID, label: 'Sales queue', showToVisitors: true } }
                }
            ])
        });
        const el = createElement('c-smart-forms-builder', { is: SmartFormsBuilder });
        document.body.appendChild(el);
        el.request = { name: 'Old', objectApiName: 'account', objectLabel: 'Account', formId: 'a03OLD', token: 999 };
        await flush();
        expect(rowFor(el, 'Owner ID').textContent).toContain('Fixed record, shown to visitors: Sales queue');
        await save(el);
        expect(JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson).html).toContain('<div class="readonly-value">Sales queue</div>');
    });
});
