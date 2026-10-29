import { createElement } from 'lwc';
import SmartFormsHelp from 'c/smartFormsHelp';

const flush = () => Promise.resolve();

function mount() {
    const el = createElement('c-smart-forms-help', { is: SmartFormsHelp });
    document.body.appendChild(el);
    return el;
}

describe('c-smart-forms-help', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('renders the process, the task guides and the FAQ', async () => {
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelectorAll('.flow__steps li').length).toBe(5);
        expect(el.shadowRoot.querySelectorAll('.task').length).toBe(6);
        expect(el.shadowRoot.querySelectorAll('.faq details').length).toBe(16);
        expect(el.shadowRoot.querySelectorAll('.faq__group').length).toBe(4);
        expect(el.shadowRoot.querySelector('.task li b').textContent).toBe('Get started');
    });

    it('filters guides and questions and opens the first match', async () => {
        const el = mount();
        await flush();
        const search = el.shadowRoot.querySelector('input[type="search"]');
        search.value = 'link';
        search.dispatchEvent(new CustomEvent('input'));
        await flush();
        const questions = Array.from(el.shadowRoot.querySelectorAll('.faq summary')).map((s) => s.textContent);
        expect(questions.length).toBeGreaterThan(0);
        expect(questions.length).toBeLessThan(16);
        expect(el.shadowRoot.querySelector('.faq details').open).toBe(true);
    });

    it('says so when nothing matches', async () => {
        const el = mount();
        await flush();
        const search = el.shadowRoot.querySelector('input[type="search"]');
        search.value = 'qqqqzzzz';
        search.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(el.shadowRoot.querySelector('.nothing').textContent).toContain('Nothing matches your search');
        expect(el.shadowRoot.querySelectorAll('.task').length).toBe(0);
    });

    it('asks the shell to navigate from a guide', async () => {
        const el = mount();
        const navigate = jest.fn();
        el.addEventListener('navigate', (e) => navigate(e.detail));
        await flush();
        el.shadowRoot.querySelector('.task .btn').click();
        expect(navigate).toHaveBeenCalledWith({ view: 'start' });
    });
});
