/* global api */
'use strict';

// App shell: ribbon, views, cast panel, selection, quick switcher / command palette, shortcuts.

const ui = {
  world: null,
  index: [], // every entry in the open world
  byName: new Map(), // lower-cased name → entry, for [[links]]
  byId: new Map(),
  view: null,
  views: {},
  selection: null, // { kind: 'entry' | 'edge' | 'note', id }
};

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

const VIEWS = [
  { key: 'board', label: 'Plot board', icon: 'board', make: () => new PlotBoard() },
  { key: 'codex', label: 'Codex', icon: 'book', make: () => new CodexView() },
  { key: 'web', label: 'Relationship web', icon: 'graph', make: () => new WebView() },
  { key: 'timeline', label: 'Timeline', icon: 'timeline', make: () => new TimelineView() },
];

// ---------------------------------------------------------------- data

async function refreshIndex() {
  ui.index = await api.listEntries({});
  ui.byName = new Map(ui.index.map(e => [e.name.trim().toLowerCase(), e]));
  ui.byId = new Map(ui.index.map(e => [e.id, e]));
  renderCast();
}

const resolveLink = name => ui.byName.get(String(name).trim().toLowerCase()) || null;

// Entries changed: refresh the cast list and the visible view; other views refresh when opened.
async function dataChanged() {
  await refreshIndex();
  for (const [key, v] of Object.entries(ui.views)) {
    if (key === ui.view) await v.refresh(); else v.stale = true;
  }
}

saveListeners.push((id, patch) => {
  if (Object.keys(patch).every(k => k === 'notes')) return;
  dataChanged();
});

async function createEntry(type, name = '') {
  const t = typeOf(type);
  return api.createEntry({ type: t.name, name, fields: t.fields.map(key => ({ key, value: '' })) });
}

// New character, place etc.: created, shown in the cast list and opened in the details panel.
async function newEntry(type) {
  type = type || await pickType();
  if (!type) return;
  if (type === 'Event') {
    await switchView('board');
    return ui.views.board.addEvent();
  }
  const id = await createEntry(type, '');
  await dataChanged();
  select({ kind: 'entry', id });
  inspector.focusTitle();
}

// Selects an entry; events are also brought into view on the plot board.
async function openEntry(id) {
  const e = ui.byId.get(id);
  if (e && e.type === 'Event' && ui.view === 'board') {
    select({ kind: 'entry', id });
    ui.views.board.reveal(`e${id}`);
    return;
  }
  select({ kind: 'entry', id });
}

// Following a [[link]]: select the entry, or offer to create it.
async function followLink(name) {
  const hit = resolveLink(name);
  if (hit) return openEntry(hit.id);
  const type = await pickType(`“${name}” doesn't exist yet. Create it as…`);
  if (!type) return;
  if (type === 'Event') {
    await switchView('board');
    const id = await createEntry('Event', name.trim());
    await api.saveBoardPositions([{ id, ...roundPoint(ui.views.board.center()) }]);
    await dataChanged();
    return openEntry(id);
  }
  const id = await createEntry(type, name.trim());
  await dataChanged();
  select({ kind: 'entry', id });
}

const roundPoint = p => ({ x: Math.round(p.x - 120), y: Math.round(p.y - 30) });

async function deleteEntry(id) {
  const e = ui.byId.get(id);
  if (!e) return;
  const what = e.type === 'Event' ? 'event' : e.type.toLowerCase();
  if (!(await confirmBox(`Delete “${e.name || 'Untitled'}”?`, `The ${what}, its images and its connections are deleted.`))) return;
  pendingSaves.delete(id);
  await api.deleteEntry(id);
  if (ui.selection && ui.selection.kind === 'entry' && ui.selection.id === id) select(null);
  await dataChanged();
}

// ---------------------------------------------------------------- selection & views

function select(sel) {
  const same = sel && ui.selection && sel.kind === ui.selection.kind && sel.id === ui.selection.id;
  ui.selection = sel;
  if (!same) inspector.render();
  ui.views[ui.view]?.onSelect?.(sel);
  markCast();
}

