/* global api, cytoscape */
'use strict';

// Secondary views next to the plot board: the codex (character & world cards), the relationship web,
// and the timeline. Clicking anything selects it into the details panel.

const viewHeader = (title, iconName, sub, tools = '') => `
  <div class="view-header">
    <div class="vh-title">${icon(iconName)}<span>${title}</span>${sub ? `<span class="vh-sub">${sub}</span>` : ''}</div>
    <div class="vh-tools">${tools}</div>
  </div>`;

const matchesQuery = (e, q) => !q || [e.name, e.summary, ...(e.tags || []), ...(e.fields || []).map(f => `${f.key} ${f.value}`)]
  .join(' ').toLowerCase().includes(q.toLowerCase());

const emptyHtml = (title, text) => `<div class="view-empty"><h2>${title}</h2><p>${text}</p></div>`;

// ---------------------------------------------------------------- codex

class CodexView {
  constructor() {
    this.kind = 'codex';
    this.type = null;
    this.tag = null;
    this.q = '';
    this.el = document.createElement('section');
    this.el.className = 'view codex-view';
    this.el.innerHTML = `${viewHeader('Codex', 'book', 'Characters, places and lore',
      '<input class="view-search" type="search" placeholder="Search names, notes, tags…">')}
      <div class="lib-filters"></div><div class="view-body"></div>`;
    const search = $('.view-search', this.el);
    search.addEventListener('input', debounce(() => { this.q = search.value.trim(); this.refresh(); }, 200));
    this.el.addEventListener('click', e => {
      const f = e.target.closest('[data-type]');
      if (f) { this.type = f.dataset.type || null; return this.refresh(); }
      const tg = e.target.closest('[data-tag]');
      if (tg) { this.tag = this.tag === tg.dataset.tag ? null : tg.dataset.tag; return this.refresh(); }
      const add = e.target.closest('[data-add]');
      if (add) return newEntry(add.dataset.add || null);
      const card = e.target.closest('[data-open]');
      if (card) select({ kind: 'entry', id: Number(card.dataset.open) });
    });
  }

  onSelect(sel) {
    $$('.card', this.el).forEach(c => c.classList.toggle('selected', !!sel && sel.kind === 'entry' && Number(c.dataset.open) === sel.id));
  }

  async refresh() {
    const entries = (await api.listEntries({ type: this.type, q: this.q, tag: this.tag })).filter(e => e.type !== 'Event');
    const world = ui.index.filter(e => e.type !== 'Event');
    const counts = Object.fromEntries(TYPES.map(t => [t.name, world.filter(e => e.type === t.name).length]));
    const tags = [...new Set(world.flatMap(e => e.tags || []))].sort();
    $('.lib-filters', this.el).innerHTML = `
      <button class="filter-chip ${this.type ? '' : 'on'}" data-type="">All <span>${world.length}</span></button>
      ${TYPES.filter(t => t.name !== 'Event' && counts[t.name]).map(t =>
        `<button class="filter-chip ${this.type === t.name ? 'on' : ''}" data-type="${t.name}">${dot(t.name)}${t.plural} <span>${counts[t.name]}</span></button>`).join('')}
      ${tags.length ? '<span class="filter-sep"></span>' : ''}
      ${tags.map(t => `<button class="filter-chip tag ${this.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}`;
    const body = $('.view-body', this.el);
    if (!entries.length) {
      body.innerHTML = world.length
        ? emptyHtml('Nothing matches', 'Try another search or filter.')
        : `${emptyHtml('Your codex is empty', 'Characters, locations, factions, items, creatures and lore live here, each with images, notes and relationships.')}
           <div class="view-empty-actions">${TYPES.filter(t => t.name !== 'Event').slice(0, 3).map(t =>
             `<button data-add="${t.name}">${dot(t.name)} New ${t.name.toLowerCase()}</button>`).join('')}</div>`;
      return;
    }
    body.innerHTML = `<div class="grid">${entries.map(e => `
      <div class="card" data-open="${e.id}">
        <div class="thumb" style="${bg(e.cover)}">
          ${e.cover ? '' : `<div class="initial" style="color:${typeOf(e.type).color}">${esc((e.name.charAt(0) || '?').toUpperCase())}</div>`}
          ${e.image_count > 1 ? `<span class="imgcount">${e.image_count}</span>` : ''}
        </div>
        <div class="body">
          <div class="name">${esc(e.name) || '<em>Unnamed</em>'}</div>
          <div class="badge">${dot(e.type)}${esc(e.type)}</div>
          ${e.summary ? `<div class="summary">${esc(e.summary)}</div>` : ''}
        </div>
      </div>`).join('')}</div>`;
    this.onSelect(ui.selection);
  }
}

