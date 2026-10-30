import { LightningElement } from 'lwc';
import { parseRich, stripRich } from 'c/smartFormsModel';

// Text uses **bold** and `mono` markers; they are turned into plain render segments (never HTML).
const FLOW = [
    ['Set up once', 'Public site, access and link address'],
    ['Build a form', 'Pick what it creates and the questions'],
    ['Save & share', 'Copy the form link and send it'],
    ['Visitors submit', 'No login needed'],
    ['Records appear', 'Check Submissions for results']
];

const TASKS = [
    {
        icon: 'book',
        title: 'Set up Smart Forms (one time)',
        go: ['start', 'Open Get started'],
        steps: [
            'Open **Get started** and click **Setup instructions**.',
            'Follow the 5 steps in Salesforce Setup: builder access, public site, visitor access, sharing rule, link address.',
            "Come back and click **Recheck**. When the card turns green, you're ready."
        ]
    },
    {
        icon: 'plus',
        title: 'Create a new form',
        go: ['start', 'Create a form'],
        steps: [
            'In **Get started**, choose **Create a new form**.',
            'Type a form name and choose what each response should create (for example Lead).',
            'Click **Next: build form**. Required fields are already added for you.',
            'Tick the other fields you want, then arrange them with the arrows.',
            'Click **Save & generate form**.'
        ]
    },
    {
        icon: 'edit',
        title: 'Edit an existing form',
        go: ['forms', 'Open Forms'],
        steps: [
            'Open **Forms**, select the form and click **Edit in Form Builder** (or use **Edit an existing form** in Get started).',
            'Click **Next: build form**.',
            'Add, remove, reorder or edit fields.',
            'Click **Save & generate form**. The version number goes up by one.'
        ]
    },
    {
        icon: 'branch',
        title: 'Show a question only for certain answers',
        go: ['builder', 'Open Form Builder'],
        steps: [
            'Make sure the controlling question (a picklist or checkbox) is on the form.',
            'In the Form Builder, click the **pencil** on the question you want to hide.',
            'Turn on **Only show this field for certain answers**.',
            'Step 1: choose the controlling question. Step 2: tap the answers that should show it.',
            'Check the summary and **Try it**, click **Save changes**, then **Save & generate form**.'
        ]
    },
    {
        icon: 'copy',
        title: 'Share a form',
        go: ['forms', 'Open Forms'],
        steps: [
            'Open **Forms** and select the form.',
            'Click **Copy** next to the public link, or **Open public form** to try it.',
            'Use **Visitor view** to preview exactly what people will see.',
            'Paste the link into an email, a chat or a button on your website.'
        ]
    },
    {
        icon: 'ok',
        title: 'Check what people sent',
        go: ['submissions', 'Open Submissions'],
        steps: [
            'Open **Submissions**. Use **Has error** to see only the ones that failed.',
            'Select a submission to see what the visitor sent and the record it created or updated.',
            "If there's an error, read the message (for example a missing required field), fix the form and save it."
        ]
    }
];

