import { createElement } from 'lwc';
import SmartFormsSubmissions from 'c/smartFormsSubmissions';
import getSubmissions from '@salesforce/apex/SmartFormsDataController.getSubmissions';
import getSubmissionDetail from '@salesforce/apex/SmartFormsDataController.getSubmissionDetail';

jest.mock('@salesforce/apex/SmartFormsDataController.getSubmissions', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/SmartFormsDataController.getSubmissionDetail', () => ({ default: jest.fn() }), { virtual: true });

// Lets queued promise callbacks (mocked Apex calls, re-renders) settle.
const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

const OK = {
    id: 'a0SOK',
    name: 'FS-000128',
    formName: 'Website enquiry',
    hasError: false,
    createdDate: '2026-10-28T14:02:00Z',
    firstRecord: { action: 'Created', objectLabel: 'Lead', objectApiName: 'Lead', recordId: '00QBi00000AbC12AAA' }
};
const FAILED = { id: 'a0SERR', name: 'FS-000127', formName: 'Support request', hasError: true, createdDate: '2026-10-28T13:24:00Z', firstRecord: null };

const DETAILS = {
    a0SOK: {
        summary: OK,
        payloadJson: '{"LastName":"Jahan","Email":"<img src=x onerror=alert(1)>","Nested":{"a":1}}',
        errorMessage: null,
        records: [{ action: 'Created', objectLabel: 'Lead', objectApiName: 'Lead', recordId: '00QBi00000AbC12AAA' }]
    },
    a0SERR: {
        summary: FAILED,
        payloadJson: 'not json',
        errorMessage: 'Required fields are missing: [Subject]',
        records: []
    }
};

function mount() {
    const el = createElement('c-smart-forms-submissions', { is: SmartFormsSubmissions });
    document.body.appendChild(el);
    return el;
}

describe('c-smart-forms-submissions', () => {
    beforeEach(() => {
        getSubmissions.mockResolvedValue([OK, FAILED]);
        getSubmissionDetail.mockImplementation(({ submissionId }) => Promise.resolve(DETAILS[submissionId]));
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('lists submissions with result pills and opens the first', async () => {
        const el = mount();
        await flush();
        const rows = el.shadowRoot.querySelectorAll('.split > .table-wrap tbody tr');
        expect(rows.length).toBe(2);
        expect(rows[0].querySelector('.pill--ok').textContent).toBe('Created Lead');
        expect(rows[1].querySelector('.pill--bad').textContent).toBe('Error');
        expect(el.shadowRoot.querySelector('.panel__head h2').textContent).toBe('FS-000128');
        expect(el.shadowRoot.querySelector('.result--ok').textContent).toContain('Record created');
    });

    it('renders visitor-supplied payload values as text only', async () => {
        const el = mount();
        await flush();
        const values = Array.from(el.shadowRoot.querySelectorAll('dl.payload dd')).map((d) => d.textContent);
        expect(values).toEqual(['Jahan', '<img src=x onerror=alert(1)>', '{"a":1}']);
        expect(el.shadowRoot.querySelector('dl.payload img')).toBeNull();

        el.shadowRoot.querySelector('[data-view="json"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('pre.json').textContent).toContain('"LastName": "Jahan"');
        expect(el.shadowRoot.querySelector('dl.payload')).toBeNull();
    });

    it('filters by error and shows the error message', async () => {
        const el = mount();
        await flush();
        el.shadowRoot.querySelector('[data-filter="err"]').click();
        await flush();
        expect(getSubmissions).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot.querySelectorAll('.split > .table-wrap tbody tr').length).toBe(1);
        expect(el.shadowRoot.querySelector('.result--bad').textContent).toContain('Required fields are missing: [Subject]');
        expect(el.shadowRoot.querySelector('dl.payload dd').textContent).toBe('not json');
        expect(el.shadowRoot.querySelector('.table-wrap.related')).toBeNull();
    });

    it('lists related records and only links real record ids', async () => {
        const el = mount();
        await flush();
        const link = el.shadowRoot.querySelector('.related .record-link');
        expect(link.textContent).toBe('00QBi00000AbC12AAA');
    });

    it('switches selection by click', async () => {
        const el = mount();
        await flush();
        el.shadowRoot.querySelectorAll('.split > .table-wrap tbody tr')[1].click();
        await flush();
        expect(el.shadowRoot.querySelector('.panel__head h2').textContent).toBe('FS-000127');
    });

    it('shows an empty state and reports errors', async () => {
        getSubmissions.mockResolvedValue([]);
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('.plain-row').textContent).toContain('No submissions yet.');

        getSubmissions.mockRejectedValue({ body: { message: 'denied' } });
        const failing = mount();
        const notify = jest.fn();
        failing.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        expect(failing.shadowRoot.querySelector('.plain-row')).not.toBeNull();
    });
});
