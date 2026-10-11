/* global api, OmniEditor */
'use strict';

// The details panel on the right. Shows and edits whatever is selected:
// an event or other entry, a connection between events, or a sticky note.

const inspector = {
  el: null,
  entry: null,
  backlinks: [],
  editor: null,
  draftName: null,

  init() {
    this.el = $('#inspector');
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('input', e => this.onInput(e));
    this.el.addEventListener('change', e => this.onChange(e));
    this.el.addEventListener('keydown', e => this.onKeydown(e));
    this.applyWidth();
  },

  applyWidth() {
    this.el.classList.toggle('wide', store.get('omni.inspectorWide', false));
  },

  section(key, title, body, action = '') {
    const closed = store.get('omni.insClosed', []).includes(key);
    return `<section class="ins-sec ${closed ? 'closed' : ''}">
      <div class="ins-sec-head" data-sec="${key}"><span class="caret">${icon('chevron', 12)}</span>${title}${action}</div>
      <div class="ins-sec-body">${body}</div>
    </section>`;
  },

  // ---------------------------------------------------------------- rendering

  async render() {
    if (this.entry && this.draftName != null) await this.commitTitle();
    this.editor?.destroy();
    this.editor = null;
    this.entry = null;
    this.draftName = null;
    const s = ui.selection;
    if (!s) return this.renderEmpty();
    if (s.kind === 'entry') return this.renderEntry(s.id);
    if (s.kind === 'edge') return this.renderEdge(s.id);
    if (s.kind === 'note') return this.renderNote(s.id);
  },

  // Re-reads the selected entry after something else changed it (e.g. a cast member was dropped on it).
  async reload() {
    if (!this.entry) return this.render();
    const scroll = this.el.scrollTop;
    const notes = this.editor ? this.editor.getValue() : null;
    const [entry, backlinks] = await Promise.all([api.getEntry(this.entry.id), api.backlinks(this.entry.id)]);
    if (!entry) return select(null);
    if (notes != null) entry.notes = notes;
    this.entry = entry;
    this.backlinks = backlinks;
    this.renderEntryBody();
    this.el.scrollTop = scroll;
  },

  renderEmpty() {
    this.el.innerHTML = `
      <div class="ins-empty">
        ${icon('board', 30)}
        <h3>Nothing selected</h3>
        <p>Click an event, character or sticky note to see and edit its details here.</p>
        <ul>
          <li><b>Double-click</b> the board to add an event</li>
          <li><b>Drag the dot</b> on a card's edge to the next event to connect them</li>
          <li><b>Drag a character</b> from the left onto an event to add them to the scene</li>
          <li>Type <code>[[</code> in notes to link anything</li>
          <li><kbd>Ctrl+O</kbd> find anything · <kbd>Ctrl+P</kbd> all commands</li>
        </ul>
      </div>`;
  },

  async renderEntry(id) {
    const [entry, backlinks] = await Promise.all([api.getEntry(id), api.backlinks(id)]);
    if (!ui.selection || ui.selection.kind !== 'entry' || ui.selection.id !== id) return; // selection moved on
    if (!entry) return select(null);
    this.entry = entry;
    this.backlinks = backlinks;
    this.el.scrollTop = 0;
    this.renderEntryBody();
  },

  renderEntryBody() {
    const e = this.entry;
    const isEvent = e.type === 'Event';
    const cover = coverOf(e);
    const people = e.relations.filter(r => r.other_type !== 'Event');
    const plot = e.relations.filter(r => r.other_type === 'Event');
    const series = ui.world.series;
    const wide = store.get('omni.inspectorWide', false);

    const relRow = r => `
      <div class="ins-rel">
        ${r.direction === 'out' ? `<span class="rel-dir">→</span>` : `<span class="rel-dir">←</span>`}
        <a class="rel-other" data-goto="${r.other_id}">${dot(r.other_type)}${esc(r.other_name)}</a>
        ${r.label && r.label !== 'involves' ? `<span class="rel-label">${esc(r.label)}</span>` : ''}
        <button class="x" data-act="del-rel" data-rel="${r.id}" title="Remove">${icon('x', 12)}</button>
      </div>`;

    const html = `
      <div class="ins-top">
        <div class="ins-kicker">${dot(e.type)}
          <select data-p="type" title="Entry type">${TYPES.map(t => `<option ${t.name === e.type ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
          <span class="spacer"></span>
          ${isEvent && ui.view !== 'board' ? `<button class="icon-btn" data-act="show-board" title="Show on the plot board">${icon('target', 15)}</button>` : ''}
          <button class="icon-btn" data-act="wide" title="${wide ? 'Narrower panel' : 'Wider panel for writing'}">${icon(wide ? 'shrink' : 'expand', 15)}</button>
          <button class="icon-btn" data-act="close" title="Close (Esc)">${icon('x', 15)}</button>
        </div>
        ${cover ? `<div class="ins-banner" style="${bg(cover.file)}" data-lb="${e.images.indexOf(cover)}"></div>` : ''}
        <textarea class="ins-title" rows="1" spellcheck="false" maxlength="120" placeholder="${isEvent ? 'What happens?' : 'Name'}">${esc(e.name)}</textarea>
      </div>
      <div class="ins-body">
        ${isEvent ? `
          <div class="ins-row"><label>When</label><input data-p="event_date" value="${esc(e.event_date)}" placeholder="e.g. Chapter 3, Year 312, the night of the storm"></div>
          <div class="ins-row"><label>Thread</label><div class="swatch-row">
            ${THREAD_COLORS.map(c => `<button class="sw ${e.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" title="Color this plot thread"></button>`).join('')}
            <button class="sw none ${e.color ? '' : 'on'}" data-color="" title="Default color">${icon('x', 11)}</button>
          </div></div>
          ${series.length > 1 ? `<div class="ins-row"><label>Story</label><select data-p="story_id">${series.map(s =>
            `<option value="${s.id}" ${s.id === e.story_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}` : ''}
        <div class="ins-field"><textarea data-p="summary" rows="2" placeholder="${isEvent ? 'What happens in this scene, in a sentence or two' : 'A one-line description'}">${esc(e.summary)}</textarea></div>

        ${isEvent ? this.section('cast', `Who & where <span class="count">${people.length}</span>`,
          `<div class="cast-chips">${people.map(r => `
            <span class="cchip" data-goto="${r.other_id}" title="${esc(r.other_type)}">
              ${avatarHtml(ui.byId.get(r.other_id) || { name: r.other_name, type: r.other_type })}${esc(r.other_name)}
              <button class="x" data-act="del-rel" data-rel="${r.id}" title="Remove from this event">${icon('x', 11)}</button>
            </span>`).join('')}
            <button class="cchip add" data-act="add-cast">${icon('plus', 13)} Add</button>
          </div>
          ${people.length ? '' : '<div class="ins-hint">Drag characters and places from the left onto the card, or use Add.</div>'}`)
        : this.section('appears', `Appears in <span class="count">${plot.length}</span>`,
          plot.map(r => `<a class="ins-event" data-goto="${r.other_id}">${icon('board', 13)}${esc(r.other_name)}</a>`).join('')
          || '<div class="ins-hint">Not in any event yet. Drag them from the left onto an event on the plot board.</div>')}

        ${isEvent ? this.section('plot', `Plot links <span class="count">${plot.length}</span>`,
          plot.map(relRow).join('') || '<div class="ins-hint">Drag the dot on this card\'s edge to another event to connect them.</div>') : ''}

        ${!isEvent ? this.section('connections', `Relationships <span class="count">${people.length}</span>`, `
          ${people.map(relRow).join('') || '<div class="ins-hint">Named relationships such as “sister of” or “rules”.</div>'}
          <div class="rel-add">
            <input id="rel-label" list="rel-labels" placeholder="e.g. sister of">
            <button data-act="add-rel">${icon('plus', 13)} Link to…</button>
          </div>
          <datalist id="rel-labels">${REL_LABELS.map(l => `<option value="${l}">`).join('')}</datalist>`) : ''}

        ${this.section('notes', 'Notes', '<div class="ins-editor"></div>')}

        ${this.section('details', 'Tags & details', `
          <div class="tags-box">${e.tags.map((t, i) => `<span class="chip">#${esc(t)}<span class="x" data-act="del-tag" data-i="${i}">×</span></span>`).join('')}
            <input class="tag-input" placeholder="${e.tags.length ? 'Add tag…' : 'Add a tag and press Enter'}"></div>
          ${e.fields.map((f, i) => `
            <div class="ins-prop" data-i="${i}">
              <input data-fk value="${esc(f.key)}" placeholder="Property">
              <input data-fv value="${esc(f.value)}" placeholder="Empty">
              <button class="x" data-act="del-field" title="Remove">${icon('x', 12)}</button>
            </div>`).join('')}
          <button class="link-btn" data-act="add-field">${icon('plus', 13)} Add property</button>`)}

        ${this.section('images', `Images <span class="count">${e.images.length}</span>`, `
          <div class="gallery">${e.images.map((img, i) => `
            <div class="g-item ${cover && img.id === cover.id ? 'cover' : ''}" style="${bg(img.file)}" data-lb="${i}" title="${esc(img.caption)}">
              <div class="g-actions">
                <button data-act="cover" data-img="${img.id}" title="Use as cover">★</button>
                <button data-act="del-img" data-img="${img.id}" title="Delete image">${icon('x', 11)}</button>
              </div>
            </div>`).join('')}</div>
          <div class="dropzone" data-act="add-images">Drop, paste (Ctrl+V) or click to add images</div>`)}

        ${this.section('backlinks', `Mentioned in <span class="count">${this.backlinks.length}</span>`,
          this.backlinks.map(b => `
            <div class="bl-item" data-goto="${b.id}">
              <div class="bl-name">${dot(b.type)}${esc(b.name)}</div>
              ${b.snippets.map(sn => `<div class="bl-snippet">${snippetHtml(sn, e.name)}</div>`).join('')}
            </div>`).join('') || `<div class="ins-hint">Notes that mention <code>[[${esc(e.name || '…')}]]</code> show up here.</div>`)}

        <button class="danger ins-delete" data-act="delete">${icon('trash', 14)} Delete ${isEvent ? 'event' : esc(e.type.toLowerCase())}</button>
      </div>`;
    this.editor?.destroy();
    this.el.innerHTML = html;
    this.autosizeTitle();
    this.editor = OmniEditor.create($('.ins-editor', this.el), {
      doc: e.notes,
      entries: () => ui.index.filter(x => x.id !== e.id),
      resolve: resolveLink,
      onOpenLink: name => followLink(name),
      onChange: text => {
        const had = !!this.entry.notes.trim();
        this.entry.notes = text;
        queueSave(e.id, { notes: text });
        if (had !== !!text.trim() && ui.views.board) ui.views.board.setNotesFlag(e.id, !!text.trim());
      },
    });
  },

  renderEdge(id) {
    const board = ui.views.board;
    const ed = board && board.edges.find(x => x.id === id);
    if (!ed) return select(null);
    const a = board.byId.get(ed.source_id);
    const b = board.byId.get(ed.target_id);
    this.el.innerHTML = `
      <div class="ins-top">
        <div class="ins-kicker">${icon('link', 14)}<span class="kicker-text">Plot link</span><span class="spacer"></span>
          <button class="icon-btn" data-act="close" title="Close (Esc)">${icon('x', 15)}</button></div>
        <div class="edge-ends">
          <a class="rel-other" data-goto="${a.id}">${esc(a.name || 'Untitled event')}</a>
          <span class="edge-arrow">→</span>
          <a class="rel-other" data-goto="${b.id}">${esc(b.name || 'Untitled event')}</a>
        </div>
      </div>
      <div class="ins-body">
        <div class="ins-field"><label>How are they connected?</label>
          <input class="edge-label-input" value="${esc(ed.label)}" placeholder="e.g. causes, leads to, foreshadows"></div>
        <div class="label-chips">${LINK_LABELS.map(l => `<button class="lchip ${ed.label === l ? 'on' : ''}" data-label="${l}">${l}</button>`).join('')}</div>
        <div class="ins-field"><label>Arrow style</label>
          <div class="style-pick">${ARROW_STYLES.map(s => `
            <button class="${(ed.style || 'curved') === s.key ? 'on' : ''}" data-edge-style="${s.key}" title="${s.hint}">${icon(`arrow-${s.key}`, 18)}<span>${s.label}</span></button>`).join('')}
          </div>
        </div>
        <div class="ins-hint">Drag the arrow (or its round handle) to reshape it, and drag either square end onto any side of a card to move it. Double-click the handle to straighten it out again.</div>
        <div class="ins-actions">
          <button data-act="reset-shape">${icon('arrange', 14)} Reset shape</button>
          <button data-act="style-all" title="Use this arrow style for every connection on the board">${icon(`arrow-${ed.style || 'curved'}`, 14)} Use for all arrows</button>
        </div>
        <div class="ins-actions">
          <button data-act="reverse">${icon('swap', 14)} Reverse direction</button>
          <button class="danger" data-act="del-edge">${icon('trash', 14)} Delete connection</button>
        </div>
      </div>`;
  },

  renderNote(id) {
    const board = ui.views.board;
    const n = board && board.notes.find(x => x.id === id);
    if (!n) return select(null);
    this.el.innerHTML = `
      <div class="ins-top">
        <div class="ins-kicker">${icon('sticky', 14)}<span class="kicker-text">Sticky note</span><span class="spacer"></span>
          <button class="icon-btn" data-act="close" title="Close (Esc)">${icon('x', 15)}</button></div>
      </div>
      <div class="ins-body">
        <div class="ins-hint">Type right on the note. Sticky notes are for loose ideas; turn one into an event when it becomes part of the plot.</div>
        <div class="ins-row"><label>Color</label><div class="swatch-row">
          ${Object.entries(NOTE_COLORS).map(([k, c]) => `<button class="sw ${n.color === k ? 'on' : ''}" data-note-color="${k}" style="background:${c}" title="${k}"></button>`).join('')}
        </div></div>
        <div class="ins-actions">
          <button data-act="note-to-event">${icon('board', 14)} Turn into event</button>
          <button class="danger" data-act="del-note">${icon('trash', 14)} Delete note</button>
        </div>
      </div>`;
  },

  focusTitle() {
    const go = () => {
      const t = $('.ins-title', this.el);
      if (!t) return false;
      t.focus();
      t.select();
      return true;
    };
    // The panel may still be loading the entry.
    if (!go()) setTimeout(go, 150);
  },

  focusEdgeLabel() {
    setTimeout(() => { const i = $('.edge-label-input', this.el); if (i) { i.focus(); i.select(); } }, 30);
  },

  autosizeTitle() {
    const t = $('.ins-title', this.el);
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  },

  // ---------------------------------------------------------------- saving

  async commitTitle() {
    const e = this.entry;
    const name = (this.draftName ?? e.name).replace(/\s+/g, ' ').trim();
    this.draftName = null;
    if (name === e.name) return;
    await flushSaves();
    await api.updateEntry(e.id, { name });
    e.name = name;
    await dataChanged();
  },

  async saveNow(patch) {
    Object.assign(this.entry, patch);
    queueSave(this.entry.id, patch);
    await flushSaves();
  },

  async saveEdge(patch, id = ui.selection.id) {
    await api.updateRelation(id, patch);
    const ed = ui.views.board.edges.find(x => x.id === id);
    if (ed) Object.assign(ed, patch);
    ui.views.board.drawEdges();
  },

  // ---------------------------------------------------------------- events

  onInput(e) {
    const t = e.target;
    if (t.classList.contains('ins-title')) {
      this.draftName = t.value;
      this.autosizeTitle();
      return;
    }
    if (t.classList.contains('edge-label-input')) {
      this.saveEdgeLabel(ui.selection.id, t.value.trim());
      $$('.lchip', this.el).forEach(c => c.classList.toggle('on', c.dataset.label === t.value.trim()));
      return;
    }
    const p = t.dataset.p;
    if (p === 'summary' || p === 'event_date') {
      this.entry[p] = t.value;
      queueSave(this.entry.id, { [p]: t.value });
      return;
    }
    const row = t.closest('.ins-prop');
    if (row) {
      const f = this.entry.fields[Number(row.dataset.i)];
      if ('fk' in t.dataset) f.key = t.value; else f.value = t.value;
      queueSave(this.entry.id, { fields: this.entry.fields });
    }
  },

  // Remembers which connection was being edited, in case the selection changes before it saves.
  saveEdgeLabel: debounce((id, label) => inspector.saveEdge({ label }, id), 300),

  async onChange(e) {
    const t = e.target;
    if (t.classList.contains('ins-title')) return this.commitTitle();
    if (t.dataset.p === 'type') {
      await this.saveNow({ type: t.value });
      this.reload();
    } else if (t.dataset.p === 'story_id') {
      await this.saveNow({ story_id: t.value });
    }
  },

  async onKeydown(e) {
    const t = e.target;
    if (t.classList.contains('ins-title') && e.key === 'Enter') {
      e.preventDefault();
      t.blur(); // "change" saves it
      return;
    }
    if (t.classList.contains('ins-title') && e.key === 'Escape') {
      e.stopPropagation();
      t.value = this.entry.name;
      this.draftName = null;
      t.blur();
      return;
    }
    if (t.classList.contains('edge-label-input') && e.key === 'Enter') return t.blur();
    if (t.classList.contains('tag-input')) {
      if ((e.key === 'Enter' || e.key === ',') && t.value.trim()) {
        e.preventDefault();
        const tag = t.value.trim().replace(/^#/, '').replace(/,$/, '');
        if (tag && !this.entry.tags.includes(tag)) await this.saveNow({ tags: [...this.entry.tags, tag] });
        await this.reload();
        $('.tag-input', this.el).focus();
      } else if (e.key === 'Backspace' && !t.value && this.entry.tags.length) {
        await this.saveNow({ tags: this.entry.tags.slice(0, -1) });
        await this.reload();
        $('.tag-input', this.el).focus();
      }
    }
  },

  async onClick(e) {
    const sec = e.target.closest('[data-sec]');
    if (sec && !e.target.closest('[data-act]')) {
      const closed = new Set(store.get('omni.insClosed', []));
      closed.has(sec.dataset.sec) ? closed.delete(sec.dataset.sec) : closed.add(sec.dataset.sec);
      store.set('omni.insClosed', [...closed]);
      sec.parentElement.classList.toggle('closed');
      return;
    }
    const goto = e.target.closest('[data-goto]');
    if (goto && !e.target.closest('[data-act]')) return openEntry(Number(goto.dataset.goto));
    const sw = e.target.closest('[data-color]');
    if (sw) {
      await this.saveNow({ color: sw.dataset.color });
      $$('[data-color]', this.el).forEach(b => b.classList.toggle('on', b === sw));
      return;
    }
    const nc = e.target.closest('[data-note-color]');
    if (nc) return ui.views.board.setNoteColor(ui.selection.id, nc.dataset.noteColor);
    const es = e.target.closest('[data-edge-style]');
    if (es) {
      await ui.views.board.setEdge(ui.selection.id, { style: es.dataset.edgeStyle, bend_x: 0, bend_y: 0 });
      ui.views.board.setArrowStyle(es.dataset.edgeStyle); // new arrows follow the last style picked
      return this.render();
    }
    const lchip = e.target.closest('[data-label]');
    if (lchip) {
      const input = $('.edge-label-input', this.el);
      input.value = lchip.dataset.label;
      $$('.lchip', this.el).forEach(c => c.classList.toggle('on', c === lchip));
      return this.saveEdge({ label: lchip.dataset.label });
    }
    const lb = e.target.closest('[data-lb]');
    const act = e.target.closest('[data-act]');
    if (!act && lb) return openLightbox(this.entry.images, Number(lb.dataset.lb));
    if (!act) return;
    const id = this.entry && this.entry.id;
    switch (act.dataset.act) {
      case 'close': return select(null);
      case 'wide':
        store.set('omni.inspectorWide', !store.get('omni.inspectorWide', false));
        this.applyWidth();
        return this.reload();
      case 'show-board':
        await switchView('board');
        return ui.views.board.reveal(`e${id}`);
      case 'add-cast': return this.pickCast();
      case 'add-rel': return this.pickRelation();
      case 'del-rel':
        await api.deleteRelation(Number(act.dataset.rel));
        await this.reload();
        return dataChanged();
      case 'add-field':
        this.entry.fields.push({ key: '', value: '' });
        await this.saveNow({ fields: this.entry.fields });
        await this.reload();
        return $$('.ins-prop [data-fk]', this.el).pop()?.focus();
      case 'del-field':
        this.entry.fields.splice(Number(act.closest('.ins-prop').dataset.i), 1);
        await this.saveNow({ fields: this.entry.fields });
        return this.reload();
      case 'del-tag':
        await this.saveNow({ tags: this.entry.tags.filter((_, i) => i !== Number(act.dataset.i)) });
        return this.reload();
      case 'add-images':
        if (await api.pickImages(id)) await this.imagesChanged();
        return;
      case 'cover':
        await api.updateEntry(id, { cover_id: Number(act.dataset.img) });
        return this.imagesChanged();
      case 'del-img':
        if (!(await confirmBox('Delete image?', 'The image file is removed from the library.'))) return;
        await api.deleteImage(Number(act.dataset.img));
        return this.imagesChanged();
      case 'delete': return deleteEntry(id);
      case 'reverse': {
        const ed = ui.views.board.edges.find(x => x.id === ui.selection.id);
        await api.deleteRelation(ed.id);
        const nid = await api.addRelation({ source_id: ed.target_id, target_id: ed.source_id, label: ed.label });
        await ui.views.board.refresh();
        return select({ kind: 'edge', id: nid });
      }
      case 'del-edge': return ui.views.board.deleteEdge(ui.selection.id);
      case 'reset-shape':
        return ui.views.board.setEdge(ui.selection.id, { bend_x: 0, bend_y: 0, s_side: '', t_side: '' });
      case 'style-all': {
        const board = ui.views.board;
        const style = board.edges.find(x => x.id === ui.selection.id).style || 'curved';
        for (const ed of board.edges) await board.setEdge(ed.id, { style, bend_x: 0, bend_y: 0 });
        board.setArrowStyle(style);
        return toast(`All ${board.edges.length} connections are now ${style} arrows`);
      }
      case 'note-to-event': return ui.views.board.noteToEvent(ui.selection.id);
      case 'del-note': return ui.views.board.deleteNote(ui.selection.id);
    }
  },

  async imagesChanged() {
    await this.reload();
    await dataChanged();
  },

  // Adds a character, place etc. to the selected event.
  pickCast() {
    const ev = this.entry;
    const inScene = new Set(ev.relations.map(r => r.other_id));
    openPicker({
      placeholder: `Add someone or something to “${ev.name || 'this event'}”…`,
      items: q => {
        const hits = ui.index
          .filter(x => x.type !== 'Event' && !inScene.has(x.id))
          .map(x => ({ x, score: fuzzy(q, x.name) }))
          .filter(h => h.score != null)
          .sort((a, b) => b.score - a.score || a.x.name.localeCompare(b.x.name))
          .slice(0, 50)
          .map(({ x }) => ({ label: highlight(x.name, q), detail: esc(x.type), icon: dot(x.type), run: () => ui.views.board.addParticipant(ev.id, x.id) }));
        if (q && !resolveLink(q)) {
          hits.push({ label: `Create “${esc(q)}”`, detail: 'new', icon: icon('plus', 15), run: async () => {
            const type = await pickType(`Create “${q}” as…`, { exclude: 'Event' });
            if (!type) return;
            const nid = await createEntry(type, q);
            await ui.views.board.addParticipant(ev.id, nid);
          } });
        }
        return hits;
      },
    });
  },

  // Adds a named relationship from the selected (non-event) entry to another one.
  pickRelation() {
    const e = this.entry;
    const label = $('#rel-label', this.el).value.trim();
    openPicker({
      placeholder: label ? `${e.name} — ${label} → …` : `Link ${e.name} to…`,
      items: q => ui.index
        .filter(x => x.id !== e.id && x.type !== 'Event')
        .map(x => ({ x, score: fuzzy(q, x.name) }))
        .filter(h => h.score != null)
        .sort((a, b) => b.score - a.score || a.x.name.localeCompare(b.x.name))
        .slice(0, 50)
        .map(({ x }) => ({ label: highlight(x.name, q), detail: esc(x.type), icon: dot(x.type), run: async () => {
          await api.addRelation({ source_id: e.id, target_id: x.id, label });
          await this.reload();
          dataChanged();
        } })),
    });
  },
};

const REL_LABELS = ['sister of', 'brother of', 'parent of', 'child of', 'mentor of', 'rival of', 'loves', 'serves', 'rules', 'lives in', 'member of', 'owns'];

const coverOf = e => e.images.find(i => i.id === e.cover_id) || e.images[0] || null;

function avatarHtml(p) {
  return `<span class="av" style="--c:${typeOf(p.type).color};${bg(p.cover)}">${p.cover ? '' : esc((p.name[0] || '?').toUpperCase())}</span>`;
}

// A backlink snippet with [[links]] shown as text and the link to this entry highlighted.
function snippetHtml(line, name) {
  const target = name.trim().toLowerCase();
  return esc(line.replace(/^[#>*\-\s]+/, '')).replace(/\[\[([^\[\]\n|]+)(\|([^\[\]\n]+))?\]\]/g, (m, n, _a, alias) =>
    `<span class="${n.trim().toLowerCase() === target ? 'bl-hit' : 'bl-link'}">${alias || n}</span>`);
}
