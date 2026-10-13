// Builds a PDF of the board without any library. The PDF uses the two
// fonts every PDF reader has built in (Helvetica and Helvetica-Bold), so the
// file stays small and needs no font embedding.

import { COLUMNS, cardsIn, isOverdue, stats } from './board.js';

const PAGE_W = 842; // A4 landscape, in points
const PAGE_H = 595;
const MARGIN = 32;
const GAP = 12;
const COL_W = (PAGE_W - MARGIN * 2 - GAP * (COLUMNS.length - 1)) / COLUMNS.length;
const CARD_W = COL_W - 12;
const PAD = 9;
const BOTTOM = PAGE_H - 34;

const COLORS = {
    deep: [0.122, 0.29, 0.173],
    accent: [0.706, 0.827, 0.38],
    ink: [0.06, 0.16, 0.1],
    muted: [0.36, 0.43, 0.37],
    white: [1, 1, 1],
    column: [0.937, 0.953, 0.91],
    card: [1, 1, 1],
    line: [0.82, 0.87, 0.76],
    overdue: [0.71, 0.14, 0.09],
    priority: { high: [0.76, 0.25, 0.05], medium: [0.3, 0.49, 0.06], low: [0.15, 0.39, 0.92] },
    dot: { todo: [0.55, 0.6, 0.56], progress: [0.85, 0.62, 0.12], review: [0.3, 0.45, 0.85], done: [0.45, 0.62, 0.15] },
};

// Character widths (per 1000 units) for ASCII 32–126, from the standard font metrics.
const WIDTHS = {
    regular: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
    bold: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
};

// Characters outside Latin-1 that the WinAnsi encoding still has.
const WIN_ANSI = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

export function toWinAnsi(text) {
    return [...String(text)].map((char) => {
        const code = char.codePointAt(0);
        if (WIN_ANSI[char]) return String.fromCharCode(WIN_ANSI[char]);
        if ((code >= 32 && code < 127) || (code >= 0xa0 && code <= 0xff)) return char;
        return '?';
    }).join('');
}

export function textWidth(text, size, bold = false) {
    const table = bold ? WIDTHS.bold : WIDTHS.regular;
    let units = 0;
    for (const char of toWinAnsi(text)) {
        const code = char.charCodeAt(0);
        units += code >= 32 && code <= 126 ? table[code - 32] : 556;
    }
    return (units * size) / 1000;
}

// Split text into lines that fit the width; very long words are cut.
export function wrap(text, width, size, bold = false, maxLines = Infinity) {
    const lines = [];
    let line = '';
    const push = (value) => lines.push(value);

    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        let piece = word;
        while (textWidth(piece, size, bold) > width) {
            let cut = piece.length - 1;
            while (cut > 1 && textWidth(piece.slice(0, cut), size, bold) > width) cut -= 1;
            if (line) {
                push(line);
                line = '';
            }
            push(piece.slice(0, cut));
            piece = piece.slice(cut);
        }
        const candidate = line ? `${line} ${piece}` : piece;
        if (textWidth(candidate, size, bold) <= width) {
            line = candidate;
        } else {
            push(line);
            line = piece;
        }
    }
    if (line) push(line);

    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1];
        while (last && textWidth(`${last}…`, size, bold) > width) last = last.slice(0, -1);
        kept[maxLines - 1] = `${last.trimEnd()}…`;
        return kept;
    }
    return lines;
}

const num = (value) => Number(value.toFixed(2)).toString();
const rgb = (color) => color.map(num).join(' ');
const escapePdf = (text) => toWinAnsi(text).replace(/[\\()]/g, (char) => `\\${char}`);

// A tiny drawing surface. Coordinates are from the top-left, like the screen.
class Page {
    constructor() {
        this.ops = [];
    }

