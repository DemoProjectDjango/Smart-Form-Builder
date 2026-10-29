import { LightningElement, api } from 'lwc';

const circle = (cx, cy, r) =>
    `M${cx + r} ${cy}a${r} ${r} 0 1 1-${2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0`;

const rect = (x, y, w, h, r) =>
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}` +
    `h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}z`;

// Stroke icons drawn on a 24x24 grid. Each entry: [strokeWidth, ...pathData].
const ICONS = {
    check: [3, 'M5 12.5l4.5 4.5L19 7.5'],
    warn: [2.2, 'M12 3l10 18H2z', 'M12 10v5M12 18v.5'],
    info: [2.2, circle(12, 12, 9), 'M12 11v6M12 7.5v.5'],
    ok: [2.4, circle(12, 12, 9), 'M8 12.5l3 3 5-6'],
    bad: [2.4, circle(12, 12, 9), 'M15 9l-6 6M9 9l6 6'],
    up: [2.6, 'M6 15l6-6 6 6'],
    down: [2.6, 'M6 9l6 6 6-6'],
    edit: [2.2, 'M4 20h4L19 9l-4-4L4 16z'],
    trash: [2.2, 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
    eye: [2.2, 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', circle(12, 12, 3)],
    external: [2.2, 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    copy: [2.2, rect(9, 9, 11, 11, 2), 'M5 15V5a1 1 0 0 1 1-1h9'],
    refresh: [2.2, 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5'],
    book: [2, 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z', 'M4 19V5'],
    search: [2.2, circle(11, 11, 7), 'M20 20l-4-4'],
    plus: [2.4, 'M12 5v14M5 12h14'],
    close: [2.6, 'M6 6l12 12M18 6L6 18'],
    lock: [2.2, rect(5, 11, 14, 10, 2), 'M8 11V7a4 4 0 0 1 8 0v4'],
    save: [2.2, 'M5 4h11l3 3v13H5z', 'M8 4v5h7V4M8 20v-6h8v6'],
    branch: [2.4, 'M6 3v12a3 3 0 0 0 3 3h9M14 14l4 4-4 4'],
    logo: [2.2, rect(4, 3, 16, 18, 2), 'M8 8h8M8 12h8M8 16h5'],
    globe: [2, circle(12, 12, 9), 'M3 12h18', 'M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18'],
    mail: [2, rect(3, 5, 18, 14, 2), 'M3 7l9 6 9-6'],
    user: [2, circle(12, 8, 4), 'M4 21a8 8 0 0 1 16 0'],
    phone: [2, 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'],
    chat: [2, 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z'],
    clock: [2, circle(12, 12, 9), 'M12 7v5l3 2'],
    chevronLeft: [2.4, 'M15 6l-6 6 6 6'],
    chevronRight: [2.4, 'M9 6l6 6-6 6']
};

export default class SmartFormsIcon extends LightningElement {
    @api name = 'info';

    get icon() {
        return ICONS[this.name] || ICONS.info;
    }

    get strokeWidth() {
        return String(this.icon[0]);
    }

    get paths() {
        return this.icon.slice(1).map((d, index) => ({ key: `${this.name}-${index}`, d }));
    }
}
