/* global api */
'use strict';

// World (profile) selection screen. Picking a world hands over to the workspace.

const WORLD_COLORS = ['#c9a24a', '#d4823c', '#b9584e', '#c0577f', '#a070b8', '#7a7fd1', '#4f86c6', '#4f9d8a', '#8bab4f', '#8a8f99'];
const profiles = $('#profiles');
let worldList = [];
let pfIndex = 0;

const worldAvatarUrl = w => (w && w.avatar ? `omni-world://${w.id}/${encodeURIComponent(w.avatar)}` : null);

// Shared by profile tiles, the sidebar switcher and the edit form's preview.
function paintAvatar(el, { color, name, url }) {
  el.style.setProperty('--c', color);
  el.style.backgroundImage = url ? `url("${url}")` : '';
  el.classList.toggle('has-img', !!url);
  el.textContent = url ? '' : (name || '?').trim().charAt(0).toUpperCase();
}

// "Prequel to X" / "Sequel to X" for stories in a series; empty for standalone stories.
function storyRole(w) {
  const series = worldList.filter(x => x.folder === w.folder);
  if (series.length < 2) return '';
  if (w.kind === 'standalone') return 'Original';
  const rel = worldList.find(x => x.id === w.relatedTo);
  if (rel) return `${w.kind === 'prequel' ? 'Prequel' : 'Sequel'} to ${rel.name}`;
  return `Part ${series.indexOf(w) + 1} of ${series.length}`;
}

async function showProfiles() {
  worldList = await api.listWorlds();
  pfIndex = 0;
  $('h1', profiles).textContent = worldList.length ? 'Choose a world' : 'Create your first world';
  profiles.classList.remove('hidden');
  renderProfiles();
}

function renderProfiles() {
  // Stories of one series sit side by side, joined by a line.
  $('.pf-row', profiles).innerHTML = worldList.map((w, i) => `
    <div class="pf-tile ${i > 0 && worldList[i - 1].folder === w.folder ? 'pf-linked' : ''}" data-i="${i}">
      <div class="pf-avatar"></div>
      <button class="pf-edit" data-edit="${i}" title="Edit world (E)">✎</button>
      <div class="pf-name">${esc(w.name)}</div>
      ${storyRole(w) ? `<div class="pf-role">${esc(storyRole(w))}</div>` : ''}
      <div class="pf-meta">${w.entryCount} ${w.entryCount === 1 ? 'entry' : 'entries'}</div>
    </div>`).join('') + `
    <div class="pf-tile pf-new" data-i="${worldList.length}">
      <div class="pf-avatar">+</div>
      <div class="pf-name">New world</div>
      <div class="pf-meta">&nbsp;</div>
    </div>`;
  profiles.querySelectorAll('.pf-tile:not(.pf-new) .pf-avatar').forEach((el, i) => {
    const w = worldList[i];
    paintAvatar(el, { color: w.color, name: w.name, url: worldAvatarUrl(w) });
  });
  focusProfile(Math.min(pfIndex, worldList.length));
}

function focusProfile(i) {
  const tiles = [...profiles.querySelectorAll('.pf-tile')];
  pfIndex = Math.max(0, Math.min(i, tiles.length - 1));
  tiles.forEach((t, j) => t.classList.toggle('focus', j === pfIndex));
  tiles[pfIndex].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  const w = worldList[pfIndex];
  profiles.style.setProperty('--pf-accent', w ? w.color : '#5a5d66');
}

function activateProfile(i) {
  return i < worldList.length ? enterWorld(worldList[i].id) : editWorld(null);
}

async function enterWorld(id) {
  const w = await api.openWorld(id);
  profiles.classList.add('hidden');
  // Each world tints the app with its own color.
  document.documentElement.style.setProperty('--accent', w.color);
  await startWorkspace(w);
}

// Leaving a world reloads the window, so nothing from the previous world lingers.
async function switchWorld() {
  await flushSaves();
  await api.closeWorld();
  location.reload();
}

