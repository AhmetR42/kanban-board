import { addCard, emptyState, moveCard } from './board.js';

// A few cards so the board is not empty on the first visit.
// Due dates are relative to today so the demo always looks current.
function inDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

const cards = [
    { id: 's1', title: 'Fix login rate limit', priority: 'high', due: inDays(-2), tags: 'backend, security', column: 'todo' },
    { id: 's2', title: 'Write README screenshots', description: 'Light and dark mode, plus a GIF of drag and drop.', priority: 'medium', due: inDays(7), column: 'todo' },
    { id: 's3', title: 'Try a new font pairing', priority: 'low', tags: 'design', column: 'todo' },
    { id: 's4', title: 'Drag and drop with keyboard support', priority: 'high', due: inDays(2), tags: 'a11y', column: 'progress' },
    { id: 's5', title: 'EN/NL language switch', priority: 'medium', tags: 'i18n', column: 'progress' },
    { id: 's6', title: 'Import and export as JSON', priority: 'medium', tags: 'data', column: 'review' },
    { id: 's7', title: 'Save board in localStorage', priority: 'medium', column: 'done' },
    { id: 's8', title: 'Migrate cards from version 1', priority: 'low', column: 'done' },
];

export function sampleState() {
    return cards.reduce((state, card) => {
        const next = addCard(state, card, card.id);
        return card.column === 'todo' ? next : moveCard(next, card.id, card.column);
    }, emptyState());
}