    roundRect(x, y, w, h, r, fill, stroke) {
        const k = 0.5523 * r;
        const top = PAGE_H - y;
        const bottom = top - h;
        const p = [
            `${num(x + r)} ${num(top)} m`,
            `${num(x + w - r)} ${num(top)} l`,
            `${num(x + w - r + k)} ${num(top)} ${num(x + w)} ${num(top - r + k)} ${num(x + w)} ${num(top - r)} c`,
            `${num(x + w)} ${num(bottom + r)} l`,
            `${num(x + w)} ${num(bottom + r - k)} ${num(x + w - r + k)} ${num(bottom)} ${num(x + w - r)} ${num(bottom)} c`,
            `${num(x + r)} ${num(bottom)} l`,
            `${num(x + r - k)} ${num(bottom)} ${num(x)} ${num(bottom + r - k)} ${num(x)} ${num(bottom + r)} c`,
            `${num(x)} ${num(top - r)} l`,
            `${num(x)} ${num(top - r + k)} ${num(x + r - k)} ${num(top)} ${num(x + r)} ${num(top)} c`,
        ];
        if (fill) this.ops.push(`${rgb(fill)} rg`);
        if (stroke) this.ops.push(`${rgb(stroke)} RG 0.75 w`);
        this.ops.push(...p, fill && stroke ? 'B' : fill ? 'f' : 'S');
    }

    rect(x, y, w, h, fill) {
        this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re f`);
    }

    circle(cx, cy, r, fill) {
        this.roundRect(cx - r, cy - r, r * 2, r * 2, r, fill);
    }

    check(cx, cy, color) {
        const y = (value) => num(PAGE_H - value);
        this.ops.push(`${rgb(color)} RG 1.3 w 1 J 1 j ${num(cx - 2.6)} ${y(cy)} m ${num(cx - 0.6)} ${y(cy + 2)} l ${num(cx + 2.8)} ${y(cy - 2.2)} l S`);
    }

    // y is the baseline, measured from the top of the page.
    text(value, x, y, size, { bold = false, color = COLORS.ink } = {}) {
        this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(x)} ${num(PAGE_H - y)} Td (${escapePdf(value)}) Tj ET`);
    }

    textRight(value, right, y, size, options = {}) {
        this.text(value, right - textWidth(value, size, options.bold), y, size, options);
    }
}