async function editWorld(i) {
  const w = i == null ? null : worldList[i];
  const color = w ? w.color : WORLD_COLORS[worldList.length % WORLD_COLORS.length];
  let avatar = { path: null, url: worldAvatarUrl(w), remove: false };
  const done = modal(w ? 'Edit world' : 'New world', `
    <div class="avatar-pick">
      <div class="pf-avatar" id="wf-preview"></div>
      <div class="btns">
        <button type="button" id="wf-pick">Choose picture…</button>
        <button type="button" class="link" id="wf-clear">Remove picture</button>
      </div>
    </div>
    <label class="field">Name
      <input name="name" value="${esc(w ? w.name : '')}" placeholder="e.g. The Shattered Isles" maxlength="60" required>
    </label>
    <div class="field">Color
      <div class="swatches">${WORLD_COLORS.map(c => `
        <label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}
      </div>
    </div>
    ${!w && worldList.length ? `
    <div class="field">This story is
      <div class="seg">${['standalone', 'prequel', 'sequel'].map((k, i) => `
        <label><input type="radio" name="kind" value="${k}" ${i ? '' : 'checked'}><span>${k[0].toUpperCase() + k.slice(1)}</span></label>`).join('')}
      </div>
    </div>
    <label class="field hidden" id="wf-rel"><span id="wf-rel-label"></span>
      <select name="relatedTo">${worldList.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    </label>
    <div class="wf-note" id="wf-note"></div>` : ''}
    ${w && storyRole(w) ? `<div class="wf-note">${esc(storyRole(w))}. It shares characters and story elements with its series.</div>` : ''}`, {
    ok: w ? 'Save' : 'Create world',
    extra: w ? '<button type="submit" name="action" value="delete" class="danger left" formnovalidate>Delete world</button>' : '',
  });

  const form = $('#modal form');
  const preview = () => {
    paintAvatar($('#wf-preview', form), { color: $('[name=color]:checked', form).value, name: $('[name=name]', form).value, url: avatar.url });
    $('#wf-clear', form).classList.toggle('hidden', !avatar.url);
    const kind = $('[name=kind]:checked', form);
    if (!kind) return;
    const linked = kind.value !== 'standalone';
    const rel = worldList.find(x => x.id === $('[name=relatedTo]', form).value);
    $('#wf-rel', form).classList.toggle('hidden', !linked);
    $('#wf-rel-label', form).textContent = kind.value === 'prequel' ? 'Prequel to' : 'Sequel to';
    $('#wf-note', form).textContent = linked
      ? `Shares every character, place and story element with ${rel.name}${worldList.filter(x => x.folder === rel.folder).length > 1 ? ' and its series' : ''}. Its timeline events stay its own.`
      : 'Starts with its own empty library.';
  };
  preview();
  form.addEventListener('input', preview);
  $('#wf-pick', form).onclick = async () => {
    const picked = await api.pickWorldImage();
    if (picked) { avatar = { path: picked.path, url: picked.dataUrl, remove: false }; preview(); }
  };
  $('#wf-clear', form).onclick = () => { avatar = { path: null, url: null, remove: true }; preview(); };

  const res = await done;
  if (!res) return;
  if (res.action === 'delete') {
    const inSeries = worldList.filter(x => x.folder === w.folder).length > 1;
    const ok = await confirmBox(`Delete "${w.name}"?`, inSeries
      ? 'Its own timeline events are deleted. Characters and other shared entries stay with the rest of the series.'
      : `Its ${w.entryCount} entries and all their images are moved to the Recycle Bin.`, 'Delete world');
    if (ok) {
      await api.deleteWorld(w.id);
      await showProfiles();
    }
    return;
  }
  const fields = { name: res.name.trim() || 'Untitled world', color: res.color, avatarPath: avatar.path, removeAvatar: avatar.remove,
    kind: res.kind || 'standalone', relatedTo: res.relatedTo || null };
  if (!w) return enterWorld(await api.createWorld(fields));
  await api.updateWorld(w.id, fields);
  worldList = await api.listWorlds();
  renderProfiles();
}

profiles.addEventListener('mouseover', e => {
  const t = e.target.closest('.pf-tile');
  if (t && Number(t.dataset.i) !== pfIndex) focusProfile(Number(t.dataset.i));
});

profiles.addEventListener('click', e => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return editWorld(Number(edit.dataset.edit));
  const t = e.target.closest('.pf-tile');
  if (t) activateProfile(Number(t.dataset.i));
});

document.addEventListener('keydown', e => {
  if (profiles.classList.contains('hidden') || !$('#modal').classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') focusProfile(pfIndex + 1);
  else if (e.key === 'ArrowLeft') focusProfile(pfIndex - 1);
  else if (e.key === 'Enter' || e.key === ' ') activateProfile(pfIndex);
  else if (e.key.toLowerCase() === 'e' && pfIndex < worldList.length) editWorld(pfIndex);
  else return;
  e.preventDefault();
});

// The app always starts on the world picker.
showProfiles();
