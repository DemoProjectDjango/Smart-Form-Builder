import { createElement } from 'lwc';
import SmartFormsVisitor from 'c/smartFormsVisitor';

const flush = () => Promise.resolve();

const FIELDS = [
    { apiName: 'LastName', label: 'Last Name', type: 'STRING', required: true, picklistValues: [] },
    {
        apiName: 'Rating',
        label: 'Rating',
        type: 'PICKLIST',
        required: false,
        picklistValues: [
            { label: 'Hot', value: 'Hot' },
            { label: 'Cold', value: 'Cold' }
        ]
    },
    {
        apiName: 'Revenue',
        label: 'Annual Revenue',
        type: 'CURRENCY',
        required: true,
        picklistValues: [],
        dependency: { controllingApi: 'Rating', controllingValues: ['Hot'] }
    }
];

function mount(props) {
    const el = createElement('c-smart-forms-visitor', { is: SmartFormsVisitor });
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
}

function choose(el, apiName, value) {
    const control = el.shadowRoot.querySelector(`[data-api="${apiName}"]`);
    control.value = value;
    control.dispatchEvent(new CustomEvent('change', { bubbles: true }));
}

describe('c-smart-forms-visitor', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('renders the title, the url without protocol and only the visible fields', async () => {
        const el = mount({ formName: 'Website enquiry', fields: FIELDS, url: 'https://acme.example.com/?id=1' });
        await flush();
        expect(el.shadowRoot.querySelector('h4').textContent).toBe('Website enquiry');
        expect(el.shadowRoot.querySelector('.urlbar').textContent).toBe('acme.example.com/?id=1');
        expect(el.shadowRoot.querySelector('[data-api="LastName"]')).not.toBeNull();
        expect(el.shadowRoot.querySelector('[data-api="Revenue"]')).toBeNull();
    });

    it('shows a dependent field when its controlling answer is chosen and hides it again', async () => {
        const el = mount({ formName: 'F', fields: FIELDS });
        await flush();
        choose(el, 'Rating', 'Hot');
        await flush();
        expect(el.shadowRoot.querySelector('[data-api="Revenue"]')).not.toBeNull();
        choose(el, 'Rating', 'Cold');
        await flush();
        expect(el.shadowRoot.querySelector('[data-api="Revenue"]')).toBeNull();
    });

    it('flags missing required fields and succeeds once they are filled', async () => {
        const el = mount({ formName: 'F', fields: FIELDS });
        await flush();
        el.shadowRoot.querySelector('form').dispatchEvent(new CustomEvent('submit'));
        await flush();
        expect(el.shadowRoot.querySelector('.vf-msg--bad').textContent).toBe('Please fill all required fields');
        expect(el.shadowRoot.querySelector('.vf-field.invalid')).not.toBeNull();

        choose(el, 'LastName', 'Jahan');
        await flush();
        el.shadowRoot.querySelector('form').dispatchEvent(new CustomEvent('submit'));
        await flush();
        expect(el.shadowRoot.querySelector('.vf-msg--ok').textContent).toMatch(/nothing was submitted/);
    });

    it('requires a hidden-then-shown dependent field only while visible', async () => {
        const el = mount({ formName: 'F', fields: FIELDS });
        await flush();
        choose(el, 'LastName', 'Jahan');
        choose(el, 'Rating', 'Hot');
        await flush();
        el.shadowRoot.querySelector('form').dispatchEvent(new CustomEvent('submit'));
        await flush();
        expect(el.shadowRoot.querySelector('.vf-msg--bad')).not.toBeNull();
    });

    it('renders the not-found page', async () => {
        const el = mount({ formName: 'F', fields: FIELDS, notFound: true });
        await flush();
        expect(el.shadowRoot.querySelector('.vf-notfound h4').textContent).toBe('Form Not Found');
        expect(el.shadowRoot.querySelector('form')).toBeNull();
    });

    it('renders every control type', async () => {
        const el = mount({
            formName: 'All',
            fields: [
                { apiName: 'T', label: 'T', type: 'TEXTAREA', picklistValues: [] },
                { apiName: 'B', label: 'B', type: 'BOOLEAN', picklistValues: [] },
                { apiName: 'M', label: 'M', type: 'MULTIPICKLIST', picklistValues: [{ label: 'x', value: 'x' }] },
                { apiName: 'D', label: 'D', type: 'DATE', picklistValues: [] },
                { apiName: 'DT', label: 'DT', type: 'DATETIME', picklistValues: [] }
            ]
        });
        await flush();
        expect(el.shadowRoot.querySelector('textarea[data-api="T"]')).not.toBeNull();
        expect(el.shadowRoot.querySelector('input[type="checkbox"][data-api="B"]')).not.toBeNull();
        expect(el.shadowRoot.querySelector('select[multiple][data-api="M"]')).not.toBeNull();
        expect(el.shadowRoot.querySelector('input[type="date"][data-api="D"]')).not.toBeNull();
        expect(el.shadowRoot.querySelector('input[type="datetime-local"][data-api="DT"]')).not.toBeNull();
    });

    it('shows a hint when there are no fields', async () => {
        const el = mount({ formName: '', fields: [] });
        await flush();
        expect(el.shadowRoot.querySelector('h4').textContent).toBe('Untitled form');
        expect(el.shadowRoot.querySelector('.vf-empty').textContent).toBe('No fields yet');
    });
});
