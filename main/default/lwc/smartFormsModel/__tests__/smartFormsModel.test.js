import {
    answerLabel,
    buildDependencyJson,
    buildFieldConfigJson,
    buildFormCss,
    buildFormHtml,
    buildFormJs,
    controllingAnswers,
    escapeHtml,
    formatDate,
    isControllingType,
    isFieldShown,
    joinOr,
    normalizeError,
    parseFieldConfig,
    parseRich,
    stripRich
} from 'c/smartFormsModel';

const picklist = (apiName, values) => ({
    apiName,
    label: apiName,
    type: 'PICKLIST',
    required: false,
    placeholder: '',
    picklistValues: values.map((v) => ({ label: v, value: v })),
    dependency: null
});

describe('smartFormsModel', () => {
    describe('type helpers', () => {
        it('recognises controlling types case-insensitively', () => {
            expect(isControllingType('picklist')).toBe(true);
            expect(isControllingType('MULTIPICKLIST')).toBe(true);
            expect(isControllingType('BOOLEAN')).toBe(true);
            expect(isControllingType('STRING')).toBe(false);
            expect(isControllingType(undefined)).toBe(false);
        });
    });

    describe('text helpers', () => {
        it('escapes HTML special characters', () => {
            expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
                '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
            );
            expect(escapeHtml(null)).toBe('');
        });

        it('joins answers with commas and "or"', () => {
            expect(joinOr([])).toBe('');
            expect(joinOr(['Hot'])).toBe('Hot');
            expect(joinOr(['Hot', 'Warm'])).toBe('Hot or Warm');
            expect(joinOr(['A', 'B', 'C'])).toBe('A, B or C');
            expect(joinOr(null)).toBe('');
        });

        it('parses bold and mono markers into plain segments', () => {
            const segs = parseRich('Open **Forms** then `?id=` now');
            expect(segs.map((s) => [s.text, s.isBold, s.isMono, s.isPlain])).toEqual([
                ['Open ', false, false, true],
                ['Forms', true, false, false],
                [' then ', false, false, true],
                ['?id=', false, true, false],
                [' now', false, false, true]
            ]);
            expect(stripRich('Open **Forms** and `x`')).toBe('Open Forms and x');
        });

        it('never turns markup into elements', () => {
            const segs = parseRich('<img src=x onerror=alert(1)> **b**');
            expect(segs[0].text).toBe('<img src=x onerror=alert(1)> ');
            expect(segs[0].isPlain).toBe(true);
        });

        it('normalises Apex and JS errors', () => {
            expect(normalizeError(null)).toBe('Unknown error');
            expect(normalizeError('boom')).toBe('boom');
            expect(normalizeError({ body: { message: 'Apex says no' } })).toBe('Apex says no');
            expect(normalizeError({ body: [{ message: 'a' }, { message: 'b' }] })).toBe('a, b');
            expect(normalizeError({ message: 'js' })).toBe('js');
            expect(normalizeError({})).toBe('Unknown error');
        });

        it('formats dates and tolerates bad input', () => {
            expect(formatDate('')).toBe('');
            expect(formatDate('not a date')).toBe('');
            expect(formatDate('2026-10-02T10:00:00Z')).toMatch(/2026/);
            expect(formatDate('2026-10-02T10:00:00Z', true)).toMatch(/2026/);
        });
    });

    describe('field config', () => {
        it('parses saved config and drops invalid entries', () => {
            const json = JSON.stringify([
                { apiName: 'Email', label: 'Email', type: 'email', required: 1 },
                { label: 'No api name' },
                { apiName: 'Rating', type: 'PICKLIST', picklistValues: [{ label: 'Hot', value: 'Hot' }], dependency: { controllingApi: 'X', controllingValues: ['1'] } },
                { apiName: 'Plain', dependency: { controllingApi: '' } }
            ]);
            const fields = parseFieldConfig(json);
            expect(fields.map((f) => f.apiName)).toEqual(['Email', 'Rating', 'Plain']);
            expect(fields[0]).toMatchObject({ type: 'EMAIL', required: true, label: 'Email', picklistValues: [] });
            expect(fields[1].dependency.controllingApi).toBe('X');
            expect(fields[2].dependency).toBeNull();
            expect(fields[2].label).toBe('Plain');
        });

        it('returns an empty list for bad JSON or non-arrays', () => {
            expect(parseFieldConfig('{nope')).toEqual([]);
            expect(parseFieldConfig('{"a":1}')).toEqual([]);
            expect(parseFieldConfig(null)).toEqual([]);
        });

        it('serialises field config and dependency map', () => {
            const dep = { ...picklist('Child', ['x']), dependency: { controllingApi: 'Rating', controllingValues: ['Hot'] } };
            const fields = [picklist('Rating', ['Hot', 'Cold']), dep];
            expect(JSON.parse(buildFieldConfigJson(fields))[1]).toMatchObject({ apiName: 'Child', dependency: { controllingApi: 'Rating' } });
            expect(JSON.parse(buildDependencyJson(fields))).toEqual({
                Child: { controllingField: 'Rating', controllingValues: ['Hot'] }
            });
            expect(buildDependencyJson([])).toBe('{}');
        });
    });

    describe('dependencies', () => {
        const rating = picklist('Rating', ['Hot', 'Warm', 'Cold']);
        const revenue = { ...picklist('Revenue', []), type: 'CURRENCY', dependency: { controllingApi: 'Rating', controllingValues: ['Hot', 'Warm'] } };

        it('lists answers for checkboxes and picklists', () => {
            expect(controllingAnswers({ type: 'BOOLEAN' })).toEqual([
                { value: 'true', label: 'Checked' },
                { value: 'false', label: 'Unchecked' }
            ]);
            expect(controllingAnswers(rating).map((a) => a.value)).toEqual(['Hot', 'Warm', 'Cold']);
            expect(controllingAnswers(null)).toEqual([]);
            expect(answerLabel({ type: 'BOOLEAN' }, 'true')).toBe('Checked');
            expect(answerLabel(rating, 'Unknown')).toBe('Unknown');
        });

        it('shows a field without dependency always', () => {
            expect(isFieldShown(rating, {})).toBe(true);
        });

        it('shows a dependent field only for matching answers', () => {
            expect(isFieldShown(revenue, {})).toBe(false);
            expect(isFieldShown(revenue, { Rating: 'Cold' })).toBe(false);
            expect(isFieldShown(revenue, { Rating: 'Warm' })).toBe(true);
            expect(isFieldShown(revenue, { Rating: ['Cold', 'Hot'] })).toBe(true);
        });

        it('treats booleans as "true"/"false"', () => {
            const needs = { apiName: 'Nights', dependency: { controllingApi: 'Stay', controllingValues: ['true'] } };
            expect(isFieldShown(needs, { Stay: true })).toBe(true);
            expect(isFieldShown(needs, { Stay: false })).toBe(false);
        });
    });

    describe('generated public form', () => {
        it('returns nothing without fields', () => {
            expect(buildFormHtml('Empty', [])).toBe('');
        });

        it('renders each field type with required markers and dependency attributes', () => {
            const fields = [
                { apiName: 'Name', label: 'Name', type: 'STRING', required: true, placeholder: 'Your name' },
                { apiName: 'Notes', label: 'Notes', type: 'TEXTAREA', placeholder: 'hi' },
                { apiName: 'When', label: 'When', type: 'DATE' },
                { apiName: 'At', label: 'At', type: 'DATETIME' },
                { apiName: 'Opt', label: 'Opt in', type: 'BOOLEAN' },
                picklist('Rating', ['Hot']),
                { ...picklist('Tags', ['a']), type: 'MULTIPICKLIST' },
                { apiName: 'Rev', label: 'Revenue', type: 'CURRENCY', dependency: { controllingApi: 'Rating', controllingValues: ['Hot', 'Warm'] } }
            ];
            const html = buildFormHtml('Lead form', fields);
            expect(html).toContain('<h3>Lead form</h3>');
            expect(html).toContain('<span class="req">*</span>');
            expect(html).toContain('<textarea id="field-Notes"');
            expect(html).toContain('type="date"');
            expect(html).toContain('type="datetime-local"');
            expect(html).toContain('type="checkbox" id="field-Opt"');
            expect(html).toContain('<option value="">--Select--</option><option value="Hot">Hot</option>');
            expect(html).toContain('multiple');
            expect(html).toContain('data-controlling-field="Rating" data-controlling-values="Hot,Warm"');
            expect(html).toContain('type="text" id="field-Rev"');
            expect(html).not.toMatch(/\sonsubmit=|\sonclick=/);
        });

        it('escapes user-controlled labels, names, placeholders and options', () => {
            const html = buildFormHtml('<img src=x onerror=1>', [
                {
                    apiName: 'A"B',
                    label: '<script>alert(1)</script>',
                    type: 'PICKLIST',
                    required: false,
                    placeholder: '" autofocus onfocus="x',
                    picklistValues: [{ label: '<b>', value: '"><svg>' }]
                }
            ]);
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('<img');
            expect(html).not.toContain('<svg>');
            expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
            expect(html).toContain('data-api-name="A&quot;B"');
        });

        it('generates the submit/dependency scripts and the stylesheet', () => {
            const plain = buildFormJs([{ apiName: 'A' }]);
            expect(plain).toContain('window.handleSubmit');
            expect(plain).not.toContain('function updateFieldVisibility');
            const withDeps = buildFormJs([{ apiName: 'A', dependency: { controllingApi: 'B', controllingValues: ['x'] } }]);
            expect(withDeps).toContain('function updateFieldVisibility');
            expect(() => new Function(withDeps)).not.toThrow();
            expect(buildFormCss()).toContain('.form-card');
        });
    });
});
