import {
    COLUMNS, WIP_LIMIT, addCard, cardsIn, deleteCard, emptyState, isOverdue, matches, migrate, moveCard, overWipLimit,
    stats, updateCard,
} from './board.js';
import { LOCALES, t } from './i18n.js';
import { boardToPdf } from './pdf.js';
import { sampleState } from './sample.js';

const STORAGE_KEY = 'kanban-board:v2';
const LEGACY_KEY = 'tasks';
const LOCALE_KEY = 'kanban-board:locale';
const AUTOSAVE_KEY = 'kanban-board:autosave';
const RING = 2 * Math.PI * 21;

const $ = (selector) => document.querySelector(selector);
const board = $('#board');
const page = $('.page');
const editor = $('#editor');
const form = $('#editor-form');
const search = $('#search');
const langToggle = $('.lang');

let state = load();
let locale = loadLocale();
const filter = { query: '', priority: '' };
let editing = null; // { id } for an existing card, { column } for a new one
let keyMove = null; // { id, column, index } while a card is picked up with the keyboard
let drag = null;
let rendering = false;
let autosave = loadAutosave();
let dirty = false;
let saveState = 'saved';

const tr = (key, params) => t(key, locale, params);

/* ---------- Storage ---------- */

function load() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return migrate(JSON.parse(saved));

        // Bring over cards from the first version of this app.
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) return migrate(JSON.parse(legacy));
    } catch {
        return emptyState();
    }
    return sampleState();
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage can be full or blocked; the board still works for this visit.
    }
}

function loadAutosave() {
    try {
        return localStorage.getItem(AUTOSAVE_KEY) !== 'off';
    } catch {
        return true;
    }
}

function setSaveState(next) {
    saveState = next;
    const status = $('#save-status');
    status.dataset.state = next;
    $('#save-text').textContent = tr(next);
}

let savingTimer;
function persist() {
    save();
    dirty = false;
    setSaveState('saving');
    clearTimeout(savingTimer);
    savingTimer = setTimeout(() => { if (!dirty) setSaveState('saved'); }, 450);
}

function loadLocale() {
    try {
        const saved = localStorage.getItem(LOCALE_KEY);
        if (LOCALES.includes(saved)) return saved;
    } catch {
        // ignore
    }
    return navigator.language?.toLowerCase().startsWith('nl') ? 'nl' : 'en';
}

// Every change goes through here. With auto-save on it is stored right away,
// otherwise the board is marked as having unsaved changes.
function commit(next, focusId) {
    state = next;
    if (autosave) {
        persist();
    } else {
        dirty = true;
        setSaveState('unsaved');
    }
    render(focusId);
}

/* ---------- Rendering ---------- */

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function formatDate(iso) {
    const formatter = new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'short' });
    return formatter.format(new Date(`${iso}T00:00:00`));
}

const checkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