async function switchView(key) {
  if (!ui.views[key]) {
    ui.views[key] = VIEWS.find(v => v.key === key).make();
    ui.views[key].stale = true;
  }
  const v = ui.views[key];
  if (ui.view !== key) {
    $('#main').replaceChildren(v.el);
    ui.view = key;
    $$('#ribbon [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === key));
    store.set(`omni.view.${ui.world.id}`, key);
  }
  if (key === 'board' || v.stale) { v.stale = false; await v.refresh(); }
  v.onSelect?.(ui.selection);
}

// ---------------------------------------------------------------- cast panel (left)

const castClosed = new Set(store.get('omni.castClosed', []));

function renderCast() {
  const filter = $('#cast-filter').value.trim().toLowerCase();
  const html = TYPES.filter(t => t.name !== 'Event').map(t => {
    const all = ui.index.filter(e => e.type === t.name);
    const items = filter ? all.filter(e => e.name.toLowerCase().includes(filter)) : all;
    if (filter && !items.length) return '';
    const open = filter || !castClosed.has(t.name);
    return `<div class="cg ${open ? 'open' : ''}">
      <div class="cg-head" data-group="${t.name}"><span class="caret">${icon('chevron', 12)}</span>${dot(t.name)}
        <span class="cg-label">${t.plural}</span><span class="cg-count">${all.length}</span>
        <button class="cg-add" data-add="${t.name}" title="New ${t.name}">${icon('plus', 14)}</button></div>
      <div class="cg-items">${items.map(e => `
        <div class="cast-row" draggable="true" data-entry="${e.id}" title="Drag onto an event · click for details">
          ${avatarHtml(e)}<span class="cr-name">${esc(e.name) || '<em>Unnamed</em>'}</span>
        </div>`).join('') || (filter ? '' : `<button class="cg-empty" data-add="${t.name}">${icon('plus', 12)} Add ${t.name === 'Lore' ? 'lore' : `a ${t.name.toLowerCase()}`}</button>`)}</div>
    </div>`;
  }).join('');
  $('#cast-list').innerHTML = html || '<div class="cast-none">No matches.</div>';
  markCast();
}

// Highlights the selected entry, and who is in the selected event.
function markCast() {
  const s = ui.selection;
  const inScene = new Set();
  if (s && s.kind === 'entry' && ui.views.board && ui.views.board.participants.has(s.id)) {
    ui.views.board.participants.get(s.id).forEach(p => inScene.add(p.id));
  }
  $$('.cast-row').forEach(r => {
    const id = Number(r.dataset.entry);
    r.classList.toggle('selected', !!s && s.kind === 'entry' && s.id === id);
    r.classList.toggle('in-scene', inScene.has(id));
  });
}

$('#cast-filter').addEventListener('input', renderCast);
$('#cast-list').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) return newEntry(add.dataset.add);
  const head = e.target.closest('[data-group]');
  if (head) {
    const g = head.dataset.group;
    castClosed.has(g) ? castClosed.delete(g) : castClosed.add(g);
    store.set('omni.castClosed', [...castClosed]);
    return renderCast();
  }
  const row = e.target.closest('[data-entry]');
  if (row) select({ kind: 'entry', id: Number(row.dataset.entry) });
});
$('#cast-list').addEventListener('dragstart', e => {
  const row = e.target.closest('[data-entry]');
  if (!row) return;
  e.dataTransfer.setData('application/x-omni-entry', row.dataset.entry);
  e.dataTransfer.effectAllowed = 'link';
  document.body.classList.add('dragging-cast');
});
$('#cast-list').addEventListener('dragend', () => document.body.classList.remove('dragging-cast'));
$('#cast-list').addEventListener('contextmenu', e => {
  const row = e.target.closest('[data-entry]');
  if (!row) return;
  e.preventDefault();
  const id = Number(row.dataset.entry);
  select({ kind: 'entry', id });
  showMenu(e.clientX, e.clientY, [
    { label: 'Rename', icon: 'edit', run: () => inspector.focusTitle() },
    { label: 'Delete', icon: 'trash', danger: true, run: () => deleteEntry(id) },
  ]);
});

function togglePanel(id) {
  const el = $(id);
  el.classList.toggle('hidden');
  store.set(`omni.panel.${id}`, !el.classList.contains('hidden'));
  setTimeout(() => ui.views.web?.cy?.resize(), 0);
}

// ---------------------------------------------------------------- context menu & toast

