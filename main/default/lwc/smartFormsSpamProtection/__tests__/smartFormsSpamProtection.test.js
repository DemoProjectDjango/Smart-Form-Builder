import { createElement } from 'lwc';
import SmartFormsSpamProtection from 'c/smartFormsSpamProtection';
import getStatus from '@salesforce/apex/CaptchaSettingsController.getStatus';
import saveKeys from '@salesforce/apex/CaptchaSettingsController.saveKeys';
import testConnection from '@salesforce/apex/CaptchaSettingsController.testConnection';
import clearKeys from '@salesforce/apex/CaptchaSettingsController.clearKeys';

jest.mock('@salesforce/apex/CaptchaSettingsController.getStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CaptchaSettingsController.saveKeys', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CaptchaSettingsController.testConnection', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CaptchaSettingsController.clearKeys', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
};

const status = (extra = {}) => ({ siteKey: '', secretSaved: false, connected: false, canManage: true, formsUsing: 0, message: '', ...extra });

function mount(props = {}) {
    const el = createElement('c-smart-forms-spam-protection', { is: SmartFormsSpamProtection });
    Object.assign(el, { baseUrl: 'https://acme.my.salesforce-sites.com/forms/PublicForm?id=', ...props });
    document.body.appendChild(el);
    return el;
}

const q = (el, id) => el.shadowRoot.querySelector(`[data-id="${id}"]`);
const type = async (input, value) => {
    input.value = value;
    input.dispatchEvent(new CustomEvent('input'));
    await flush();
};