function cardHtml(card) {
    const title = escapeHtml(card.title);
    const attrs = `class="card${card.column === 'done' ? ' is-done' : ''}" data-id="${escapeHtml(card.id)}" tabindex="0" role="button"`
        + ` aria-label="${escapeHtml(tr('openCard', { title: card.title }))}" aria-describedby="move-hint"`;

    if (card.column === 'done') {
        return `<article ${attrs}><span class="check">${checkIcon}</span><h3>${title}</h3></article>`;
    }

    const overdue = isOverdue(card);
    const due = card.due
        ? `<span class="due${overdue ? ' is-overdue' : ''}">${overdue ? `${tr('overdue')} · ` : ''}${formatDate(card.due)}</span>`
        : '';
    const description = card.description ? `<p>${escapeHtml(card.description)}</p>` : '';
    const tags = card.tags.length
        ? `<div class="tags">${card.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
        : '';

    return `<article ${attrs}>
        <div class="card-top"><span class="priority priority-${card.priority}">${tr(`priorities.${card.priority}`)}</span>${due}</div>
        <h3>${title}</h3>${description}${tags}
    </article>`;
}

function columnHtml(column) {
    const all = cardsIn(state, column);
    const visible = all.filter((card) => matches(card, filter));
    const over = overWipLimit(state, column);
    const count = column === 'progress' ? `${all.length} / ${WIP_LIMIT}` : all.length;

    return `<section class="column${over ? ' is-over-limit' : ''}" data-column="${column}" aria-labelledby="col-${column}">
        <header class="column-head">
            <span class="dot" aria-hidden="true"></span>
            <h2 id="col-${column}">${tr(`columns.${column}`)}</h2>
            <span class="count" aria-label="${tr('cardsInColumn', { count: all.length })}">${count}</span>
        </header>
        ${over ? `<p class="wip">${tr('wipWarning', { limit: WIP_LIMIT })}</p>` : ''}
        <div class="cards">${visible.length ? visible.map(cardHtml).join('') : `<div class="empty">${tr('emptyColumn')}</div>`}</div>
        ${column === 'todo' ? `<button type="button" class="add-inline" data-add="todo">+ ${tr('addCard')}</button>` : ''}
    </section>`;
}

function render(focusId) {
    rendering = true;
    board.innerHTML = COLUMNS.map(columnHtml).join('');

    const filtering = filter.query || filter.priority;
    if (filtering && !state.cards.some((card) => matches(card, filter))) {
        board.insertAdjacentHTML('beforeend', `<p class="no-matches">${tr('noMatches')}</p>`);
    }

    const { total, done, percent } = stats(state);
    $('#progress-bar').style.strokeDashoffset = RING * (1 - percent / 100);
    $('#progress-percent').textContent = `${percent}%`;
    $('#progress-label').textContent = tr('progress', { done, total });

    if (focusId) {
        const card = board.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
        if (card) {
            card.focus({ preventScroll: false });
            if (keyMove?.id === focusId) card.classList.add('is-picked');
        }
    }
    rendering = false;
}

function applyLocale() {
    document.documentElement.lang = locale;
    document.title = tr('appTitle');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', tr(el.dataset.i18nLabel)));

    setSaveState(saveState);
    langToggle.dataset.active = locale;
    langToggle.querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.locale === locale));
    });
    render();
}

/* ---------- Feedback ---------- */

function announce(message) {
    const announcer = $('#announcer');
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = message; });
}

let toastTimer;
function toast(message, actionLabel, action) {
    const box = $('#toast');
    const button = $('#toast-action');
    $('#toast-text').textContent = message;
    button.hidden = !action;
    button.textContent = actionLabel ?? '';
    button.onclick = () => {
        box.hidden = true;
        action();
    };
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 6000);
}

/* ---------- Editor ---------- */

function openEditor(id, column = 'todo') {
    const card = id ? state.cards.find((c) => c.id === id) : null;
    editing = card ? { id } : { column };

    $('#editor-title').textContent = tr(card ? 'editCard' : 'newCard');
    form.elements.title.value = card?.title ?? '';
    form.elements.description.value = card?.description ?? '';
    form.elements.priority.value = card?.priority ?? 'medium';
    form.elements.due.value = card?.due ?? '';
    form.elements.tags.value = card?.tags.join(', ') ?? '';
    $('#delete-card').hidden = !card;

    editor.showModal();
    form.elements.title.focus();
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    if (!fields.title.trim()) return;

    if (editing.id) {
        commit(updateCard(state, editing.id, fields), editing.id);
    } else {
        const before = new Set(state.cards.map((c) => c.id));
        const next = addCard(state, { ...fields, column: editing.column });
        commit(next, next.cards.find((c) => !before.has(c.id))?.id);
    }
    editor.close();
});

editor.addEventListener('click', (event) => {
    // Close on a click on the dimmed backdrop or a close button.
    if (event.target === editor || event.target.closest('[data-close]')) editor.close();
});

$('#delete-card').addEventListener('click', () => {
    const before = state;
    commit(deleteCard(state, editing.id));
    editor.close();
    toast(tr('deleted'), tr('undo'), () => commit(before));
});

/* ---------- Pointer drag and drop ---------- */

function cardIndex(column, list, placeholder) {
    const others = cardsIn(state, column).filter((c) => c.id !== drag.id);
    const siblings = [...list.children];
    const at = siblings.indexOf(placeholder);
    const next = siblings.slice(at + 1).find((el) => el.matches('.card') && el !== drag.el);
    const prev = siblings.slice(0, at).reverse().find((el) => el.matches('.card') && el !== drag.el);
    if (next) return others.findIndex((c) => c.id === next.dataset.id);
    if (prev) return others.findIndex((c) => c.id === prev.dataset.id) + 1;
    return others.length;
}

function startDrag(event) {
    const rect = drag.el.getBoundingClientRect();
    drag.active = true;
    drag.offsetX = event.clientX - rect.left;
    drag.offsetY = event.clientY - rect.top;

    drag.ghost = drag.el.cloneNode(true);
    drag.ghost.classList.add('card-ghost');
    drag.ghost.removeAttribute('tabindex');
    drag.ghost.setAttribute('aria-hidden', 'true');
    drag.ghost.style.width = `${rect.width}px`;
    document.body.append(drag.ghost);

    drag.placeholder = document.createElement('div');
    drag.placeholder.className = 'placeholder';
    drag.placeholder.style.height = `${rect.height}px`;
    drag.el.after(drag.placeholder);
    drag.el.style.display = 'none';
    document.body.style.cursor = 'grabbing';
}

function moveDrag(event) {
    drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
    drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;

    if (event.clientY < 70) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 14);

    const column = document.elementFromPoint(event.clientX, event.clientY)?.closest('.column');
    if (!column) return;
    board.querySelectorAll('.column').forEach((el) => el.classList.toggle('is-target', el === column));

    const list = column.querySelector('.cards');
    const cards = [...list.querySelectorAll('.card')].filter((el) => el !== drag.el);
    const before = cards.find((el) => {
        const rect = el.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
    });
    if (before) {
        if (before.previousElementSibling !== drag.placeholder) list.insertBefore(drag.placeholder, before);
    } else if (list.lastElementChild !== drag.placeholder) {
        list.append(drag.placeholder);
    }
    list.querySelector('.empty')?.remove();
}

function endDrag(drop) {
    const { id, ghost, placeholder } = drag;
    ghost?.remove();
    document.body.style.cursor = '';

    if (drop && placeholder) {
        const column = placeholder.closest('.column').dataset.column;
        const index = cardIndex(column, placeholder.parentElement, placeholder);
        const card = state.cards.find((c) => c.id === id);
        drag = null;
        commit(moveCard(state, id, column, index));
        announce(tr('dropped', { title: card.title, column: tr(`columns.${column}`) }));
    } else {
        drag = null;
        render();
    }
}

board.addEventListener('pointerdown', (event) => {
    const card = event.target.closest('.card');
    if (!card || event.button !== 0 || keyMove) return;

    drag = { id: card.dataset.id, el: card, x: event.clientX, y: event.clientY, active: false, touch: event.pointerType === 'touch' };
    if (drag.touch) {
        // On touch screens a short press starts the drag, so normal scrolling still works.
        drag.timer = setTimeout(() => {
            if (drag && !drag.active) {
                startDrag(event);
                moveDrag(event);
                navigator.vibrate?.(10);
            }
        }, 280);
    }
});

window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.active) {
        const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
        if (drag.touch) {
            if (distance > 8) {
                clearTimeout(drag.timer);
                drag = null;
            }
            return;
        }
        if (distance < 6) return;
        startDrag(event);
    }
    moveDrag(event);
});

window.addEventListener('pointerup', () => {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active) {
        endDrag(true);
    } else {
        const { id } = drag;
        drag = null;
        openEditor(id);
    }
});

window.addEventListener('pointercancel', () => {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active) endDrag(false);
    else drag = null;
});

document.addEventListener('touchmove', (event) => {
    if (drag?.active) event.preventDefault();
}, { passive: false });

/* ---------- Keyboard moving ---------- */

function moveByKeyboard(column, index) {
    const others = cardsIn(state, column).filter((c) => c.id !== keyMove.id);
    const at = Math.max(0, Math.min(index, others.length));
    keyMove.column = column;
    keyMove.index = at;
    const card = state.cards.find((c) => c.id === keyMove.id);
    state = moveCard(state, keyMove.id, column, at);
    render(keyMove.id);
    announce(tr('movedTo', { title: card.title, column: tr(`columns.${column}`), position: at + 1 }));
}

function dropKeyboardMove() {
    const card = state.cards.find((c) => c.id === keyMove.id);
    const { id, column } = keyMove;
    keyMove = null;
    commit(state, id);
    announce(tr('dropped', { title: card.title, column: tr(`columns.${column}`) }));
}

board.addEventListener('keydown', (event) => {
    const el = event.target.closest('.card');
    if (!el) return;
    const { id } = el.dataset;

    if (!keyMove) {
        if (event.key === 'Enter') {
            event.preventDefault();
            openEditor(id);
        } else if (event.key === ' ') {
            event.preventDefault();
            const card = state.cards.find((c) => c.id === id);
            keyMove = { id, column: card.column, index: card.order, origin: { column: card.column, index: card.order }, before: state };
            el.classList.add('is-picked');
            announce(tr('pickedUp', { title: card.title }));
        }
        return;
    }

    const columnIndex = COLUMNS.indexOf(keyMove.column);
    switch (event.key) {
    case 'ArrowUp':
        moveByKeyboard(keyMove.column, keyMove.index - 1);
        break;
    case 'ArrowDown':
        moveByKeyboard(keyMove.column, keyMove.index + 1);
        break;
    case 'ArrowLeft':
        if (columnIndex > 0) moveByKeyboard(COLUMNS[columnIndex - 1], keyMove.index);
        break;
    case 'ArrowRight':
        if (columnIndex < COLUMNS.length - 1) moveByKeyboard(COLUMNS[columnIndex + 1], keyMove.index);
        break;
    case ' ':
    case 'Enter':
        dropKeyboardMove();
        break;
    case 'Escape': {
        const { id: movedId, before } = keyMove;
        keyMove = null;
        state = before;
        render(movedId);
        announce(tr('cancelled'));
        break;
    }
    default:
        return;
    }
    event.preventDefault();
});

board.addEventListener('focusout', (event) => {
    // Tabbing away while a card is picked up drops it where it is.
    if (keyMove && !rendering && event.target.dataset?.id === keyMove.id) dropKeyboardMove();
});

/* ---------- Toolbar ---------- */

board.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    if (add) openEditor(null, add.dataset.add);
});

$('#add-card').addEventListener('click', () => openEditor(null));

search.addEventListener('input', () => {
    filter.query = search.value;
    render();
});

search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
        search.value = '';
        filter.query = '';
        render();
    }
});

document.addEventListener('keydown', (event) => {
    const typing = event.target.closest('input, textarea, select, [contenteditable]');
    if (event.key === '/' && !typing && !editor.open) {
        event.preventDefault();
        search.focus();
    }
});

document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
        filter.priority = chip.dataset.priority;
        document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        render();
    });
});
document.querySelector('.chip[data-priority=""]').setAttribute('aria-pressed', 'true');
document.querySelectorAll('.chip:not([data-priority=""])').forEach((c) => c.setAttribute('aria-pressed', 'false'));

langToggle.addEventListener('click', (event) => {
    const button = event.target.closest('[data-locale]');
    if (!button || button.dataset.locale === locale) return;

    locale = button.dataset.locale;
    try {
        localStorage.setItem(LOCALE_KEY, locale);
    } catch {
        // ignore
    }

    // Slide the thumb right away, fade the page while the text changes.
    langToggle.dataset.active = locale;
    langToggle.classList.remove('is-bouncing');
    void langToggle.offsetWidth;
    langToggle.classList.add('is-bouncing');
    page.classList.add('is-switching');
    setTimeout(() => {
        applyLocale();
        page.classList.remove('is-switching');
    }, 220);
});

function download(bytes, type, extension) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([bytes], { type }));
    link.download = `kanban-board-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const exporters = {
    json: () => download(JSON.stringify(state, null, 2), 'application/json', 'json'),
    pdf: () => {
        const today = new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'long' }).format(new Date());
        download(boardToPdf(state, { tr, formatDate, generatedOn: tr('generatedOn', { date: today }) }), 'application/pdf', 'pdf');
    },
};

