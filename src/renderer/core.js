/* global api */
'use strict';

// Shared building blocks: entry types, helpers, icons, dialogs, the fuzzy picker
// (quick switcher / command palette) and batched saving.

const TYPES = [
  { name: 'Character', plural: 'Characters', color: '#c9a24a', shape: 'ellipse', fields: ['Role', 'Age', 'Species', 'Affiliation'] },
  { name: 'Location', plural: 'Locations', color: '#4f9d8a', shape: 'round-rectangle', fields: ['Region', 'Climate', 'Population'] },
  { name: 'Faction', plural: 'Factions', color: '#b9584e', shape: 'round-hexagon', fields: ['Leader', 'Goal', 'Base'] },
  { name: 'Item', plural: 'Items', color: '#7a7fd1', shape: 'round-diamond', fields: ['Owner', 'Origin', 'Abilities'] },
  { name: 'Creature', plural: 'Creatures', color: '#8bab4f', shape: 'round-octagon', fields: ['Habitat', 'Diet', 'Threat level'] },
  { name: 'Lore', plural: 'Lore', color: '#a070b8', shape: 'round-tag', fields: ['Era', 'Source'] },
  { name: 'Event', plural: 'Events', color: '#d4823c', shape: 'star', fields: ['Outcome'] },
];
const typeOf = name => TYPES.find(t => t.name === name) || { name, plural: name, color: '#888', shape: 'ellipse', fields: [] };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imgUrl = file => `omni-img://${encodeURIComponent(file)}`;
const bg = file => (file ? `background-image:url('${imgUrl(file)}')` : '');
const dot = type => `<span class="dot" style="background:${typeOf(type).color}"></span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// Line icons (24px grid, stroked) used across the ribbon, headers and menus.
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="M8.3 7.2 15.7 7.5M7 8.4l1.6 7.2M16.6 10.1l-5.8 6.2"/>',
  timeline: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="10" cy="18" r="1.6" fill="currentColor"/>',
  command: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  forward: '<path d="M9 18l6-6-6-6"/>',
  read: '<path d="M2 6.5C4.5 5 7.5 5 12 7c4.5-2 7.5-2 10-.5v12c-2.5-1.5-5.5-1.5-10 .5-4.5-2-7.5-2-10-.5z"/><path d="M12 7v12.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  backlink: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  outline: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  collapse: '<path d="M7 15l5-5 5 5"/>',
  save: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  board: '<rect x="2.5" y="4" width="7" height="5" rx="1.2"/><rect x="14.5" y="4" width="7" height="5" rx="1.2"/><rect x="8.5" y="15" width="7" height="5" rx="1.2"/><path d="M9.5 6.5h5M18 9v3.5a2 2 0 0 1-2 2h-.5M6 9v3.5a2 2 0 0 0 2 2h.5"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>',
  sticky: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  arrange: '<rect x="3" y="5" width="5" height="4" rx="1"/><rect x="10" y="10" width="5" height="4" rx="1"/><rect x="17" y="15" width="4" height="4" rx="1"/><path d="M8 7h2.5v3M15 12h3v3"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>',
  swap: '<path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4"/>',
  'arrow-curved': '<path d="M4 19C4 9 20 15 20 5"/><path d="M16 5h4v4"/>',
  'arrow-straight': '<path d="M4 20 20 4"/><path d="M13 4h7v7"/>',
  'arrow-elbow': '<path d="M4 20v-8h16V5"/><path d="M16.5 8.5 20 5l3.5 3.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
};
const icon = (name, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

// ---------------------------------------------------------------- dialogs

// `extra` buttons go after OK in the DOM so Enter still means OK; a submit button with
// name="action" reports its value in the result.
function modal(title, bodyHtml, { ok = 'OK', danger = false, extra = '' } = {}) {
  const el = $('#modal');
  el.innerHTML = `<form class="modal-box"><h3>${esc(title)}</h3>${bodyHtml}
    <div class="actions"><button type="button" data-cancel>Cancel</button>
    <button type="submit" class="${danger ? 'danger' : 'primary'}">${esc(ok)}</button>${extra}</div></form>`;
  el.classList.remove('hidden');
  const form = $('form', el);
  (form.querySelector('input, select, textarea') || form.querySelector('[type=submit]')).focus();
  return new Promise(resolve => {
    const close = value => { el.classList.add('hidden'); el.innerHTML = ''; resolve(value); };
    form.onsubmit = e => { e.preventDefault(); close(Object.fromEntries(new FormData(form, e.submitter))); };
    $('[data-cancel]', form).onclick = () => close(null);
    el.onmousedown = e => { if (e.target === el) close(null); };
    form.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
  });
}

const confirmBox = (title, message, ok = 'Delete') =>
  modal(title, `<div style="color:var(--muted)">${esc(message)}</div>`, { ok, danger: true }).then(Boolean);

const isOverlayOpen = () => !$('#modal').classList.contains('hidden') || !$('#picker').classList.contains('hidden')
  || !$('#profiles').classList.contains('hidden') || !$('#lightbox').classList.contains('hidden');

// ---------------------------------------------------------------- fuzzy picker

// Scores a subsequence match: consecutive and word-start hits rank higher. null = no match.
function fuzzy(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (s === q) return 1000;
  if (s.startsWith(q)) return 500 - s.length;
  const i = s.indexOf(q);
  if (i >= 0) return 300 - i - s.length;
  let score = 0, pos = 0, run = 0;
  for (const ch of q) {
    const found = s.indexOf(ch, pos);
    if (found < 0) return null;
    run = found === pos ? run + 1 : 0;
    score += 10 + run * 5 + (found === 0 || /\W/.test(s[found - 1]) ? 15 : 0) - (found - pos);
    pos = found + 1;
  }
  return score - s.length;
}

function highlight(text, query) {
  if (!query) return esc(text);
  const s = text.toLowerCase();
  const q = query.toLowerCase();
  const i = s.indexOf(q);
  if (i >= 0) return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  let out = '', pos = 0;
  for (let k = 0; k < text.length; k++) {
    if (pos < q.length && s[k] === q[pos]) { out += `<mark>${esc(text[k])}</mark>`; pos++; } else out += esc(text[k]);
  }
  return out;
}

// A floating search list (Obsidian's quick switcher / command palette).
// items(query) returns [{ label, detail, hint, icon (html), run(event) }].
// onCancel runs when it closes without a choice.
function openPicker({ placeholder, items, emptyText = 'No matches', onCancel }) {
  const el = $('#picker');
  el.innerHTML = `<div class="picker-box">
    <input class="picker-input" placeholder="${esc(placeholder)}" spellcheck="false">
    <div class="picker-list"></div>
    <div class="picker-foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Ctrl ↵</kbd> new tab</span><span><kbd>esc</kbd> close</span></div>
  </div>`;
  el.classList.remove('hidden');
  const input = $('.picker-input', el);
  const list = $('.picker-list', el);
  let current = [];
  let sel = 0;
  const close = picked => { el.classList.add('hidden'); el.innerHTML = ''; if (!picked) onCancel?.(); };
  const render = () => {
    current = items(input.value.trim());
    sel = Math.min(sel, Math.max(0, current.length - 1));
    list.innerHTML = current.length
      ? current.map((it, i) => `<div class="picker-item ${i === sel ? 'sel' : ''}" data-i="${i}">
          ${it.icon || ''}<span class="pi-label">${it.label}</span>
          ${it.detail ? `<span class="pi-detail">${it.detail}</span>` : ''}
          ${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</div>`).join('')
      : `<div class="picker-empty">${esc(emptyText)}</div>`;
    const s = $('.sel', list);
    if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const choose = (i, e) => { const it = current[i]; if (!it) return; close(true); it.run(e); };
  input.oninput = () => { sel = 0; render(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, current.length); render(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + current.length) % Math.max(1, current.length); render(); }
    else if (e.key === 'Enter') choose(sel, e);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  list.onmousemove = e => {
    const it = e.target.closest('.picker-item');
    if (it && Number(it.dataset.i) !== sel) { sel = Number(it.dataset.i); render(); }
  };
  list.onclick = e => { const it = e.target.closest('.picker-item'); if (it) choose(Number(it.dataset.i), e); };
  el.onmousedown = e => { if (e.target === el) close(); };
  render();
  input.focus();
}

// Asks which type a new entry should be. Resolves to a type name or null.
function pickType(title = 'Create a new…', { exclude } = {}) {
  return new Promise(resolve => openPicker({
    placeholder: title,
    onCancel: () => resolve(null),
    items: q => TYPES
      .filter(t => t.name !== exclude)
      .map(t => ({ t, score: fuzzy(q, t.name) }))
      .filter(x => x.score != null)
      .sort((a, b) => b.score - a.score)
      .map(({ t }) => ({ label: highlight(t.name, q), icon: dot(t.name), run: () => resolve(t.name) })),
  }));
}

// ---------------------------------------------------------------- saving

// Edits are batched per entry and written shortly after typing stops.
const pendingSaves = new Map();
const saveListeners = [];
const flushSoon = debounce(() => flushSaves(), 500);

function queueSave(id, patch) {
  pendingSaves.set(id, { ...(pendingSaves.get(id) || {}), ...patch });
  flushSoon();
}

async function flushSaves() {
  flushSoon.cancel();
  const batch = [...pendingSaves];
  pendingSaves.clear();
  for (const [id, patch] of batch) {
    await api.updateEntry(id, patch);
    saveListeners.forEach(fn => fn(id, patch));
  }

}

window.addEventListener('beforeunload', () => { if (pendingSaves.size) flushSaves(); });
