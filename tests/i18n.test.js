import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, t } from '../js/i18n.js';

function keys(object, prefix = '') {
    return Object.entries(object).flatMap(([key, value]) =>
        typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
}

test('English and Dutch have exactly the same keys', () => {
    assert.deepEqual(keys(messages.nl).sort(), keys(messages.en).sort());
});

test('fills in placeholders and nested keys', () => {
    assert.equal(t('progress', 'nl', { done: 2, total: 5 }), '2 van 5 klaar');
    assert.equal(t('columns.progress', 'en'), 'In progress');
});

test('falls back to English, then to the key', () => {
    assert.equal(t('save', 'de'), 'Save');
    assert.equal(t('nope', 'nl'), 'nope');
});
