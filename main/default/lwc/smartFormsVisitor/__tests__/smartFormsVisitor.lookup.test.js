import { createElement } from 'lwc';
import SmartFormsVisitor from 'c/smartFormsVisitor';

const flush = async () => {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
};

const lookup = (apiName, value) => ({ apiName, label: apiName, type: 'REFERENCE', required: true, picklistValues: [], lookup: value });

function mount(fields) {
    const el = createElement('c-smart-forms-visitor', { is: SmartFormsVisitor });
    el.formName = 'F';
    el.fields = fields;
    document.body.appendChild(el);
    return el;
}

describe('c-smart-forms-visitor lookup fields', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('does not show lookups the admin has not configured, or fixed records marked hidden', async () => {
        const el = mount([
            lookup('OwnerId', null),
            lookup('ParentId', { mode: 'fixed', record: { id: '001000000000001AAA', label: 'Acme', showToVisitors: false } })
        ]);
        await flush();
        expect(el.shadowRoot.querySelector('[data-api]')).toBeNull();
        expect(el.shadowRoot.querySelector('.vf-empty').textContent).toBe('No fields yet');
    });

    it('shows a fixed record as read-only text when the admin allows it', async () => {
        const el = mount([lookup('ParentId', { mode: 'fixed', record: { id: '001000000000001AAA', label: 'Acme HQ', showToVisitors: true } })]);
        await flush();
        expect(el.shadowRoot.querySelector('.vf-readonly').textContent).toBe('Acme HQ');
        expect(el.shadowRoot.querySelector('input, select')).toBeNull();
    });

    it('offers the selected records as a dropdown and requires a choice', async () => {
        const el = mount([
            lookup('ParentId', {
                mode: 'choices',
                choices: [{ key: 'o1', id: '001000000000001AAA', label: 'London' }, { key: 'o2', id: '001000000000002AAA', label: 'Paris' }]
            })
        ]);
        await flush();
        const options = Array.from(el.shadowRoot.querySelectorAll('select option')).map((o) => [o.value, o.textContent]);
        expect(options).toEqual([['', '--Select--'], ['o1', 'London'], ['o2', 'Paris']]);

        el.shadowRoot.querySelector('form').dispatchEvent(new CustomEvent('submit'));
        await flush();
        expect(el.shadowRoot.querySelector('.vf-msg--bad')).not.toBeNull();

        const select = el.shadowRoot.querySelector('select');
        select.value = 'o2';
        select.dispatchEvent(new CustomEvent('change', { bubbles: true }));
        await flush();
        el.shadowRoot.querySelector('form').dispatchEvent(new CustomEvent('submit'));
        await flush();
        expect(el.shadowRoot.querySelector('.vf-msg--ok')).not.toBeNull();
    });
});