// ---------------------------------------------------------------- relationship web

const WEB_STYLE = [
  { selector: 'node', style: {
    'background-color': 'data(color)', shape: 'data(shape)', label: 'data(label)', width: 44, height: 44,
    'border-width': 3, 'border-color': 'data(color)', color: '#dcdde2', 'font-size': 11,
    'text-valign': 'bottom', 'text-margin-y': 6, 'text-outline-color': '#17181c', 'text-outline-width': 2,
  } },
  { selector: 'node[type = "Character"]', style: { width: 56, height: 56 } },
  { selector: 'node.img', style: {
    'background-image': 'data(img)', 'background-fit': 'cover', 'background-clip': 'node', 'background-image-crossorigin': 'null',
  } },
  { selector: 'edge', style: {
    width: 1.5, 'line-color': '#4a4d57', 'target-arrow-color': '#4a4d57', 'target-arrow-shape': 'triangle',
    'curve-style': 'bezier', label: 'data(label)', 'font-size': 10, color: '#9a9ca6', 'text-rotation': 'autorotate',
    'text-background-color': '#17181c', 'text-background-opacity': 1, 'text-background-padding': 2,
  } },
  { selector: 'edge.wikilink', style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 4], width: 1, 'target-arrow-shape': 'vee', 'arrow-scale': 0.7, label: '' } },
  { selector: 'node:selected', style: { 'border-color': '#ffffff' } },
  { selector: '.linking', style: { 'border-color': '#ffffff', 'border-width': 4, 'border-style': 'dashed' } },
  { selector: '.dim', style: { opacity: 0.15 } },
  { selector: '.faded', style: { opacity: 0.18 } },
  { selector: 'edge.hl', style: { 'line-color': 'data(hl)', 'target-arrow-color': 'data(hl)', color: '#e7e7ea' } },
];

class WebView {
  constructor() {
    this.kind = 'web';
    this.cy = null;
    this.linkSource = null;
    this.showLinks = store.get('omni.webLinks', true);
    this.showEvents = store.get('omni.webEvents', false);
    this.el = document.createElement('section');
    this.el.className = 'view web-view';
    this.el.innerHTML = `${viewHeader('Relationship web', 'graph', 'Who is connected to whom', `
      <input class="view-search" type="search" placeholder="Highlight…">
      <label class="check"><input type="checkbox" data-w="events" ${this.showEvents ? 'checked' : ''}> Events</label>
      <label class="check"><input type="checkbox" data-w="links" ${this.showLinks ? 'checked' : ''}> [[Links]]</label>
      <button data-w="layout">${icon('arrange', 15)} Re-arrange</button><button data-w="fit">${icon('fit', 15)} Fit</button>`)}
      <div class="view-hint">Drag to arrange · click to see details · Shift+click two nodes to give them a relationship</div>
      <div class="view-body"><div class="cy"></div></div>`;
    this.el.addEventListener('click', e => {
      const b = e.target.closest('[data-w]');
      if (!b || !this.cy || b.tagName === 'INPUT') return;
      if (b.dataset.w === 'layout') this.layout();
      if (b.dataset.w === 'fit') this.cy.fit(undefined, 60);
    });
    this.el.addEventListener('change', e => {
      const w = e.target.dataset.w;
      if (w === 'links') { this.showLinks = e.target.checked; store.set('omni.webLinks', this.showLinks); }
      if (w === 'events') { this.showEvents = e.target.checked; store.set('omni.webEvents', this.showEvents); }
      if (w) this.refresh();
    });
    const search = $('.view-search', this.el);
    search.addEventListener('input', debounce(() => this.applySearch(search.value.trim()), 150));
    new ResizeObserver(() => this.cy && this.cy.resize()).observe($('.view-body', this.el));
  }