describe('c-smart-forms-spam-protection', () => {
    beforeEach(() => {
        getStatus.mockResolvedValue(status());
        saveKeys.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true }));
        testConnection.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true, connected: true }));
        clearKeys.mockResolvedValue(status());
    });

    afterEach(() => {
        jest.clearAllMocks();
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('guides the admin and tells them which hostname to allow', async () => {
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('h1').textContent).toBe('Spam protection');
        expect(el.shadowRoot.querySelectorAll('.sp__steps li').length).toBe(5);
        expect(el.shadowRoot.querySelector('.sp__steps').textContent).toContain('acme.my.salesforce-sites.com');
        expect(q(el, 'status').textContent).toBe('Not connected');
        const link = el.shadowRoot.querySelector('.sp__steps a');
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
    });

    it('falls back to generic advice when the form link is not set', async () => {
        const el = mount({ baseUrl: '' });
        await flush();
        expect(el.shadowRoot.querySelector('.sp__steps').textContent).toContain('Use the domain from your public form link');
    });

    it('keeps Save disabled until both keys are entered, and hides the secret', async () => {
        const el = mount();
        await flush();
        expect(q(el, 'save').disabled).toBe(true);
        expect(q(el, 'test').disabled).toBe(true);
        expect(q(el, 'secretKey').type).toBe('password');

        await type(q(el, 'siteKey'), 'SITEKEY123456');
        expect(q(el, 'save').disabled).toBe(true);
        await type(q(el, 'secretKey'), 'SECRETKEY123456');
        expect(q(el, 'save').disabled).toBe(false);
    });

    it('saves the keys, then runs the connection test and reports success', async () => {
        const el = mount();
        const notify = jest.fn();
        el.addEventListener('notify', (e) => notify(e.detail));
        const changed = jest.fn();
        el.addEventListener('protectionchange', (e) => changed(e.detail));
        await flush();

        await type(q(el, 'siteKey'), ' SITEKEY123456 ');
        await type(q(el, 'secretKey'), 'SECRETKEY123456');
        q(el, 'save').click();
        await flush();

        expect(saveKeys).toHaveBeenCalledWith({ siteKey: ' SITEKEY123456 ', secretKey: 'SECRETKEY123456' });
        expect(testConnection).toHaveBeenCalledTimes(1);
        expect(q(el, 'status').textContent).toBe('Connected');
        expect(q(el, 'message').textContent).toContain('Connected');
        expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'success' }));
        expect(changed.mock.calls.map((c) => c[0].connected)).toEqual([false, true]);
    });

    it('never puts the secret back in the page after saving', async () => {
        const el = mount();
        await flush();
        await type(q(el, 'siteKey'), 'SITEKEY123456');
        await type(q(el, 'secretKey'), 'SECRETKEY123456');
        q(el, 'save').click();
        await flush();

        expect(q(el, 'secretKey').value).toBe('');
        expect(q(el, 'secretKey').placeholder).toBe('Saved. Leave blank to keep it');
        expect(el.shadowRoot.textContent).not.toContain('SECRETKEY123456');
        expect(Array.from(el.shadowRoot.querySelectorAll('input')).some((input) => input.value.includes('SECRETKEY123456'))).toBe(false);
    });

    it('shows why the test failed and stays disconnected', async () => {
        testConnection.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true, message: 'Cloudflare did not accept this secret key.' }));
        const el = mount();
        const changed = jest.fn();
        el.addEventListener('protectionchange', (e) => changed(e.detail));
        await flush();
        await type(q(el, 'siteKey'), 'SITEKEY123456');
        await type(q(el, 'secretKey'), 'WRONGSECRET1234');
        q(el, 'save').click();
        await flush();

        expect(q(el, 'status').textContent).toBe('Keys saved, not tested');
        expect(q(el, 'message').textContent).toContain('did not accept');
        expect(q(el, 'message').className).toContain('note--bad');
        expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ connected: false }));
    });

    it('shows a server error from saving', async () => {
        saveKeys.mockRejectedValue({ body: { message: 'The secret key does not look like a Turnstile key.' } });
        const el = mount();
        await flush();
        await type(q(el, 'siteKey'), 'SITEKEY123456');
        await type(q(el, 'secretKey'), 'bad');
        q(el, 'save').click();
        await flush();

        expect(testConnection).not.toHaveBeenCalled();
        expect(q(el, 'message').textContent).toContain('does not look like a Turnstile key');
        expect(q(el, 'save').disabled).toBe(false);
    });

    it('lets the admin retest saved keys, but only when nothing is unsaved', async () => {
        getStatus.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true }));
        const el = mount();
        await flush();
        expect(q(el, 'siteKey').value).toBe('SITEKEY123456');
        expect(q(el, 'test').disabled).toBe(false);

        await type(q(el, 'siteKey'), 'DIFFERENTKEY123');
        expect(q(el, 'test').disabled).toBe(true);
        await type(q(el, 'siteKey'), 'SITEKEY123456');
        expect(q(el, 'test').disabled).toBe(false);

        q(el, 'test').click();
        await flush();
        expect(testConnection).toHaveBeenCalledTimes(1);
        expect(saveKeys).not.toHaveBeenCalled();
        expect(q(el, 'status').textContent).toBe('Connected');
    });

    it('allows saving a new site key while keeping the saved secret', async () => {
        getStatus.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true, connected: true }));
        const el = mount();
        await flush();
        await type(q(el, 'siteKey'), 'NEWSITEKEY12345');
        expect(q(el, 'save').disabled).toBe(false);
        q(el, 'save').click();
        await flush();
        expect(saveKeys).toHaveBeenCalledWith({ siteKey: 'NEWSITEKEY12345', secretKey: '' });
    });

    it('asks before removing keys and warns about the forms that rely on them', async () => {
        getStatus.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true, connected: true, formsUsing: 3 }));
        const el = mount();
        const changed = jest.fn();
        el.addEventListener('protectionchange', (e) => changed(e.detail));
        await flush();

        q(el, 'remove').click();
        await flush();
        expect(q(el, 'forms-using').textContent).toContain('3 forms require the spam check');
        expect(clearKeys).not.toHaveBeenCalled();

        q(el, 'cancel-remove').click();
        await flush();
        expect(q(el, 'confirm-remove')).toBeNull();

        q(el, 'remove').click();
        await flush();
        q(el, 'confirm-remove').click();
        await flush();
        expect(clearKeys).toHaveBeenCalledTimes(1);
        expect(q(el, 'status').textContent).toBe('Not connected');
        expect(q(el, 'siteKey').value).toBe('');
        expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ connected: false }));
    });

    it('is read-only for people who cannot manage spam protection', async () => {
        getStatus.mockResolvedValue(status({ siteKey: 'SITEKEY123456', secretSaved: true, connected: true, canManage: false }));
        const el = mount();
        await flush();
        expect(el.shadowRoot.querySelector('.note--warn').textContent).toContain('Form Builder Admin');
        expect(q(el, 'siteKey').disabled).toBe(true);
        expect(q(el, 'secretKey').disabled).toBe(true);
        expect(q(el, 'save').disabled).toBe(true);
        expect(q(el, 'test').disabled).toBe(true);
        expect(q(el, 'remove').disabled).toBe(true);
        expect(q(el, 'status').textContent).toBe('Connected');
    });

    it('reports a problem loading the status', async () => {
        getStatus.mockRejectedValue({ body: { message: 'No access' } });
        const el = mount();
        await flush();
        expect(q(el, 'message').textContent).toBe('No access');
        expect(q(el, 'message').className).toContain('note--bad');
    });
});
