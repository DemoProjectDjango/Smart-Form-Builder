import { createElement } from 'lwc';
import SmartFormsLookupConfig from 'c/smartFormsLookupConfig';
import searchRecords from '@salesforce/apex/LookupRecordSearchController.searchRecords';

jest.mock('@salesforce/apex/LookupRecordSearchController.searchRecords', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }
};

const HITS = [
    { id: '001000000000001AAA', name: 'Acme East' },
    { id: '001000000000002AAA', name: 'Acme West' }
];

function mount(props = {}) {
    const el = createElement('c-smart-forms-lookup-config', { is: SmartFormsLookupConfig });
    Object.assign(el, { fieldLabel: 'Parent Account', referenceTo: ['Account'], value: null }, props);
    document.body.appendChild(el);
    return el;
}

const changes = (el) => {
    const handler = jest.fn();
    el.addEventListener('lookupchange', (e) => handler(e.detail.lookup));
    return handler;
};

const search = async (el, term = 'acme') => {
    const input = el.shadowRoot.querySelector('input[type="search"]');
    input.value = term;
    input.dispatchEvent(new CustomEvent('input'));
    el.shadowRoot.querySelector('.lk__row .btn').click();
    await flush();
};

describe('c-smart-forms-lookup-config', () => {
    beforeEach(() => {
        searchRecords.mockResolvedValue(HITS);
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('says the field is hidden until a mode is chosen and offers no search yet', async () => {
        const el = mount();
        await flush();
        expect(el.shadowRoot.textContent).toContain('this field is hidden from the published form');
        expect(el.shadowRoot.querySelectorAll('.lk__modes button').length).toBe(2);
        expect(el.shadowRoot.querySelector('.lk__modes [aria-pressed="true"]')).toBeNull();
        expect(el.shadowRoot.querySelector('input[type="search"]')).toBeNull();
    });

    it('lets the admin pick a fixed record and decide whether visitors see its name', async () => {
        const el = mount();
        const onChange = changes(el);
        await flush();
        el.shadowRoot.querySelector('[data-mode="fixed"]').click();
        await flush();
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'fixed', record: { id: '', label: '', showToVisitors: false } });

        await search(el);
        expect(searchRecords).toHaveBeenCalledWith({ objectApiName: 'Account', searchTerm: 'acme' });
        el.shadowRoot.querySelector('.lk__results button').click();
        await flush();
        expect(onChange).toHaveBeenLastCalledWith({
            mode: 'fixed',
            record: { id: HITS[0].id, label: 'Acme East', showToVisitors: false }
        });
        expect(el.shadowRoot.textContent).toContain('Hidden: visitors don');

        const toggle = el.shadowRoot.querySelector('.lk__selected input[type="checkbox"]');
        toggle.checked = true;
        toggle.dispatchEvent(new CustomEvent('change'));
        await flush();
        const label = el.shadowRoot.querySelector('.lk__selected input[type="text"]');
        expect(label.value).toBe('Acme East');
        label.value = 'Head office';
        label.dispatchEvent(new CustomEvent('input'));
        expect(onChange).toHaveBeenLastCalledWith({
            mode: 'fixed',
            record: { id: HITS[0].id, label: 'Head office', showToVisitors: true }
        });
    });

    it('collects up to the limit of choices with stable opaque keys and editable names', async () => {
        const el = mount();
        const onChange = changes(el);
        await flush();
        el.shadowRoot.querySelector('[data-mode="choices"]').click();
        await flush();
        await search(el);
        const [first, second] = el.shadowRoot.querySelectorAll('.lk__results button');
        first.click();
        second.click();
        await flush();
        expect(onChange).toHaveBeenLastCalledWith({
            mode: 'choices',
            choices: [
                { key: 'o1', id: HITS[0].id, label: 'Acme East' },
                { key: 'o2', id: HITS[1].id, label: 'Acme West' }
            ]
        });
        expect(el.shadowRoot.textContent).toContain('2 of 25 selected');
        expect(el.shadowRoot.textContent).toContain('Visitors can read these names');
        expect(Array.from(el.shadowRoot.querySelectorAll('.lk__results button')).every((b) => b.disabled)).toBe(true);

        const name = el.shadowRoot.querySelector('.lk__choices input[data-key="o1"]');
        name.value = 'East office';
        name.dispatchEvent(new CustomEvent('input'));
        expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].choices[0].label).toBe('East office');

        el.shadowRoot.querySelector('.lk__choices button[data-key="o1"]').click();
        await flush();
        expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].choices.map((c) => c.key)).toEqual(['o2']);

        await search(el);
        el.shadowRoot.querySelector('.lk__results li button:not([disabled])').click();
        await flush();
        expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].choices.map((c) => c.key)).toEqual(['o2', 'o1']);
    });

    it('stops adding at the limit', async () => {
        const full = Array.from({ length: 25 }, (_, i) => ({ key: `o${i + 1}`, id: `001${String(i).padStart(12, '0')}AAA`, label: `R${i}` }));
        const el = mount({ value: { mode: 'choices', choices: full } });
        await flush();
        await search(el);
        expect(Array.from(el.shadowRoot.querySelectorAll('.lk__results button')).every((b) => b.disabled)).toBe(true);
        expect(el.shadowRoot.textContent).toContain('Limit reached');
    });

    it('can be cleared to hide the field again', async () => {
        const el = mount({ value: { mode: 'fixed', record: { id: HITS[0].id, label: 'Acme', showToVisitors: true } } });
        const onChange = changes(el);
        await flush();
        el.shadowRoot.querySelector('.lk__clear').click();
        await flush();
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(el.shadowRoot.querySelector('input[type="search"]')).toBeNull();
    });

    it('lets the admin choose which object to search when a lookup points to several', async () => {
        const el = mount({ referenceTo: ['User', 'Group'], value: { mode: 'choices', choices: [] } });
        await flush();
        const select = el.shadowRoot.querySelector('select');
        select.value = 'Group';
        select.dispatchEvent(new CustomEvent('change'));
        await search(el, 'sales');
        expect(searchRecords).toHaveBeenCalledWith({ objectApiName: 'Group', searchTerm: 'sales' });
    });

    it('shows empty results and search errors', async () => {
        searchRecords.mockResolvedValueOnce([]);
        const el = mount({ value: { mode: 'choices', choices: [] } });
        await flush();
        await search(el, 'zzz');
        expect(el.shadowRoot.textContent).toContain('No records found.');

        searchRecords.mockRejectedValueOnce({ body: { message: 'You do not have access to search these records.' } });
        await search(el, 'acme');
        expect(el.shadowRoot.querySelector('[role="alert"]').textContent).toContain('You do not have access');
    });

    it('searches when Enter is pressed', async () => {
        const el = mount({ value: { mode: 'choices', choices: [] } });
        await flush();
        const input = el.shadowRoot.querySelector('input[type="search"]');
        input.value = 'acme';
        input.dispatchEvent(new CustomEvent('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();
        expect(searchRecords).toHaveBeenCalledTimes(1);
    });
});