const FAQ = [
    ['Getting started', 'Do visitors need a Salesforce login?', "No. Anyone with the form link can open and submit it. They can't see your Salesforce data or your other forms."],
    ['Getting started', 'Who can build forms?', 'People with the **FormBuilder_Admin** permission set. It shows every form and submission, so give it only to people who should see that data. Never give it to the site guest user.'],
    ['Getting started', 'Why is \u201cBuild a form\u201d locked?', 'Your public site (named PublicForm) is missing or not Active. Open **Setup instructions**, finish the steps, then click **Recheck**.'],
    ['Getting started', 'What does the site name checker do?', "It tells you whether a Salesforce Site with that name or URL path prefix exists in your org. Use it if you're not sure your site was created with the right name."],
    ['Building forms', 'What does \u201cCreates: Lead\u201d mean?', 'Each time someone submits the form, Smart Forms creates one record of that type, here a Lead. You choose the type when you start the form.'],
    ['Building forms', 'Why are some fields already ticked with a red *?', "Salesforce needs those fields to save the record, so they're added automatically. You can rename them, but the form needs them to work."],
    ['Building forms', 'What\'s the difference between \u201cApply changes\u201d and \u201cSave & generate form\u201d?', '**Apply changes** confirms your field edits in the builder. **Save & generate form** saves the form to Salesforce and updates the public page. Visitors only see changes after you save.'],
    ['Building forms', 'Why did the version number go up?', 'Every time you save an existing form, its version goes up by one. If you create a new form with the same name as an old one, it gets the next version number.'],
    ['Building forms', 'Which kinds of fields can I use?', 'Text, email, phone, website, numbers, currency, percent, picklists, multi-select picklists, dates, date and time, checkboxes and long text.'],
    ['Building forms', 'Why are lookup fields (like Owner) not on my published form?', 'Lookup fields stay **hidden from visitors** until you configure them, because visitors cannot know record Ids. Open the field with the pencil and choose **Fixed record** (applied automatically, optionally shown by name) or **Choose from selected records** (visitors pick from up to 25 names you select). Visitors never see or send record Ids.'],
    ['Building forms', 'Can a field depend on more than one question?', 'Not today. A field can depend on one picklist or checkbox, and you can pick several answers that show it.'],
    ['Sharing', 'How do I stop spam on my form?', 'Open the **Spam protection** tab and connect your free Cloudflare Turnstile account (it takes about five minutes). Then switch on **Spam check** for each form in the Form Builder and save it. Visitors complete a short check before they can submit. Every form also has a built-in limit on submissions per minute and a hidden trap field for simple bots, with no setup.'],
    ['Sharing', 'I switched on the spam check but my published form still has none. Why?', 'The form must be saved again after you switch it on, because saving is what publishes the change. Forms created before spam protection existed stay unprotected until you open, switch on the check and save them.'],
    ['Sharing', 'What happens if I remove my Turnstile keys?', 'Forms that require the spam check stop accepting submissions until you save and test new keys, or switch the check off on those forms. The Spam protection tab tells you how many forms are affected before you remove anything.'],
    ['Sharing', 'Why does it say \u201cSite URL not configured\u201d?', 'The link address from setup step 5 is missing. Add your Site URL followed by `?id=` in Custom Settings \u2192 Form Builder Settings.'],
    ['Sharing', 'A visitor sees \u201cForm Not Found\u201d. Why?', 'The link is wrong or incomplete, or the form was deleted. Copy the link again from the Forms tab and resend it.'],
    ['Submissions', 'A submission shows \u201cError\u201d. What do I do?', 'Open it in **Submissions**. The error message says what Salesforce rejected, for example \u201cRequired fields are missing: [Subject]\u201d. Add or fix that field on the form, then save it so new submissions work.'],
    ['Submissions', 'Can visitors update an existing record?', 'No. Public forms only create records. A submission that includes a record Id is rejected, so nobody can overwrite your data through a form link.'],
    ['Submissions', 'Where do I find the record a submission created?', 'Select the submission. **Related records** lists the object, the record Id (click it to open) and whether it was created or updated.']
];

/**
 * "Help & FAQ": the whole process at a glance, common tasks and searchable questions.
 */
export default class SmartFormsHelp extends LightningElement {
    query = '';

    get flowSteps() {
        return FLOW.map(([title, text], i) => ({ key: `flow-${i}`, number: i + 1, title, text }));
    }

    get matchesQuery() {
        const q = this.query.trim().toLowerCase();
        return (text) => !q || stripRich(text).toLowerCase().includes(q);
    }

    get tasks() {
        const match = this.matchesQuery;
        return TASKS.filter((t) => match(`${t.title} ${t.steps.join(' ')}`)).map((t, i) => ({
            key: `task-${i}`,
            icon: t.icon,
            title: t.title,
            goView: t.go[0],
            goLabel: `${t.go[1]} \u2192`,
            steps: t.steps.map((s, j) => ({ key: `task-${i}-${j}`, segments: parseRich(s) }))
        }));
    }

    get faq() {
        const match = this.matchesQuery;
        const hasQuery = !!this.query.trim();
        let group = '';
        return FAQ.filter(([, q, a]) => match(`${q} ${a}`)).map(([g, q, a], i) => {
            const showGroup = g !== group;
            group = g;
            return {
                key: `faq-${i}`,
                group: g,
                showGroup,
                question: q,
                open: hasQuery && i === 0,
                segments: parseRich(a)
            };
        });
    }

    get hasTasks() {
        return this.tasks.length > 0;
    }

    get hasFaq() {
        return this.faq.length > 0;
    }

    get nothingFound() {
        return !this.hasTasks && !this.hasFaq;
    }

    handleSearch(event) {
        this.query = event.target.value;
    }

    handleGo(event) {
        this.dispatchEvent(new CustomEvent('navigate', { detail: { view: event.currentTarget.dataset.view } }));
    }
}