  onSelect(sel) {
    if (!this.cy) return;
    this.cy.$(':selected').unselect();
    if (sel && sel.kind === 'entry') this.cy.$(`#n${sel.id}`).select();
  }

  applySearch(q) {
    if (this.cy) this.cy.nodes().forEach(n => n.toggleClass('dim', !!q && !matchesQuery(n.data('entry'), q)));
  }

  savePositions(nodes) {
    api.saveGraphPositions(nodes.map(n => ({ id: n.data('eid'), x: n.position('x'), y: n.position('y') })));
  }

  layout() {
    const l = this.cy.layout({ name: 'cose', animate: false, nodeRepulsion: () => 60000, nodeOverlap: 40, idealEdgeLength: () => 170, componentSpacing: 120, padding: 60 });
    l.one('layoutstop', () => { this.savePositions(this.cy.nodes()); this.cy.fit(undefined, 60); });
    l.run();
  }

  async refresh() {
    const { nodes: all, edges: allEdges, links: allLinks } = await api.graph();
    const nodes = all.filter(n => this.showEvents || n.type !== 'Event');
    const ids = new Set(nodes.map(n => n.id));
    const edges = allEdges.filter(e => ids.has(e.source_id) && ids.has(e.target_id));
    const links = this.showLinks ? allLinks.filter(e => ids.has(e.source_id) && ids.has(e.target_id)) : [];
    const keep = this.cy ? { zoom: this.cy.zoom(), pan: this.cy.pan() } : null;
    if (this.cy) this.cy.destroy();
    this.cy = null;
    const host = $('.cy', this.el);
    if (!nodes.length) {
      host.innerHTML = emptyHtml('No one here yet', 'Characters, places and the relationships between them appear here.');
      return;
    }
    host.innerHTML = '';
    const placed = new Map(nodes.filter(n => n.graph_x != null).map(n => [n.id, { x: n.graph_x, y: n.graph_y }]));
    const near = [...edges, ...links];
    // New nodes go next to an already placed neighbor, so adding one entry never scrambles the layout.
    const positionFor = n => {
      if (placed.has(n.id)) return placed.get(n.id);
      const e = near.find(x => (x.source_id === n.id && placed.has(x.target_id)) || (x.target_id === n.id && placed.has(x.source_id)));
      const a = e ? placed.get(e.source_id === n.id ? e.target_id : e.source_id) : [...placed.values()][0] || { x: 0, y: 0 };
      return { x: a.x + (Math.random() - 0.5) * 220, y: a.y + (Math.random() - 0.5) * 220 };
    };
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c9a24a';
    this.cy = cytoscape({
      container: host,
      minZoom: 0.15,
      maxZoom: 3,
      style: WEB_STYLE,
      layout: { name: 'preset' },
      elements: [
        ...nodes.map(n => {
          const t = typeOf(n.type);
          return {
            data: { id: `n${n.id}`, eid: n.id, label: n.name, type: n.type, color: t.color, shape: t.shape, img: n.cover ? imgUrl(n.cover) : undefined, entry: n },
            position: placed.size ? positionFor(n) : undefined,
            classes: n.cover ? 'img' : '',
          };
        }),
        ...edges.map(e => ({ data: { id: `e${e.id}`, source: `n${e.source_id}`, target: `n${e.target_id}`, label: e.label === 'involves' ? '' : e.label, hl: accent } })),
        ...links.map((l, i) => ({ data: { id: `l${i}`, source: `n${l.source_id}`, target: `n${l.target_id}`, label: '', hl: accent }, classes: 'wikilink' })),
      ],
    });
    if (!placed.size) this.layout();
    else if (placed.size < nodes.length) this.savePositions(this.cy.nodes().filter(n => !placed.has(n.data('eid'))));
    if (keep) { this.cy.zoom(keep.zoom); this.cy.pan(keep.pan); } else this.cy.fit(undefined, 60);
    this.applySearch($('.view-search', this.el).value.trim());
    this.onSelect(ui.selection);

    this.cy.on('tap', 'node', evt => {
      if (evt.originalEvent.shiftKey) return this.linkTap(evt.target);
      select({ kind: 'entry', id: evt.target.data('eid') });
    });
    this.cy.on('tap', evt => {
      if (evt.target !== this.cy) return;
      if (this.linkSource) { this.linkSource.removeClass('linking'); this.linkSource = null; } else select(null);
    });
    this.cy.on('dragfree', 'node', evt => this.savePositions(evt.target.union(this.cy.$(':selected'))));
    this.cy.on('mouseover', 'node', evt => {
      const hood = evt.target.closedNeighborhood();
      this.cy.elements().not(hood).addClass('faded');
      hood.edges().addClass('hl');
    });
    this.cy.on('mouseout', 'node', () => this.cy.elements().removeClass('faded hl'));
  }

