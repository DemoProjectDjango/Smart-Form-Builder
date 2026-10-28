import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import FORM_OBJECT from '@salesforce/schema/Form__c';

/**
 * Namespace of the installed package ('' in an unpackaged org).
 * Derived from the Form__c schema import, which resolves to e.g. "twinforce__Form__c".
 */
const NAMESPACE = (() => {
    const apiName = (FORM_OBJECT && FORM_OBJECT.objectApiName) || '';
    const parts = apiName.split('__');
    return parts.length === 3 ? parts[0] : '';
})();

// Segment builders for instruction lines.
const text = (value) => ({ kind: 'text', value });
const ui = (value) => ({ kind: 'ui', value });
const val = (value, copyable = true) => ({ kind: 'value', value, copyable });

export default class PublicFormInstructionsModal extends LightningElement {
    @api open = false;

    @api siteLabel = 'PublicForm';
    @api visualforcePageName = 'PublicForm';
    @api permissionSetName = 'FormBuilder_Admin';
    @api guestPermissionSetName = 'Form Builder Guest';
    @api customSettingName = 'Form Builder Settings';
    @api customSettingFieldLabel = 'Public Form Base Url';
    @api exampleUrl = 'https://your-company.my.salesforce-sites.com/?id=';

    currentIndex = 0;
    _focusPending = false;

    // ── Derived names (namespace-aware) ───────────────────────────────────────

    get namespace() {
        return NAMESPACE;
    }

    qualified(name) {
        return this.namespace ? `${this.namespace}.${name}` : name;
    }

    get controllerClassName() {
        return this.qualified('FormController');
    }

    get pageListName() {
        return this.qualified(this.visualforcePageName);
    }

    // ── Step content ──────────────────────────────────────────────────────────

    get stepDefinitions() {
        return [
            {
                id: 'admin',
                title: 'Give yourself builder access',
                short: 'Builder access',
                icon: 'utility:user',
                where: ['Setup', 'Permission Sets'],
                why: 'Lets you create forms and review submissions. Give it to everyone who builds forms.',
                items: [
                    [text('Open '), val(this.permissionSetName)],
                    [text('Click '), ui('Manage Assignments'), text(', then '), ui('Add Assignment')],
                    [text('Select yourself and any other form builders, then click '), ui('Next'), text(' and '), ui('Assign')]
                ],
                callout: {
                    variant: 'warning',
                    text: 'Never assign this permission set to the site guest user. It grants access to all forms and submissions.'
                }
            },
            {
                id: 'site',
                title: 'Create the public site',
                short: 'Public site',
                icon: 'utility:world',
                where: ['Setup', 'Sites'],
                why: 'A Salesforce Site gives your forms a public web address that visitors can open without logging in.',
                items: [
                    [text('Click '), ui('New')],
                    [text('Site Label: '), val(this.siteLabel), text(' (Site Name fills in automatically)')],
                    [text('Active Site Home Page: '), val(this.visualforcePageName, false)],
                    [text('Tick '), ui('Active'), text(', leave the other fields as they are, and click '), ui('Save')]
                ],
                callout: {
                    variant: 'info',
                    text: 'First time using Sites? If Salesforce asks you to register a Sites domain, do that first, then click New.'
                }
            },
            {
                id: 'guest',
                title: 'Let visitors open and submit forms',
                short: 'Visitor access',
                icon: 'utility:lock',
                where: ['Setup', 'Sites', this.siteLabel, 'Public Access Settings'],
                why: 'Anonymous visitors can only use what you enable here. The form needs just one class and one page.',
                items: [
                    [text('Enabled Apex Class Access → '), ui('Edit'), text(': add '), val(this.controllerClassName), text(', then '), ui('Save')],
                    [text('Enabled Visualforce Page Access → '), ui('Edit'), text(': add '), val(this.pageListName), text(', then '), ui('Save')],
                    [text('Click '), ui('View Users'), text(' and open the guest user')],
                    [text('Permission Set Assignments → '), ui('Edit Assignments'), text(': add '), val(this.guestPermissionSetName, false), text(', then '), ui('Save')]
                ],
                callout: {
                    variant: 'warning',
                    text: 'Add only the class and page above. Other Form Builder classes are for signed-in builders and must not be open to the public.'
                }
            },
            {
                id: 'sharing',
                title: 'Share published forms with visitors',
                short: 'Sharing rule',
                icon: 'utility:share',
                where: ['Setup', 'Sharing Settings'],
                why: 'Visitors can only submit to forms shared with the guest user. This rule shares forms marked Is Public, and new forms are public by default.',
                items: [
                    [text('Scroll to '), ui('Form Sharing Rules'), text(' and click '), ui('New')],
                    [text('Label: '), val('Public Forms for Guests')],
                    [text('Rule Type: '), ui('Guest user access, based on criteria')],
                    [text('Criteria: '), val('Is Public', false), text(' equals '), val('True', false)],
                    [text('Share with: '), val(`${this.siteLabel} Site Guest User`, false)],
                    [text('Access Level: '), ui('Read Only'), text(', then '), ui('Save')]
                ],
                callout: null
            },
            {
                id: 'url',
                title: 'Set the form link address',
                short: 'Link address',
                icon: 'utility:link',
                where: ['Setup', 'Custom Settings', this.customSettingName],
                why: "The app adds each form's ID to this address to build its shareable link.",
                items: [
                    [text('In '), ui('Setup → Sites'), text(', copy your site’s '), ui('Site URL')],
                    [text('Go to Custom Settings → '), val(this.customSettingName, false), text(' → '), ui('Manage')],
                    [text('Under '), ui('Default Organization Level Value'), text(', click '), ui('New'), text(' (or '), ui('Edit'), text(')')],
                    [text(`${this.customSettingFieldLabel}: your Site URL followed by `), val('?id='), text(', then '), ui('Save')]
                ],
                example: this.exampleUrl,
                callout: {
                    variant: 'info',
                    text: 'Set the organization-level value only. You do not need a separate value per user.'
                }
            }
        ];
    }

