import {
    MAX_CHOICES,
    buildFieldConfigJson,
    buildFormHtml,
    buildFormJs,
    isLookupComplete,
    isLookupType,
    isVisitorField,
    lookupSummary,
    normalizeLookup,
    parseFieldConfig
} from 'c/smartFormsModel';

const ACCOUNT_ID = '001000000000001AAA';
const OWNER_ID = '005000000000002AAA';

const lookup = (apiName, value, extra = {}) => ({
    apiName,
    label: apiName,
    type: 'REFERENCE',
    required: false,
    placeholder: '',
    picklistValues: [],
    referenceTo: ['Account'],
    lookup: value,
    dependency: null,
    ...extra
});

const name = { apiName: 'Name', label: 'Name', type: 'STRING', required: true, picklistValues: [] };

describe('lookup settings', () => {
    it('recognises lookup types', () => {
        expect(isLookupType('reference')).toBe(true);
        expect(isLookupType('STRING')).toBe(false);
        expect(isLookupType(undefined)).toBe(false);
    });

    it('normalises fixed and choice settings and drops anything else', () => {
        expect(normalizeLookup(null)).toBeNull();
        expect(normalizeLookup('x')).toBeNull();
        expect(normalizeLookup({ mode: 'hidden' })).toBeNull();
        expect(normalizeLookup({ mode: 'fixed', record: { id: ACCOUNT_ID, label: 'Acme', showToVisitors: 1 } })).toEqual({
            mode: 'fixed',
            record: { id: ACCOUNT_ID, label: 'Acme', showToVisitors: true }
        });
        expect(normalizeLookup({ mode: 'fixed' }).record).toEqual({ id: '', label: '', showToVisitors: false });
        expect(
            normalizeLookup({ mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'A' }, { key: '', id: 'x' }, null, { key: 'o2' }] })
        ).toEqual({ mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'A' }] });
        expect(normalizeLookup({ mode: 'choices' })).toEqual({ mode: 'choices', choices: [] });
    });

    it('treats a lookup as complete only when a record or at least one choice is set', () => {
        expect(isLookupComplete(lookup('A', null))).toBe(false);
        expect(isLookupComplete(lookup('A', { mode: 'fixed', record: { id: '', label: '', showToVisitors: false } }))).toBe(false);
        expect(isLookupComplete(lookup('A', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'x', showToVisitors: false } }))).toBe(true);
        expect(isLookupComplete(lookup('A', { mode: 'choices', choices: [] }))).toBe(false);
        expect(isLookupComplete(lookup('A', { mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'x' }] }))).toBe(true);
        const tooMany = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => ({ key: `o${i + 1}`, id: ACCOUNT_ID, label: 'x' }));
        expect(isLookupComplete(lookup('A', { mode: 'choices', choices: tooMany }))).toBe(false);
    });

    it('hides lookups from visitors by default and shows only what the admin allows', () => {
        const fixedHidden = lookup('A', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'Acme', showToVisitors: false } });
        const fixedShown = lookup('A', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'Acme', showToVisitors: true } });
        const choices = lookup('A', { mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'Acme' }] });
        expect(isVisitorField(name)).toBe(true);
        expect(isVisitorField(lookup('A', null))).toBe(false);
        expect(isVisitorField(fixedHidden)).toBe(false);
        expect(isVisitorField(fixedShown)).toBe(true);
        expect(isVisitorField(choices)).toBe(true);
        expect(isVisitorField(null)).toBe(false);
    });

    it('summarises the state for the canvas', () => {
        expect(lookupSummary(lookup('A', null))).toBe('Hidden from visitors');
        expect(lookupSummary(lookup('A', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'Acme', showToVisitors: false } }))).toBe('Fixed record (hidden): Acme');
        expect(lookupSummary(lookup('A', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'Acme', showToVisitors: true } }))).toBe('Fixed record, shown to visitors: Acme');
        expect(lookupSummary(lookup('A', { mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'a' }] }))).toBe('Visitors choose from 1 record');
        expect(
            lookupSummary(lookup('A', { mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'a' }, { key: 'o2', id: OWNER_ID, label: 'b' }] }))
        ).toBe('Visitors choose from 2 records');
    });

    it('keeps lookup settings and targets when saving and reloading the configuration', () => {
        const field = lookup('ParentId', { mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'Acme' }] });
        const saved = JSON.parse(buildFieldConfigJson([name, field]));
        expect(saved[1].referenceTo).toEqual(['Account']);
        expect(saved[1].lookup.choices[0].id).toBe(ACCOUNT_ID);
        const reloaded = parseFieldConfig(JSON.stringify(saved));
        expect(reloaded[1].lookup).toEqual(field.lookup);
        expect(reloaded[1].referenceTo).toEqual(['Account']);
        expect(reloaded[0].lookup).toBeNull();
    });
});

describe('published form with lookup fields', () => {
    it('leaves unconfigured lookups out of the form', () => {
        const html = buildFormHtml('F', [name, lookup('OwnerId', null)]);
        expect(html).toContain('data-api-name="Name"');
        expect(html).not.toContain('OwnerId');
    });

    it('returns nothing when no field is visible to visitors', () => {
        expect(buildFormHtml('F', [lookup('OwnerId', null)])).toBe('');
        expect(buildFormHtml('F', [lookup('A', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'x', showToVisitors: false } })])).toBe('');
    });

    it('shows a fixed record as read-only text without an input or an Id', () => {
        const html = buildFormHtml('F', [
            name,
            lookup('ParentId', { mode: 'fixed', record: { id: ACCOUNT_ID, label: 'Acme <Corp>', showToVisitors: true } })
        ]);
        expect(html).toContain('<div class="readonly-value">Acme &lt;Corp&gt;</div>');
        expect(html).not.toContain('id="field-ParentId"');
        expect(html).not.toContain(ACCOUNT_ID);
    });

    it('turns choices into a dropdown that carries opaque keys, never record Ids', () => {
        const html = buildFormHtml('F', [
            lookup(
                'ParentId',
                { mode: 'choices', choices: [{ key: 'o1', id: ACCOUNT_ID, label: 'London' }, { key: 'o2', id: OWNER_ID, label: '"><b>x' }] },
                { required: true }
            )
        ]);
        expect(html).toContain('<select id="field-ParentId" class="control" data-api-name="ParentId" required>');
        expect(html).toContain('<option value="o1">London</option>');
        expect(html).toContain('<option value="o2">&quot;&gt;&lt;b&gt;x</option>');
        expect(html).not.toContain(ACCOUNT_ID);
        expect(html).not.toContain(OWNER_ID);
    });

    it('adds an invisible honeypot field and a script that drops filled-in honeypots', () => {
        const html = buildFormHtml('F', [name]);
        expect(html).toContain('name="hp_website"');
        expect(html).toContain('aria-hidden="true"');
        const js = buildFormJs([name]);
        expect(js).toContain('hp_website');
        expect(() => new Function(js)).not.toThrow();
        expect(js.indexOf('hp_website')).toBeLessThan(js.indexOf('var elements='));
    });
});