  async linkTap(node) {
    if (!this.linkSource) { this.linkSource = node.addClass('linking'); return; }
    const source = this.linkSource;
    source.removeClass('linking');
    this.linkSource = null;
    if (source.same(node)) return;
    const res = await modal(`${source.data('label')} → ${node.data('label')}`,
      `<input name="label" list="web-labels" placeholder="How are they related? e.g. mentor of, lives in">
       <datalist id="web-labels">${REL_LABELS.map(l => `<option value="${l}">`).join('')}</datalist>`, { ok: 'Connect' });
    if (!res) return;
    await api.addRelation({ source_id: source.data('eid'), target_id: node.data('eid'), label: res.label.trim() });
    await dataChanged();
    inspector.reload();
  }
}

// ---------------------------------------------------------------- timeline

class TimelineView {
  constructor() {
    this.kind = 'timeline';
    this.scope = 'story'; // in a series: this story only, or the whole series
    this.focus = null; // only events involving this entry
    this.el = document.createElement('section');
    this.el.className = 'view timeline-view';
    this.el.innerHTML = `${viewHeader('Timeline', 'timeline', 'Events in story order', '<span class="tl-tools"></span>')}<div class="view-body"></div>`;
    this.el.addEventListener('click', e => {
      const t = e.target.closest('[data-open]');
      if (t) select({ kind: 'entry', id: Number(t.dataset.open) });
    });
  }

  onSelect(sel) {
    $$('.tl-card', this.el).forEach(c => c.classList.toggle('selected', !!sel && sel.kind === 'entry' && Number(c.dataset.open) === sel.id));
  }

