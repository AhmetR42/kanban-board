// Pure board logic: every function takes a state and returns a new one.
// Nothing here touches the DOM or localStorage, so it is easy to test.

export const COLUMNS = ['todo', 'progress', 'review', 'done'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const WIP_LIMIT = 3;

export function emptyState() {
    return { version: 2, cards: [] };
}

let counter = 0;
export function newId() {
    counter += 1;
    return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

function normaliseTags(tags) {
    const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
    return [...new Set(list.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 5);
}

export function cardsIn(state, column) {
    return state.cards.filter((card) => card.column === column).sort((a, b) => a.order - b.order);
}

// Give every card in a column order 0, 1, 2… after a change.
function renumber(cards, column) {
    const inColumn = cards.filter((c) => c.column === column).sort((a, b) => a.order - b.order);
    const orders = new Map(inColumn.map((card, index) => [card.id, index]));
    return cards.map((card) => (orders.has(card.id) ? { ...card, order: orders.get(card.id) } : card));
}

export function addCard(state, fields, id = newId()) {
    const title = String(fields.title ?? '').trim();
    if (!title) return state;

    const column = COLUMNS.includes(fields.column) ? fields.column : 'todo';
    const card = {
        id,
        title: title.slice(0, 120),
        description: String(fields.description ?? '').trim().slice(0, 1000),
        priority: PRIORITIES.includes(fields.priority) ? fields.priority : 'medium',
        due: fields.due || null,
        tags: normaliseTags(fields.tags),
        column,
        order: cardsIn(state, column).length,
        createdAt: fields.createdAt ?? new Date().toISOString(),
    };

    return { ...state, cards: [...state.cards, card] };
}

export function updateCard(state, id, fields) {
    return {
        ...state,
        cards: state.cards.map((card) => {
            if (card.id !== id) return card;
            const next = { ...card };
            if (fields.title !== undefined && String(fields.title).trim()) next.title = String(fields.title).trim().slice(0, 120);
            if (fields.description !== undefined) next.description = String(fields.description).trim().slice(0, 1000);
            if (PRIORITIES.includes(fields.priority)) next.priority = fields.priority;
            if (fields.due !== undefined) next.due = fields.due || null;
            if (fields.tags !== undefined) next.tags = normaliseTags(fields.tags);
            return next;
        }),
    };
}

// Move a card to a column at a given index (clamped). Also used for reordering.
export function moveCard(state, id, column, index) {
    const card = state.cards.find((c) => c.id === id);
    if (!card || !COLUMNS.includes(column)) return state;

    const others = cardsIn(state, column).filter((c) => c.id !== id);
    const at = Math.max(0, Math.min(index ?? others.length, others.length));
    others.splice(at, 0, card);
    const orders = new Map(others.map((c, i) => [c.id, i]));

    let cards = state.cards.map((c) => {
        if (c.id === id) return { ...c, column, order: orders.get(c.id) };
        if (orders.has(c.id)) return { ...c, order: orders.get(c.id) };
        return c;
    });
    if (card.column !== column) cards = renumber(cards, card.column);

    return { ...state, cards };
}

export function deleteCard(state, id) {
    const card = state.cards.find((c) => c.id === id);
    if (!card) return state;
    return { ...state, cards: renumber(state.cards.filter((c) => c.id !== id), card.column) };
}

export function isOverdue(card, today = new Date()) {
    if (!card.due || card.column === 'done') return false;
    const day = today.toISOString().slice(0, 10);
    return card.due < day;
}

export function matches(card, { query = '', priority = '' } = {}) {
    if (priority && card.priority !== priority) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [card.title, card.description, ...card.tags].some((text) => text.toLowerCase().includes(q));
}

export function overWipLimit(state, column = 'progress') {
    return column === 'progress' && cardsIn(state, column).length > WIP_LIMIT;
}

export function stats(state) {
    const total = state.cards.length;
    const done = cardsIn(state, 'done').length;
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

// Accept saved data from this version, or the first version of this app
// (a plain array of { id, text, column: 'todo'|'inprogress'|'done', order }).
export function migrate(raw) {
    if (Array.isArray(raw)) {
        let state = emptyState();
        const columnMap = { todo: 'todo', inprogress: 'progress', done: 'done' };
        [...raw]
            .filter((task) => task && typeof task.text === 'string')
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .forEach((task) => {
                state = addCard(state, { title: task.text, column: columnMap[task.column] ?? 'todo' }, `v1-${task.id ?? newId()}`);
            });
        return state;
    }

    if (raw && raw.version === 2 && Array.isArray(raw.cards)) {
        let state = emptyState();
        for (const card of raw.cards) {
            if (!card || typeof card.title !== 'string' || !card.id) continue;
            state = addCard(state, card, String(card.id));
        }
        // Keep the saved order within each column.
        const sorted = [...raw.cards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        for (const card of sorted) {
            if (state.cards.some((c) => c.id === String(card.id))) {
                state = moveCard(state, String(card.id), state.cards.find((c) => c.id === String(card.id)).column);
            }
        }
        return state;
    }

    return emptyState();
}
