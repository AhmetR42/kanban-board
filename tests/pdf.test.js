import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCard, emptyState, moveCard } from '../js/board.js';
import { t } from '../js/i18n.js';
import { boardToPdf, textWidth, toWinAnsi, wrap } from '../js/pdf.js';

const options = {
    tr: (key, params) => t(key, 'nl', params),
    formatDate: (iso) => iso,
    today: new Date('2026-10-13T12:00:00Z'),
    generatedOn: 'Geëxporteerd op 13 okt 2026',
};
const asText = (bytes) => String.fromCharCode(...bytes);

test('keeps Dutch accents and replaces characters the PDF fonts lack', () => {
    assert.equal(toWinAnsi('Geëxporteerd'), 'Ge\xebxporteerd');
    assert.equal(toWinAnsi('komma’s 🚀'), 'komma\x92s ?');
});

test('wraps text to the width and shortens with an ellipsis', () => {
    const lines = wrap('Write the README with screenshots of the board', 80, 10);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(textWidth(line, 10) <= 80);

    const short = wrap('one two three four five six seven eight nine ten', 40, 10, false, 2);
    assert.equal(short.length, 2);
    assert.ok(short[1].endsWith('…'));
});

test('builds a valid PDF with the cards in it', () => {
    let state = addCard(emptyState(), { title: 'Fix (login) bug', priority: 'high', due: '2026-10-01' }, 'a');
    state = addCard(state, { title: 'Ship it' }, 'b');
    state = moveCard(state, 'b', 'done');

    const pdf = asText(boardToPdf(state, options));
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.ok(pdf.trimEnd().endsWith('%%EOF'));
    assert.ok(pdf.includes('Fix \\(login\\) bug'));
    assert.ok(pdf.includes('Te laat'));
    assert.match(pdf, /\/Count 1 /);

    // The cross-reference table must point at the real object positions.
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    assert.ok(pdf.slice(xref).startsWith('xref'));
    const first = Number(pdf.slice(xref).split('\n')[3].slice(0, 10));
    assert.ok(pdf.slice(first).startsWith('1 0 obj'));
});

test('adds pages when a column is too long', () => {
    let state = emptyState();
    for (let i = 0; i < 40; i += 1) state = addCard(state, { title: `Card ${i}`, description: 'Some text to make the card taller.' }, `c${i}`);
    const pdf = asText(boardToPdf(state, options));
    const count = Number(pdf.match(/\/Count (\d+)/)[1]);
    assert.ok(count >= 3);
    assert.ok(pdf.includes('Card 39'));
});
