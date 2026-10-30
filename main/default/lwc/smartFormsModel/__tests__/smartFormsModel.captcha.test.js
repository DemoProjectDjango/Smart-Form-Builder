import { buildFormHtml, buildFormJs } from 'c/smartFormsModel';

const FORM_ID = 'a03000000000001AAA';
const name = { apiName: 'Name', label: 'Name', type: 'STRING', required: true, picklistValues: [] };

let container;
const box = () => container.querySelector('#sf-captcha');

// Runs the generated script against the generated markup, the way PublicForm.page does,
// with a fake Turnstile and a fake Visualforce remoting manager.
function publish(options) {
    container = document.createElement('div');
    const parsed = new DOMParser().parseFromString(buildFormHtml('Contact us', [name], options), 'text/html');
    while (parsed.body.firstChild) container.appendChild(parsed.body.firstChild);
    document.body.appendChild(container);

    const fake = {
        render: jest.fn(() => 'widget-1'),
        reset: jest.fn(),
        invokeAction: jest.fn()
    };
    window.turnstile = fake;
    window.Visualforce = { remoting: { Manager: { invokeAction: fake.invokeAction } } };
    window.alert = jest.fn();
    delete window.__vfPublicFormInit;
    delete window.__sfCaptchaId;
    new Function(buildFormJs([name], options))();
    return fake;
}

const submit = (value) => {
    container.querySelector('input[data-api-name="Name"]').value = value;
    container.querySelector('.form-body').dispatchEvent(new CustomEvent('submit', { cancelable: true }));
};

describe('generated form without a spam check', () => {
    it('is exactly what it was before spam protection existed', () => {
        expect(buildFormHtml('F', [name])).toBe(buildFormHtml('F', [name], { captcha: false }));
        expect(buildFormJs([name])).toBe(buildFormJs([name], { captcha: false }));
        expect(buildFormHtml('F', [name])).not.toContain('sf-captcha');
        expect(buildFormJs([name])).not.toContain('_captcha');
        expect(buildFormJs([name])).not.toContain('turnstile');
    });
});

describe('generated form with a spam check', () => {
    afterEach(() => {
        jest.useRealTimers();
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null;
        delete window.turnstile;
        delete window.SF_FORM_PAYLOAD;
    });

    it('puts an empty widget container between the trap field and the Submit button', () => {
        const html = buildFormHtml('F', [name], { captcha: true });
        const trap = html.indexOf('hp_website');
        const widget = html.indexOf('<div id="sf-captcha" class="captcha-box"></div>');
        const button = html.indexOf('<button class="btn-primary"');
        expect(trap).toBeGreaterThan(-1);
        expect(widget).toBeGreaterThan(trap);
        expect(button).toBeGreaterThan(widget);
    });

    it('is valid script that avoids what the server-side sanitizer rewrites', () => {
        const js = buildFormJs([name], { captcha: true });
        expect(() => new Function(js)).not.toThrow();
        // Comments are skipped: an existing one mentions new Function(), which the server rewrites harmlessly.
        const code = js
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');
        expect(code).not.toMatch(/\beval\s*\(/i);
        expect(code).not.toMatch(/new\s+Function\s*\(/i);
        expect(code).not.toContain('innerHTML');
    });

    it('renders the widget with the site key from the page, bound to this form', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: 'SITE-KEY' };
        const fake = publish({ captcha: true });
        jest.advanceTimersByTime(150);

        expect(fake.render).toHaveBeenCalledTimes(1);
        const [target, options] = fake.render.mock.calls[0];
        expect(target).toBe(box());
        expect(options).toMatchObject({ sitekey: 'SITE-KEY', action: 'submit', cdata: FORM_ID });
    });

    it('waits for the Cloudflare script to arrive before rendering', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: 'SITE-KEY' };
        const fake = publish({ captcha: true });
        const real = window.turnstile;
        delete window.turnstile;
        jest.advanceTimersByTime(500);
        expect(fake.render).not.toHaveBeenCalled();

        window.turnstile = real;
        jest.advanceTimersByTime(100);
        expect(fake.render).toHaveBeenCalledTimes(1);
    });

    it('blocks the submission until the visitor has passed the check', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: 'SITE-KEY' };
        const fake = publish({ captcha: true });
        jest.advanceTimersByTime(150);

        submit('Ann');

        expect(window.alert).toHaveBeenCalledWith('Please complete the spam check first.');
        expect(fake.invokeAction).not.toHaveBeenCalled();
    });

    it('sends the token with the submission and asks for a fresh one afterwards', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: 'SITE-KEY' };
        const fake = publish({ captcha: true });
        jest.advanceTimersByTime(150);
        const options = fake.render.mock.calls[0][1];

        options.callback('token-1');
        submit('Ann');

        expect(fake.invokeAction).toHaveBeenCalledTimes(1);
        const [, payload, , done] = fake.invokeAction.mock.calls[0];
        expect(JSON.parse(payload)).toEqual({ Name: 'Ann', _captcha: 'token-1' });

        done('Success! Submission saved.', { status: true });

        expect(fake.reset).toHaveBeenCalledWith('widget-1');
        expect(box().hasAttribute('data-token')).toBe(false);
        submit('Bob');
        expect(window.alert).toHaveBeenLastCalledWith('Please complete the spam check first.');
        expect(fake.invokeAction).toHaveBeenCalledTimes(1);
    });

    it('forgets the token when it expires or the widget reports an error', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: 'SITE-KEY' };
        const fake = publish({ captcha: true });
        jest.advanceTimersByTime(150);
        const options = fake.render.mock.calls[0][1];

        options.callback('token-1');
        expect(box().getAttribute('data-token')).toBe('token-1');
        options['expired-callback']();
        expect(box().hasAttribute('data-token')).toBe(false);

        options.callback('token-2');
        options['error-callback']();
        expect(box().hasAttribute('data-token')).toBe(false);
    });

    it('explains itself instead of rendering when the page has no site key', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: '' };
        const fake = publish({ captcha: true });
        jest.advanceTimersByTime(500);

        expect(fake.render).not.toHaveBeenCalled();
        expect(box().textContent).toContain('not available');
        submit('Ann');
        expect(fake.invokeAction).not.toHaveBeenCalled();
    });

    it('gives up with a message when the Cloudflare script never loads', () => {
        jest.useFakeTimers();
        window.SF_FORM_PAYLOAD = { id: FORM_ID, captchaSiteKey: 'SITE-KEY' };
        const fake = publish({ captcha: true });
        delete window.turnstile;
        jest.advanceTimersByTime(11000);

        expect(fake.render).not.toHaveBeenCalled();
        expect(box().textContent).toContain('could not be loaded');
    });
});