function showMenu(x, y, items) {
  const m = $('#ctx-menu');
  m.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon, 15)}${esc(it.label)}</button>`).join('');
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  m.onclick = e => { const b = e.target.closest('[data-i]'); if (b) { m.classList.add('hidden'); items[Number(b.dataset.i)].run(); } };
}
document.addEventListener('mousedown', e => { if (!e.target.closest('#ctx-menu')) $('#ctx-menu').classList.add('hidden'); });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- images: drop, paste, lightbox

async function addImagesFromFiles(files) {
  const s = ui.selection;
  if (!s || s.kind !== 'entry' || !files.length) return toast('Select an event or character first, then add images');
  let added = 0;
  for (const f of files) {
    const p = api.pathForFile(f);
    if (p) added += await api.importImagePaths(s.id, [p]);
    else if (f.type.startsWith('image/')) added += await api.importImageBuffer(s.id, f.type.split('/')[1].replace('jpeg', 'jpg'), await f.arrayBuffer());
  }
  if (added) { toast(`Added ${plural(added, 'image')}`); await inspector.imagesChanged(); }
}

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) addImagesFromFiles([...e.dataTransfer.files]);
});
document.addEventListener('paste', e => {
  const files = [...e.clipboardData.items].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile());
  if (!files.length || !ui.world) return;
  e.preventDefault();
  addImagesFromFiles(files);
});

const lightbox = $('#lightbox');
let lb = { images: [], index: 0 };
function openLightbox(images, index) {
  lb = { images, index };
  showLightbox();
  lightbox.classList.remove('hidden');
}
function showLightbox() {
  const img = lb.images[lb.index];
  if (!img) return;
  $('img', lightbox).src = imgUrl(img.file);
  $('.lb-caption', lightbox).value = img.caption;
  $('.lb-prev', lightbox).classList.toggle('hidden', lb.images.length < 2);
  $('.lb-next', lightbox).classList.toggle('hidden', lb.images.length < 2);
}
function stepLightbox(d) {
  lb.index = (lb.index + d + lb.images.length) % lb.images.length;
  showLightbox();
}
const saveCaption = debounce((id, caption) => api.updateImage(id, { caption }), 400);
$('.lb-caption', lightbox).addEventListener('input', e => {
  const img = lb.images[lb.index];
  img.caption = e.target.value;
  saveCaption(img.id, img.caption);
});
$('.lb-close', lightbox).onclick = () => lightbox.classList.add('hidden');
$('.lb-prev', lightbox).onclick = () => stepLightbox(-1);
$('.lb-next', lightbox).onclick = () => stepLightbox(1);
lightbox.addEventListener('mousedown', e => { if (e.target === lightbox) lightbox.classList.add('hidden'); });

// ---------------------------------------------------------------- switcher, palette, shortcuts

function openSwitcher() {
  openPicker({
    placeholder: 'Find an event, character, place… or type a new name',
    emptyText: 'Type a name',
    items: q => {
      const hits = ui.index
        .map(e => ({ e, score: fuzzy(q, e.name) }))
        .filter(x => x.score != null)
        .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
        .slice(0, 60)
        .map(({ e }) => ({
          label: highlight(e.name || 'Untitled', q), detail: esc(e.type), icon: dot(e.type),
          run: async () => {
            if (e.type === 'Event' && ui.view !== 'board') await switchView('board');
            openEntry(e.id);
          },
        }));
      if (q && !resolveLink(q)) hits.push({ label: `Create “${esc(q)}”`, detail: 'new', icon: icon('plus', 15), run: () => followLink(q) });
      return hits;
    },
  });
}

function commands() {
  const s = ui.selection;
  return [
    { label: 'New event', hint: 'double-click board', icon: 'plus', run: () => newEntry('Event') },
    { label: 'New sticky note', icon: 'sticky', run: async () => { await switchView('board'); ui.views.board.addNote(); } },
    ...TYPES.filter(t => t.name !== 'Event').map(t => ({ label: `New ${t.name.toLowerCase()}`, icon: 'plus', run: () => newEntry(t.name) })),
    { label: 'Find anything', hint: 'Ctrl+O', icon: 'search', run: openSwitcher },
    ...VIEWS.map((v, i) => ({ label: `Go to ${v.label}`, hint: `Ctrl+${i + 1}`, icon: v.icon, run: () => switchView(v.key) })),
    { label: 'Fit the plot board in view', icon: 'fit', run: async () => { await switchView('board'); ui.views.board.fit(); } },
    { label: 'Arrange the plot board', icon: 'arrange', run: async () => { await switchView('board'); ui.views.board.arrange(); } },
    s && s.kind === 'entry' && { label: 'Delete selected', hint: 'Del', icon: 'trash', run: () => deleteEntry(s.id) },
    { label: 'Show / hide cast panel', hint: 'Ctrl+[', icon: 'users', run: () => togglePanel('#cast') },
    { label: 'Show / hide details panel', hint: 'Ctrl+]', icon: 'panel', run: () => togglePanel('#inspector') },
    { label: 'Back up this world…', icon: 'save', run: backup },
    { label: 'Open data folder', icon: 'folder', run: () => api.openDataFolder() },
    { label: 'Switch world', icon: 'globe', run: switchWorld },
  ].filter(Boolean);
}

function openPalette() {
  openPicker({
    placeholder: 'Type a command…',
    items: q => commands()
      .map(c => ({ c, score: fuzzy(q, c.label) }))
      .filter(x => x.score != null)
      .sort((a, b) => (q ? b.score - a.score : 0))
      .map(({ c }) => ({ label: highlight(c.label, q), hint: c.hint, icon: icon(c.icon, 15), run: c.run })),
  });
}

async function backup() {
  const dest = await api.backup();
  if (dest) modal('Backup complete', `<div style="color:var(--muted);word-break:break-all">Saved to ${esc(dest)}</div>`, { ok: 'Done' });
}

const isTyping = () => {
  const a = document.activeElement;
  return a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable);
};

document.addEventListener('keydown', e => {
  if (!ui.world || isOverlayOpen()) {
    if (!lightbox.classList.contains('hidden')) {
      if (e.key === 'Escape') lightbox.classList.add('hidden');
      if (!isTyping() && e.key === 'ArrowLeft') stepLightbox(-1);
      if (!isTyping() && e.key === 'ArrowRight') stepLightbox(1);
    }
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  let handled = true;
  if (ctrl && key === 'o') openSwitcher();
  else if (ctrl && key === 'p') openPalette();
  else if (ctrl && key === 'n') newEntry();
  else if (ctrl && /^[1-4]$/.test(e.key)) switchView(VIEWS[Number(e.key) - 1].key);
  else if (ctrl && e.key === '[') togglePanel('#cast');
  else if (ctrl && e.key === ']') togglePanel('#inspector');
  else if (e.key === 'Escape' && isTyping() && document.activeElement.closest('.board-view')) document.activeElement.blur();
  else if (e.key === 'Escape' && !isTyping() && ui.selection) select(null);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping() && ui.view === 'board') ui.views.board.deleteSelection();
  else handled = false;
  if (handled) e.preventDefault();
});

// Ribbon (far-left icon strip).
$('#ribbon').innerHTML = `
  <button class="rb-world" data-cmd="world" title="Switch world"><span class="ws-avatar"></span></button>
  ${VIEWS.map((v, i) => `<button data-view="${v.key}" title="${v.label} (Ctrl+${i + 1})">${icon(v.icon, 19)}</button>`).join('')}
  <span class="rb-sep"></span>
  <button data-cmd="switcher" title="Find anything (Ctrl+O)">${icon('search', 19)}</button>
  <span class="rb-spacer"></span>
  <button data-cmd="palette" title="All commands (Ctrl+P)">${icon('command', 19)}</button>`;
$('#ribbon').addEventListener('click', e => {
  const v = e.target.closest('[data-view]');
  if (v) return switchView(v.dataset.view);
  const b = e.target.closest('[data-cmd]');
  if (b) ({ world: () => switchWorld(), switcher: openSwitcher, palette: openPalette })[b.dataset.cmd]();
});
$('#cast-world').onclick = () => switchWorld();
$('#cast-new').innerHTML = icon('plus', 15);
$('#cast-new').onclick = () => newEntry();

// ---------------------------------------------------------------- start

async function startWorkspace(w) {
  ui.world = w;
  paintAvatar($('.ws-avatar'), { color: w.color, name: w.name, url: worldAvatarUrl(w) });
  $('#cast-world .cw-name').textContent = w.name;
  $('#cast-world .cw-sub').textContent = w.series.length > 1 ? `${w.series.length} stories in this series · switch` : 'Switch world';
  for (const id of ['#cast', '#inspector']) if (store.get(`omni.panel.${id}`, true) === false) $(id).classList.add('hidden');
  $('#app').classList.remove('hidden');
  inspector.init();
  inspector.render();
  await refreshIndex();
  await switchView(store.get(`omni.view.${w.id}`, 'board'));
}
