import { createElement } from 'lwc';
import SmartFormsBuilder from 'c/smartFormsBuilder';
import fetchFieldsForObject from '@salesforce/apex/FormEditorController.fetchFieldsForObject';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';
import saveFormTemplate from '@salesforce/apex/FormAuraController.saveFormTemplate';

jest.mock('@salesforce/apex/FormEditorController.fetchFieldsForObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormEditorController.getFormData', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FormAuraController.saveFormTemplate', () => ({ default: jest.fn() }), { virtual: true });

// Lets queued promise callbacks (mocked Apex calls, re-renders) settle.
const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

const LEAD_FIELDS = [
    { name: 'LastName', label: 'Last Name', type: 'STRING', required: true, picklistValues: [] },
    { name: 'Company', label: 'Company', type: 'STRING', required: true, picklistValues: [] },
    { name: 'Email', label: 'Email', type: 'EMAIL', required: false, picklistValues: [] },
    {
        name: 'Rating',
        label: 'Rating',
        type: 'PICKLIST',
        required: false,
        picklistValues: [
            { label: 'Hot', value: 'Hot' },
            { label: 'Cold', value: 'Cold' }
        ]
    },
    { name: 'Description', label: 'Description', type: 'TEXTAREA', required: false, picklistValues: [] }
];

let token = 0;
function mount(request, props = {}) {
    const el = createElement('c-smart-forms-builder', { is: SmartFormsBuilder });
    Object.assign(el, props);
    document.body.appendChild(el);
    if (request) {
        token += 1;
        el.request = { ...request, token };
    }
    return el;
}

const NEW_LEAD = { name: 'Website enquiry', objectApiName: 'lead', objectLabel: 'Lead', formId: null };

const canvasLabels = (el) =>
    Array.from(el.shadowRoot.querySelectorAll('.canvas .frow')).map((li) => li.querySelector('.frow__label').firstChild.textContent.trim());

describe('c-smart-forms-builder', () => {
    beforeEach(() => {
        fetchFieldsForObject.mockResolvedValue(LEAD_FIELDS);
        getFormData.mockResolvedValue({ id: 'a03NEW', version: 1, objectApiName: 'lead', fieldConfig: '[]' });
        saveFormTemplate.mockResolvedValue('a03NEW');
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('asks the user to start from Get started when no form is open', async () => {
        const el = mount(null);
        const handler = jest.fn();
        el.addEventListener('gostart', handler);
        await flush();
        expect(el.shadowRoot.querySelector('h2').textContent).toBe('No form is open');
        el.shadowRoot.querySelector('button.btn--primary').click();
        expect(handler).toHaveBeenCalled();
    });

    it('opens a new form with the required fields already on the canvas', async () => {
        const el = mount(NEW_LEAD);
        await flush();
        expect(fetchFieldsForObject).toHaveBeenCalledWith({ objectName: 'lead' });
        expect(canvasLabels(el)).toEqual(['Last Name', 'Company']);
        expect(el.shadowRoot.querySelector('input[data-id="name"]').value).toBe('Website enquiry');
        expect(el.shadowRoot.querySelector('.buildbar__meta').textContent).toContain('Creates: Lead');
        expect(el.shadowRoot.querySelector('.buildbar__meta').textContent).toContain('New form');
        expect(el.shadowRoot.querySelectorAll('.picker__list li').length).toBe(LEAD_FIELDS.length);
    });

    it('adds, filters, reorders and removes fields', async () => {
        const el = mount(NEW_LEAD);
        await flush();

        const email = el.shadowRoot.querySelector('input[data-pick="Email"]');
        email.checked = true;
        email.dispatchEvent(new CustomEvent('change', { bubbles: true }));
        await flush();
        expect(canvasLabels(el)).toEqual(['Last Name', 'Company', 'Email']);

        const up = el.shadowRoot.querySelectorAll('.frow')[2].querySelector('button[data-delta="-1"]');
        up.click();
        await flush();
        expect(canvasLabels(el)).toEqual(['Last Name', 'Email', 'Company']);

        el.shadowRoot.querySelectorAll('.frow')[1].querySelector('.iconbtn--danger').click();
        await flush();
        expect(canvasLabels(el)).toEqual(['Last Name', 'Company']);

        const search = el.shadowRoot.querySelector('input[type="search"]');
        search.value = 'desc';
        search.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(el.shadowRoot.querySelectorAll('.picker__list li').length).toBe(1);

        search.value = 'zzz';
        search.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(el.shadowRoot.querySelector('.picker__list .empty').textContent).toBe('No fields match your search');
    });

    it('selects and deselects every field', async () => {
        const el = mount(NEW_LEAD);
        await flush();
        const [selectAll, deselectAll] = el.shadowRoot.querySelectorAll('.picker__tools .btn');
        selectAll.click();
        await flush();
        expect(canvasLabels(el).length).toBe(LEAD_FIELDS.length);
        deselectAll.click();
        await flush();
        expect(el.shadowRoot.querySelector('.canvas .empty').textContent).toContain('No fields selected yet');
    });

    it('saves the generated form and reports the new version', async () => {
        const el = mount(NEW_LEAD);
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();

        el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
        await flush();

        expect(saveFormTemplate).toHaveBeenCalledTimes(1);
        const req = JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson);
        expect(req).toMatchObject({ name: 'Website enquiry', objectApiName: 'lead', formId: null });
        expect(req.html).toContain('id="field-LastName"');
        expect(req.js).toContain('window.handleSubmit');
        expect(JSON.parse(req.fieldConfigJson).map((f) => f.apiName)).toEqual(['LastName', 'Company']);
        expect(notify).toHaveBeenLastCalledWith({ message: 'Form saved successfully · version 1', variant: undefined });
        expect(el.shadowRoot.querySelector('.buildbar__meta').textContent).toContain('Version 1');
    });

    it('refuses to save without a name or fields', async () => {
        const el = mount({ ...NEW_LEAD, name: '' });
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
        await flush();
        expect(notify).toHaveBeenLastCalledWith({ message: 'Form name is required.', variant: 'error' });

        const input = el.shadowRoot.querySelector('input[data-id="name"]');
        input.value = 'Named';
        input.dispatchEvent(new CustomEvent('input'));
        el.shadowRoot.querySelectorAll('.picker__tools .btn')[1].click();
        await flush();
        el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
        await flush();
        expect(notify).toHaveBeenLastCalledWith({ message: 'Select at least one field.', variant: 'error' });
        expect(saveFormTemplate).not.toHaveBeenCalled();
    });

    it('surfaces save errors', async () => {
        saveFormTemplate.mockRejectedValue({ body: { message: 'Failed to create form: boom' } });
        const el = mount(NEW_LEAD);
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
        await flush();
        expect(notify).toHaveBeenLastCalledWith({ message: 'Failed to create form: boom', variant: 'error' });
    });

    it('loads an existing form with its saved fields and version, keeping the renamed title', async () => {
        getFormData.mockResolvedValue({
            id: 'a03OLD',
            version: 3,
            objectApiName: 'lead',
            fieldConfig: JSON.stringify([
                { apiName: 'Email', label: 'Work email', type: 'EMAIL', required: true, placeholder: 'you@co.com' }
            ])
        });
        const el = mount({ ...NEW_LEAD, name: 'Renamed', formId: 'a03OLD' });
        await flush();
        expect(getFormData).toHaveBeenCalledWith({ formId: 'a03OLD' });
        expect(canvasLabels(el)).toEqual(['Work email', 'Last Name', 'Company']);
        expect(el.shadowRoot.querySelector('input[data-id="name"]').value).toBe('Renamed');
        expect(el.shadowRoot.querySelector('.buildbar__meta').textContent).toContain('Version 3');

        el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
        await flush();
        expect(JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson).formId).toBe('a03OLD');
    });

    it('edits a field in the drawer and makes it dependent on a picklist answer', async () => {
        const el = mount(NEW_LEAD);
        await flush();
        ['Rating', 'Description'].forEach((api) => {
            const box = el.shadowRoot.querySelector(`input[data-pick="${api}"]`);
            box.checked = true;
            box.dispatchEvent(new CustomEvent('change', { bubbles: true }));
        });
        await flush();

        const descriptionRow = Array.from(el.shadowRoot.querySelectorAll('.frow')).find((r) => r.textContent.includes('Description'));
        descriptionRow.querySelector('[data-edit-btn]').click();
        await flush();
        expect(el.shadowRoot.querySelector('[role="dialog"] h2').textContent).toBe('Edit “Description”');

        const label = el.shadowRoot.querySelector('[data-id="d-label"]');
        label.value = 'How can we help?';
        label.dispatchEvent(new CustomEvent('input'));

        const [, depSwitch] = el.shadowRoot.querySelectorAll('.switch input');
        depSwitch.checked = true;
        depSwitch.dispatchEvent(new CustomEvent('change'));
        await flush();

        // saving with incomplete criteria is blocked
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        el.shadowRoot.querySelector('.drawer__foot .btn--primary').click();
        await flush();
        expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'error' }));
        expect(el.shadowRoot.querySelector('.summary--warn')).not.toBeNull();

        el.shadowRoot.querySelector('.answer-chips button[data-value="Hot"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('.summary--ok').textContent).toContain('appears only when Rating is Hot');
        expect(el.shadowRoot.querySelector('.tryit .pill').textContent).toBe('Hidden');
        const tryIt = el.shadowRoot.querySelector('.tryit select');
        tryIt.value = 'Hot';
        tryIt.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(el.shadowRoot.querySelector('.tryit .pill').textContent).toBe('Shown');

        el.shadowRoot.querySelector('.drawer__foot .btn--primary').click();
        await flush();
        expect(el.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
        expect(el.shadowRoot.querySelector('.dirty')).not.toBeNull();
        const row = Array.from(el.shadowRoot.querySelectorAll('.frow')).find((r) => r.textContent.includes('How can we help?'));
        expect(row.querySelector('.frow__dep').textContent).toContain('Shown when Rating is Hot');

        el.shadowRoot.querySelector('.buildbar > button.btn--primary').click();
        await flush();
        const req = JSON.parse(saveFormTemplate.mock.calls[0][0].reqJson);
        expect(JSON.parse(req.fieldDependenciesJson)).toEqual({
            Description: { controllingField: 'Rating', controllingValues: ['Hot'] }
        });
        expect(req.html).toContain('data-controlling-field="Rating"');
    });

    it('offers to add a controlling question when the form has none, and closes on Escape', async () => {
        const el = mount(NEW_LEAD);
        await flush();
        el.shadowRoot.querySelectorAll('.frow')[0].querySelector('[data-edit-btn]').click();
        await flush();
        const [, depSwitch] = el.shadowRoot.querySelectorAll('.switch input');
        depSwitch.checked = true;
        depSwitch.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(el.shadowRoot.querySelector('.criteria__title').textContent).toBe('First, add a question to depend on');
        el.shadowRoot.querySelector('.addctrl .btn').click();
        await flush();
        expect(canvasLabels(el)).toContain('Rating');
        expect(el.shadowRoot.querySelector('.answer-chips')).not.toBeNull();

        el.shadowRoot.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();
        expect(el.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
    });

    it('switches to the visitor view and back', async () => {
        const el = mount(NEW_LEAD, { baseUrl: 'https://acme.example.com/?id=' });
        await flush();
        el.shadowRoot.querySelector('.seg button[data-view="visitor"]').click();
        await flush();
        const visitor = el.shadowRoot.querySelector('c-smart-forms-visitor');
        expect(visitor).not.toBeNull();
        expect(visitor.url).toBe('https://acme.example.com/?id=your-form-id');
        expect(el.shadowRoot.querySelector('.workspace')).toBeNull();
        el.shadowRoot.querySelector('.seg button[data-view="edit"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('.workspace')).not.toBeNull();
    });

    it('reports a load failure', async () => {
        fetchFieldsForObject.mockRejectedValue({ body: { message: 'nope' } });
        const el = createElement('c-smart-forms-builder', { is: SmartFormsBuilder });
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        document.body.appendChild(el);
        el.request = { ...NEW_LEAD, token: 999 };
        await flush();
        expect(notify).toHaveBeenCalledWith({ message: 'Failed to load the form: nope', variant: 'error' });
    });
});