  async refresh() {
    const { nodes, edges } = await api.graph();
    const byId = new Map(nodes.map(n => [n.id, n]));
    const participants = ev => edges
      .filter(e => e.source_id === ev.id || e.target_id === ev.id)
      .map(e => byId.get(e.source_id === ev.id ? e.target_id : e.source_id))
      .filter(p => p.type !== 'Event');
    const series = ui.world.series;
    const multi = series.length > 1;
    const seriesMode = multi && this.scope === 'series';
    const rank = new Map(series.map((s, i) => [s.id, i]));
    const storyRank = ev => (rank.has(ev.story_id) ? rank.get(ev.story_id) : series.length);
    const all = nodes
      .filter(n => n.type === 'Event' && (!multi || seriesMode || n.story_id === ui.world.id))
      .sort((a, b) => storyRank(a) - storyRank(b) || a.event_order - b.event_order || a.id - b.id);
    const shown = all.filter(ev => !this.focus || participants(ev).some(p => p.id === this.focus));

    const tools = $('.tl-tools', this.el);
    tools.innerHTML = `
      ${multi ? `<select data-tl="scope"><option value="story">This story</option><option value="series" ${seriesMode ? 'selected' : ''}>Whole series</option></select>` : ''}
      <select data-tl="focus"><option value="">All events</option>
        ${nodes.filter(n => n.type !== 'Event').map(n => `<option value="${n.id}" ${n.id === this.focus ? 'selected' : ''}>Involving ${esc(n.name)}</option>`).join('')}
      </select>`;
    tools.onchange = e => {
      if (e.target.dataset.tl === 'scope') this.scope = e.target.value;
      if (e.target.dataset.tl === 'focus') this.focus = Number(e.target.value) || null;
      this.refresh();
    };

    const body = $('.view-body', this.el);
    if (!shown.length) {
      body.innerHTML = all.length
        ? emptyHtml('No events involve them', 'Pick “All events” to see the whole timeline.')
        : emptyHtml('No events yet', 'Events you add on the plot board appear here in story order. Drag them here to change the order.');
      return;
    }
    let lastStory;
    const header = ev => {
      if (!seriesMode || ev.story_id === lastStory) return '';
      lastStory = ev.story_id;
      const s = series.find(x => x.id === ev.story_id);
      return `<div class="tl-story">${s ? `${esc(s.name)}${s.id === ui.world.id ? ' <span>· this story</span>' : ''}` : 'Unassigned'}</div>`;
    };
    body.innerHTML = `<div class="timeline">${shown.map(ev => `${header(ev)}
      <div class="tl-item" draggable="${!seriesMode}" data-id="${ev.id}">
        <div class="tl-marker"><span style="background:${ev.color || 'var(--accent)'}"></span></div>
        <div class="tl-card" data-open="${ev.id}">
          ${seriesMode ? '' : '<span class="tl-handle" title="Drag to reorder">⋮⋮</span>'}
          ${ev.cover ? `<div class="tl-thumb" style="${bg(ev.cover)}"></div>` : ''}
          <div style="flex:1;min-width:0">
            ${ev.event_date ? `<div class="tl-date">${esc(ev.event_date)}</div>` : ''}
            <div class="tl-name">${esc(ev.name) || '<em>Untitled event</em>'}</div>
            ${ev.summary ? `<div class="tl-summary">${esc(ev.summary)}</div>` : ''}
            <div class="chips">${participants(ev).map(p => `<span class="chip" data-open="${p.id}">${dot(p.type)}${esc(p.name)}</span>`).join('')}</div>
          </div>
        </div>
      </div>`).join('')}</div>`;
    this.onSelect(ui.selection);

    let dragId = null;
    const items = $$('.tl-item', body);
    const clear = () => items.forEach(i => i.classList.remove('drop-before', 'dragging'));
    items.forEach(item => {
      item.ondragstart = e => { dragId = Number(item.dataset.id); item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
      item.ondragend = clear;
      item.ondragover = e => {
        if (dragId == null) return;
        e.preventDefault();
        e.stopPropagation();
        items.forEach(i => i.classList.remove('drop-before'));
        item.classList.add('drop-before');
      };
      item.ondrop = async e => {
        e.preventDefault();
        e.stopPropagation();
        const targetId = Number(item.dataset.id);
        if (dragId == null || dragId === targetId) return clear();
        const order = all.map(ev => ev.id).filter(id => id !== dragId);
        order.splice(order.indexOf(targetId), 0, dragId);
        dragId = null;
        await api.reorderTimeline(order);
        this.refresh();
      };
    });
  }
}