    get steps() {
        const defs = this.stepDefinitions;
        return defs.map((step, index) => {
            const isCurrent = index === this.currentIndex;
            const isDone = index < this.currentIndex;
            let railClass = 'rail-step';
            if (isCurrent) railClass += ' rail-step_current';
            if (isDone) railClass += ' rail-step_done';
            return {
                ...step,
                index,
                number: index + 1,
                isCurrent,
                isDone,
                railClass,
                ariaCurrent: isCurrent ? 'step' : null,
                whereLabel: step.where.join(' › '),
                items: step.items.map((segments, itemIndex) => ({
                    key: `${step.id}-${itemIndex}`,
                    segments: segments.map((seg, segIndex) => ({
                        key: `${step.id}-${itemIndex}-${segIndex}`,
                        value: seg.value,
                        copyable: !!seg.copyable,
                        isText: seg.kind === 'text',
                        isUi: seg.kind === 'ui',
                        isValue: seg.kind === 'value'
                    }))
                })),
                hasCallout: !!step.callout,
                calloutClass: step.callout ? `callout callout_${step.callout.variant}` : '',
                calloutIcon: step.callout && step.callout.variant === 'warning' ? 'utility:warning' : 'utility:info',
                calloutText: step.callout ? step.callout.text : '',
                hasExample: !!step.example
            };
        });
    }

    get currentStep() {
        return this.steps[this.currentIndex];
    }

    get totalSteps() {
        return this.stepDefinitions.length;
    }

    get stepCounter() {
        return `Step ${this.currentIndex + 1} of ${this.totalSteps}`;
    }

    get isFirst() {
        return this.currentIndex === 0;
    }

    get isLast() {
        return this.currentIndex === this.totalSteps - 1;
    }

    get progressStyle() {
        const pct = Math.round(((this.currentIndex + 1) / this.totalSteps) * 100);
        return `width: ${pct}%`;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    renderedCallback() {
        if (this.open && this._focusPending) {
            const dialog = this.template.querySelector('[data-id="dialog"]');
            if (dialog) {
                dialog.focus();
                this._focusPending = false;
            }
        }
        if (!this.open) {
            this._focusPending = true;
        }
    }

    connectedCallback() {
        this._focusPending = true;
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    handleRailClick(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isNaN(index)) {
            this.currentIndex = index;
        }
    }

    handleBack() {
        if (!this.isFirst) {
            this.currentIndex -= 1;
        }
    }

    handleNext() {
        if (!this.isLast) {
            this.currentIndex += 1;
        }
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this.handleClose();
        }
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleCopy(event) {
        const value = event.currentTarget.dataset.value;
        if (!value) return;
        try {
            await this.copyToClipboard(value);
            this.toast('Copied', `"${value}" copied to clipboard.`, 'success');
        } catch (e) {
            this.toast('Copy failed', 'Please select the text and copy it manually.', 'warning');
        }
    }

    async copyToClipboard(value) {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(value);
            return;
        }
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