function serialise(pages) {
    const objects = [];
    const add = (body) => {
        objects.push(body);
        return objects.length;
    };

    const catalog = add(null);
    const pagesId = add(null);
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const kids = pages.map((page) => {
        const stream = page.ops.join('\n');
        const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
            + `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`);
    });

    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = objects.map((body, index) => {
        const offset = out.length;
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
        return offset;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    // Every character is a single byte (see toWinAnsi), so offsets are byte offsets.
    return Uint8Array.from(out, (char) => char.charCodeAt(0));
}

function layoutCard(card, tr, formatDate, today) {
    const inner = CARD_W - PAD * 2;
    const done = card.column === 'done';
    const title = wrap(card.title, done ? inner - 16 : inner, 10, true, 4);
    const description = done || !card.description ? [] : wrap(card.description, inner, 8, false, 3);
    const tags = done || !card.tags.length ? [] : wrap(card.tags.map((tag) => `#${tag}`).join('  '), inner, 7.5, false, 2);

    let height = PAD + title.length * 12.5 + PAD - 3;
    if (!done) height += 14;
    if (description.length) height += 3 + description.length * 10.5;
    if (tags.length) height += 4 + tags.length * 10;

    const overdue = isOverdue(card, today);
    const due = card.due ? `${overdue ? `${tr('overdue')} · ` : ''}${formatDate(card.due)}` : '';
    return { card, done, title, description, tags, height, due, overdue };
}

function drawCard(page, item, x, y, tr) {
    page.roundRect(x, y, CARD_W, item.height, 6, COLORS.card, COLORS.line);
    let cursor = y + PAD;

    if (item.done) {
        page.circle(x + PAD + 5, cursor + 5, 5.5, COLORS.accent);
        page.check(x + PAD + 5, cursor + 5, COLORS.deep);
        item.title.forEach((line, i) => page.text(line, x + PAD + 16, cursor + 8.5 + i * 12.5, 10, { bold: true, color: COLORS.muted }));
        return;
    }

    const color = COLORS.priority[item.card.priority];
    page.text(tr(`priorities.${item.card.priority}`).toUpperCase(), x + PAD, cursor + 7, 7, { bold: true, color });
    if (item.due) page.textRight(item.due, x + CARD_W - PAD, cursor + 7, 7.5, { color: item.overdue ? COLORS.overdue : COLORS.muted, bold: item.overdue });
    cursor += 14;

    item.title.forEach((line, i) => page.text(line, x + PAD, cursor + 9 + i * 12.5, 10, { bold: true }));
    cursor += item.title.length * 12.5;

    if (item.description.length) {
        cursor += 3;
        item.description.forEach((line, i) => page.text(line, x + PAD, cursor + 8 + i * 10.5, 8, { color: COLORS.muted }));
        cursor += item.description.length * 10.5;
    }
    if (item.tags.length) {
        cursor += 4;
        item.tags.forEach((line, i) => page.text(line, x + PAD, cursor + 7.5 + i * 10, 7.5, { color: COLORS.priority.medium }));
    }
}

// tr(key, params) looks up interface text; formatDate turns '2026-10-13' into '13 Oct'.
export function boardToPdf(state, { tr, formatDate, today = new Date(), generatedOn }) {
    const queues = COLUMNS.map((column) => cardsIn(state, column).map((card) => layoutCard(card, tr, formatDate, today)));
    const counts = queues.map((queue) => queue.length);
    const { done, total, percent } = stats(state);
    const pages = [];

    do {
        const page = new Page();
        const first = pages.length === 0;
        const bandHeight = first ? 74 : 40;

        page.rect(0, 0, PAGE_W, bandHeight, COLORS.deep);
        page.rect(0, bandHeight, PAGE_W, 3, COLORS.accent);
        if (first) {
            page.text(tr('eyebrow').toUpperCase(), MARGIN, 26, 8, { bold: true, color: COLORS.accent });
            page.text(tr('appTitle'), MARGIN, 52, 22, { bold: true, color: COLORS.white });
            page.textRight(`${percent}%`, PAGE_W - MARGIN, 44, 22, { bold: true, color: COLORS.accent });
            page.textRight(tr('progress', { done, total }), PAGE_W - MARGIN, 58, 9, { color: COLORS.white });
        } else {
            page.text(tr('appTitle'), MARGIN, 26, 13, { bold: true, color: COLORS.white });
        }

        const top = bandHeight + 20;
        COLUMNS.forEach((column, index) => {
            const x = MARGIN + index * (COL_W + GAP);
            page.roundRect(x, top, COL_W, BOTTOM - top, 8, COLORS.column);
            page.circle(x + 12, top + 14, 3, COLORS.dot[column]);
            page.text(tr(`columns.${column}`), x + 20, top + 17.5, 10, { bold: true });
            page.textRight(String(counts[index]), x + COL_W - 10, top + 17.5, 9, { color: COLORS.muted });

            let y = top + 28;
            const queue = queues[index];
            if (first && !queue.length) {
                page.text('—', x + 10, y + 12, 10, { color: COLORS.muted });
            }
            while (queue.length && y + queue[0].height <= BOTTOM - 6) {
                const item = queue.shift();
                drawCard(page, item, x + 6, y, tr);
                y += item.height + 7;
            }
        });

        pages.push(page);
    } while (queues.some((queue) => queue.length) && pages.length < 50);

    pages.forEach((page, index) => {
        page.text(generatedOn, MARGIN, PAGE_H - 16, 7.5, { color: COLORS.muted });
        page.textRight(`${index + 1} / ${pages.length}`, PAGE_W - MARGIN, PAGE_H - 16, 7.5, { color: COLORS.muted });
    });

    return serialise(pages);
}