const menuToggle = $('#download-toggle');
const menu = $('#download-menu');

function setMenu(open) {
    menu.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button').focus();
}

menuToggle.addEventListener('click', () => setMenu(menu.hidden));

menu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-export]');
    if (!option) return;
    setMenu(false);
    exporters[option.dataset.export]();
    toast(tr('exported'));
});

menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
        setMenu(false);
        menuToggle.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
});

document.addEventListener('click', (event) => {
    if (!menu.hidden && !event.target.closest('.menu')) setMenu(false);
});

/* ---------- Saving ---------- */

const autosaveSwitch = $('#autosave');
autosaveSwitch.checked = autosave;

autosaveSwitch.addEventListener('change', () => {
    autosave = autosaveSwitch.checked;
    try {
        localStorage.setItem(AUTOSAVE_KEY, autosave ? 'on' : 'off');
    } catch {
        // ignore
    }
    if (autosave && dirty) persist();
    toast(tr(autosave ? 'autosaveOn' : 'autosaveOff'));
});

function saveNow() {
    persist();
    const button = $('#save-now');
    button.classList.remove('save-now-flash');
    void button.offsetWidth;
    button.classList.add('save-now-flash');
    toast(tr('boardSaved'));
}

$('#save-now').addEventListener('click', saveNow);

document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveNow();
    }
});

window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
});

$('#import').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;

    try {
        const raw = JSON.parse(await file.text());
        const valid = Array.isArray(raw) || (raw?.version === 2 && Array.isArray(raw.cards));
        if (!valid) throw new Error('Not a board');

        const before = state;
        commit(migrate(raw));
        toast(tr('imported'), tr('undo'), () => commit(before));
    } catch {
        toast(tr('importFailed'));
    }
});

applyLocale();
