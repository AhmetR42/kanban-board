import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addCard, cardsIn, deleteCard, emptyState, isOverdue, matches, migrate, moveCard, overWipLimit, stats, updateCard,
} from '../js/board.js';

const titles = (state, column) => cardsIn(state, column).map((card) => card.title);

function board(...names) {
    return names.reduce((state, name) => addCard(state, { title: name }, name), emptyState());
}

test('adds cards to the end of To do', () => {
    const state = board('A', 'B');
    assert.deepEqual(titles(state, 'todo'), ['A', 'B']);
});

test('ignores empty titles and cleans up tags', () => {
    let state = addCard(emptyState(), { title: '   ' });
    assert.equal(state.cards.length, 0);

    state = addCard(state, { title: 'Write tests', tags: 'Laravel, PHP, laravel, ' }, 'x');
    assert.deepEqual(state.cards[0].tags, ['laravel', 'php']);
    assert.equal(state.cards[0].priority, 'medium');
});

test('moves a card to another column at a position', () => {
    let state = board('A', 'B', 'C');
    state = moveCard(state, 'C', 'progress', 0);
    state = moveCard(state, 'A', 'progress', 0);

    assert.deepEqual(titles(state, 'todo'), ['B']);
    assert.deepEqual(titles(state, 'progress'), ['A', 'C']);
    assert.deepEqual(cardsIn(state, 'todo').map((c) => c.order), [0]);
});

test('reorders inside a column and clamps the index', () => {
    let state = board('A', 'B', 'C');
    state = moveCard(state, 'A', 'todo', 99);
    assert.deepEqual(titles(state, 'todo'), ['B', 'C', 'A']);

    state = moveCard(state, 'A', 'todo', -5);
    assert.deepEqual(titles(state, 'todo'), ['A', 'B', 'C']);
});

test('updates and deletes cards', () => {
    let state = board('A', 'B');
    state = updateCard(state, 'A', { title: 'A2', priority: 'high', due: '2026-01-01' });
    assert.equal(state.cards[0].title, 'A2');
    assert.equal(state.cards[0].priority, 'high');

    state = deleteCard(state, 'A');
    assert.deepEqual(titles(state, 'todo'), ['B']);
    assert.equal(cardsIn(state, 'todo')[0].order, 0);
});

test('knows when a card is overdue', () => {
    const today = new Date('2026-10-13T12:00:00Z');
    assert.equal(isOverdue({ due: '2026-10-12', column: 'todo' }, today), true);
    assert.equal(isOverdue({ due: '2026-10-13', column: 'todo' }, today), false);
    assert.equal(isOverdue({ due: '2026-10-01', column: 'done' }, today), false);
    assert.equal(isOverdue({ due: null, column: 'todo' }, today), false);
});

test('filters by text, tag and priority', () => {
    const card = { title: 'Fix login', description: 'Rate limit', tags: ['security'], priority: 'high' };
    assert.equal(matches(card, { query: 'LOGIN' }), true);
    assert.equal(matches(card, { query: 'secur' }), true);
    assert.equal(matches(card, { query: 'css' }), false);
    assert.equal(matches(card, { priority: 'low' }), false);
});

test('warns when too much is in progress', () => {
    let state = board('A', 'B', 'C', 'D');
    for (const id of ['A', 'B', 'C']) state = moveCard(state, id, 'progress');
    assert.equal(overWipLimit(state), false);
    state = moveCard(state, 'D', 'progress');
    assert.equal(overWipLimit(state), true);
});

test('counts progress', () => {
    let state = board('A', 'B', 'C', 'D');
    state = moveCard(state, 'A', 'done');
    assert.deepEqual(stats(state), { total: 4, done: 1, percent: 25 });
});

test('migrates data saved by the first version of the app', () => {
    const old = [
        { id: 2, text: 'Second', column: 'todo', order: 1 },
        { id: 1, text: 'First', column: 'todo', order: 0 },
        { id: 3, text: 'Busy', column: 'inprogress', order: 0 },
        { id: 4, text: 'Finished', column: 'done', order: 0 },
    ];
    const state = migrate(old);
    assert.deepEqual(titles(state, 'todo'), ['First', 'Second']);
    assert.deepEqual(titles(state, 'progress'), ['Busy']);
    assert.deepEqual(titles(state, 'done'), ['Finished']);
});

test('round-trips its own format and rejects junk', () => {
    let state = board('A', 'B', 'C');
    state = moveCard(state, 'C', 'todo', 0);
    const again = migrate(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(titles(again, 'todo'), ['C', 'A', 'B']);

    assert.deepEqual(migrate({ hello: 'world' }), emptyState());
    assert.deepEqual(migrate(null), emptyState());
});
