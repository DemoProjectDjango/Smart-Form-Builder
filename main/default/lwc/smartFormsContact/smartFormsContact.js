import { LightningElement } from 'lwc';

// Fixed, vetted channels. `href` is the action link (https:, mailto: or tel: only).
const CHANNELS = [
    { id: 'website', icon: 'globe', label: 'Website', value: 'twinstack.net', href: 'https://twinstack.net' },
    { id: 'company-mail', icon: 'mail', label: 'Company Mail', value: 'info@twinstack.net', href: 'mailto:info@twinstack.net' },
    { id: 'employee-mail', icon: 'user', label: 'Employee Mail', value: 'saiful@twinstack.net', href: 'mailto:saiful@twinstack.net' },
    { id: 'phone-us', icon: 'phone', label: 'Direct Message (US)', value: '+19292037060', href: 'tel:+19292037060' },
    { id: 'whatsapp-bd', icon: 'chat', label: 'WhatsApp (BD)', value: '+8801556777043', href: 'https://wa.me/8801556777043' },
    {
        id: 'calendar',
        icon: 'clock',
        label: 'Calendar Link',
        value: 'calendar.app.google/HP3LiuNFisCt6xLo6',
        href: 'https://calendar.app.google/HP3LiuNFisCt6xLo6'
    }
];

/**
 * "Contact": support and inquiry channels with copy and open actions.
 */
export default class SmartFormsContact extends LightningElement {
    get channels() {
        return CHANNELS.map((c) => ({
            ...c,
            copyLabel: `Copy ${c.label}`,
            openLabel: `Open ${c.label}`,
            opensNewTab: c.href.startsWith('https:'),
            target: c.href.startsWith('https:') ? '_blank' : '_self',
            rel: c.href.startsWith('https:') ? 'noopener noreferrer' : null
        }));
    }

    async handleCopy(event) {
        const channel = CHANNELS.find((c) => c.id === event.currentTarget.dataset.id);
        if (!channel) return;
        const copied = await navigator.clipboard.writeText(channel.value).then(
            () => true,
            () => false
        );
        this.notify(copied ? 'Copied' : 'Select the text and copy it manually', copied ? undefined : 'error');
    }

    handleReturn() {
        this.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'start' } }));
    }

    notify(message, variant) {
        this.dispatchEvent(new CustomEvent('notify', { detail: { message, variant } }));
    }
}
