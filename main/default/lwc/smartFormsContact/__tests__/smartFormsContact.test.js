import { createElement } from 'lwc';
import SmartFormsContact from 'c/smartFormsContact';

const flush = async () => {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
};

function mount() {
    const el = createElement('c-smart-forms-contact', { is: SmartFormsContact });
    document.body.appendChild(el);
    return el;
}

describe('c-smart-forms-contact', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        delete navigator.clipboard;
    });

    it('lists the six channels with the right values and action links', async () => {
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('h1').textContent).toBe('Contact Info');
        const cards = Array.from(el.shadowRoot.querySelectorAll('.channel'));
        expect(cards.map((c) => c.querySelector('.channel__label').textContent)).toEqual([
            'Website',
            'Company Mail',
            'Employee Mail',
            'Direct Message (US)',
            'WhatsApp (BD)',
            'Calendar Link'
        ]);
        expect(cards.map((c) => c.querySelector('.channel__value').textContent)).toEqual([
            'twinstack.net',
            'info@twinstack.net',
            'saiful@twinstack.net',
            '+19292037060',
            '+8801556777043',
            'calendar.app.google/HP3LiuNFisCt6xLo6'
        ]);
        expect(cards.map((c) => c.querySelector('a').getAttribute('href'))).toEqual([
            'https://twinstack.net',
            'mailto:info@twinstack.net',
            'mailto:saiful@twinstack.net',
            'tel:+19292037060',
            'https://wa.me/8801556777043',
            'https://calendar.app.google/HP3LiuNFisCt6xLo6'
        ]);
        const web = cards[0].querySelector('a');
        expect(web.getAttribute('target')).toBe('_blank');
        expect(web.getAttribute('rel')).toBe('noopener noreferrer');
        expect(cards[1].querySelector('a').getAttribute('target')).toBe('_self');
    });

    it('copies a value and reports success or failure', async () => {
        const writeText = jest.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const el = mount();
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        await flush();
        el.shadowRoot.querySelectorAll('.channel')[1].querySelector('button').click();
        await flush();
        expect(writeText).toHaveBeenCalledWith('info@twinstack.net');
        expect(notify).toHaveBeenLastCalledWith({ message: 'Copied', variant: undefined });

        writeText.mockRejectedValue(new Error('denied'));
        el.shadowRoot.querySelectorAll('.channel')[0].querySelector('button').click();
        await flush();
        expect(notify).toHaveBeenLastCalledWith({ message: 'Select the text and copy it manually', variant: 'error' });
    });

    it('returns to Get started', async () => {
        const el = mount();
        const navigate = jest.fn();
        el.addEventListener('navigate', (e) => navigate(e.detail));
        await flush();
        el.shadowRoot.querySelector('.foot .btn').click();
        expect(navigate).toHaveBeenCalledWith({ view: 'start' });
    });
});
