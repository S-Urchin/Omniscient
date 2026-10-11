/* global api */
'use strict';

// The plot board: event cards and sticky notes on a pannable, zoomable canvas.
// Dragging from a card's handle connects it to another event (or creates the next event).

const NOTE_COLORS = { yellow: '#e0bf57', blue: '#5b9fe2', pink: '#e2659a', green: '#62bd84', purple: '#a57be0' };
const THREAD_COLORS = ['#d4823c', '#c9a24a', '#b9584e', '#c0577f', '#a070b8', '#7a7fd1', '#4f86c6', '#4f9d8a', '#8bab4f', '#8a8f99'];
const LINK_LABELS = ['leads to', 'causes', 'foreshadows', 'meanwhile', 'flashback to', 'resolves', 'complicates'];
const ARROW_STYLES = [
  { key: 'elbow', label: 'Elbow', hint: 'Right angles' },
  { key: 'straight', label: 'Straight', hint: 'Straight line; drag it to add a sharp bend' },
  { key: 'curved', label: 'Curved', hint: 'Smooth curve' },
];
const SIDE_NORMAL = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2;

class PlotBoard {
  constructor() {
    this.kind = 'board';
    this.events = [];
    this.notes = [];
    this.edges = [];
    this.participants = new Map(); // event id → entries involved in it
    this.view = store.get(`omni.board.${ui.world.id}`, { x: 120, y: 90, z: 1 });
    this.el = document.createElement('section');
    this.el.className = 'view board-view';
    this.el.innerHTML = `
      <div class="view-header">
        <div class="vh-title">${icon('board')}<span>Plot board</span></div>
        <div class="vh-tools">
          <button class="primary" data-b="event" title="Add an event (or double-click the board)">${icon('plus', 15)} Event</button>
          <button data-b="note" title="Add a sticky note">${icon('sticky', 15)} Sticky note</button>
          <span class="vh-divider"></span>
          <div class="seg-mini" title="Arrow style for new connections">${ARROW_STYLES.map(s =>
            `<button data-arrow="${s.key}" title="New connections: ${s.label.toLowerCase()} (${s.hint.toLowerCase()})">${icon(`arrow-${s.key}`, 15)}</button>`).join('')}</div>
          <span class="vh-divider"></span>
          <button data-b="arrange" title="Lay events out left to right, following their connections">${icon('arrange', 15)} Arrange</button>
          <button data-b="fit" title="Fit everything in view">${icon('fit', 15)} Fit</button>
          <div class="zoom"><button data-b="out" title="Zoom out">−</button><span class="zoom-pct"></span><button data-b="in" title="Zoom in">+</button></div>
        </div>
      </div>
      <div class="board-viewport">
        <div class="board-world">
          <svg class="board-edges" width="1" height="1">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6b6e78"/></marker>
              <marker id="arr-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker>
            </defs>
            <g class="edges"></g>
            <path class="temp-edge hidden" marker-end="url(#arr-sel)"/>
          </svg>
          <div class="board-labels"></div>
          <div class="board-cards"></div>
          <div class="board-handles"></div>
        </div>
        <div class="board-hint hidden">
          <h2>Start plotting</h2>
          <p>Double-click anywhere to add an event. Drag the dot on a card's right edge to the next event to connect them, or into empty space to create the next one.</p>
          <p>Drag characters and places from the left onto an event to put them in the scene.</p>
        </div>
      </div>`;
    this.vp = $('.board-viewport', this.el);
    this.world = $('.board-world', this.el);
    this.cards = $('.board-cards', this.el);
    this.labels = $('.board-labels', this.el);
    this.edgeLayer = $('.edges', this.el);
    this.temp = $('.temp-edge', this.el);
    this.handles = $('.board-handles', this.el);
    this.arrowStyle = store.get('omni.arrowStyle', 'elbow');
    this.override = null; // an arrow end being dragged: { id, which, box, side }
    this.saveView = debounce(() => store.set(`omni.board.${ui.world.id}`, this.view), 300);
    this.saveNoteText = debounce((id, text) => api.updateBoardNote(id, { text }), 400);
    this.bind();
    this.applyView();
    this.markArrowStyle();
  }

  // ---------------------------------------------------------------- data

  async refresh() {
    const [{ nodes, edges }, notes] = await Promise.all([api.graph(), api.boardNotes()]);
    const multi = ui.world.series.length > 1;
    this.byId = new Map(nodes.map(n => [n.id, n]));
    this.events = nodes.filter(n => n.type === 'Event' && (!multi || n.story_id === ui.world.id));
    const onBoard = new Set(this.events.map(e => e.id));
    this.edges = edges.filter(e => onBoard.has(e.source_id) && onBoard.has(e.target_id));
    this.participants = new Map(this.events.map(e => [e.id, []]));
    for (const r of edges) {
      for (const [ev, other] of [[r.source_id, r.target_id], [r.target_id, r.source_id]]) {
        const o = this.byId.get(other);
        if (onBoard.has(ev) && o && o.type !== 'Event' && !this.participants.get(ev).includes(o)) this.participants.get(ev).push(o);
      }
    }
    this.notes = notes;
    this.placeUnplaced();
    this.render();
  }

  // Events that have never been on the board are lined up to the right of the existing ones.
  placeUnplaced() {
    const unplaced = this.events.filter(e => e.board_x == null).sort((a, b) => a.event_order - b.event_order || a.id - b.id);
    if (!unplaced.length) return;
    const placed = this.events.filter(e => e.board_x != null);
    const x0 = placed.length ? Math.max(...placed.map(e => e.board_x)) + 320 : 0;
    const y0 = placed.length ? Math.min(...placed.map(e => e.board_y)) : 0;
    unplaced.forEach((e, i) => { e.board_x = x0 + i * 300; e.board_y = y0; });
    api.saveBoardPositions(unplaced.map(e => ({ id: e.id, x: e.board_x, y: e.board_y })));
  }

  show() { this.refresh(); }
  invalidate() { if (ui.view === this.kind) this.refresh(); }

  // ---------------------------------------------------------------- rendering

  avatar(p) {
    return `<span class="pc-av" title="${esc(p.name)}" style="--c:${typeOf(p.type).color};${bg(p.cover)}">${p.cover ? '' : esc((p.name[0] || '?').toUpperCase())}</span>`;
  }

  cardHtml(e) {
    const cast = this.participants.get(e.id) || [];
    return `<div class="pcard ev" data-ev="${e.id}" style="left:${e.board_x}px;top:${e.board_y}px;--c:${e.color || typeOf('Event').color}">
      ${e.cover ? `<div class="pc-thumb" style="${bg(e.cover)}"></div>` : ''}
      <div class="pc-body">
        ${e.event_date ? `<div class="pc-when">${esc(e.event_date)}</div>` : ''}
        <div class="pc-title">${esc(e.name) || '<em>Untitled event</em>'}</div>
        ${e.summary ? `<div class="pc-summary">${esc(e.summary)}</div>` : ''}
        ${cast.length ? `<div class="pc-cast">${cast.slice(0, 7).map(p => this.avatar(p)).join('')}${cast.length > 7 ? `<span class="pc-more">+${cast.length - 7}</span>` : ''}</div>` : ''}
      </div>
      <span class="pc-flag ${e.notes_len ? '' : 'hidden'}" title="Has notes">${icon('notes', 13)}</span>
      ${['top', 'right', 'bottom', 'left'].map(s => `<div class="pc-handle ${s}" data-side="${s}" title="Drag to another event to connect · drag to empty space for a new event"></div>`).join('')}
    </div>`;
  }

  noteHtml(n) {
    return `<div class="pcard sticky" data-note="${n.id}" style="left:${n.x}px;top:${n.y}px;--nc:${NOTE_COLORS[n.color] || NOTE_COLORS.yellow}">
      <div class="sn-grip" title="Drag to move"></div>
      <div class="sn-text" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Write an idea…">${esc(n.text)}</div>
    </div>`;
  }

  render() {
    this.cards.innerHTML = this.events.map(e => this.cardHtml(e)).join('') + this.notes.map(n => this.noteHtml(n)).join('');
    $('.board-hint', this.el).classList.toggle('hidden', this.events.length + this.notes.length > 0);
    this.drawEdges();
    this.highlight();
  }

  posOf(key) {
    if (key[0] === 'e') { const e = this.events.find(x => x.id === Number(key.slice(1))); return e && { x: e.board_x, y: e.board_y }; }
    const n = this.notes.find(x => x.id === Number(key.slice(1)));
    return n && { x: n.x, y: n.y };
  }

  elOf(key) {
    return key[0] === 'e' ? $(`.pcard[data-ev="${key.slice(1)}"]`, this.cards) : $(`.pcard[data-note="${key.slice(1)}"]`, this.cards);
  }

  boxOf(key) {
    const p = this.posOf(key);
    const el = this.elOf(key);
    return p && el ? { x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight } : null;
  }

  // ---------------------------------------------------------------- arrow routing

  static anchor(b, side) {
    if (side === 'top') return { x: b.x + b.w / 2, y: b.y };
    if (side === 'bottom') return { x: b.x + b.w / 2, y: b.y + b.h };
    if (side === 'left') return { x: b.x, y: b.y + b.h / 2 };
    return { x: b.x + b.w, y: b.y + b.h / 2 };
  }

  // The pair of sides that face each other, used when a connection has no fixed sides.
  static facingSides(a, b) {
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  // The side of a box closest to a point (where a dragged arrow should attach).
  static nearestSide(b, p) {
    const offX = Math.max(0, Math.abs(p.x - (b.x + b.w / 2)) - b.w / 2);
    const offY = Math.max(0, Math.abs(p.y - (b.y + b.h / 2)) - b.h / 2);
    const d = {
      top: Math.abs(p.y - b.y) + offX,
      bottom: Math.abs(p.y - (b.y + b.h)) + offX,
      left: Math.abs(p.x - b.x) + offY,
      right: Math.abs(p.x - (b.x + b.w)) + offY,
    };
    return Object.keys(d).sort((x, y) => d[x] - d[y])[0];
  }

  // Which way an arrow should enter a bare point (while it is being dragged to nowhere yet).
  static enteringSide(from, p) {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right';
    return dy >= 0 ? 'top' : 'bottom';
  }

  // Path for a connection from box a to box b. `ed` gives style, fixed sides and bend offset.
  // Returns the SVG path, the point for the label / bend handle, the two end points, and
  // which axis the bend handle moves along (elbow arrows slide only one way).
  static route(a, b, ed) {
    const facing = PlotBoard.facingSides(a, b);
    const sSide = ed.s_side || facing[0];
    const S = PlotBoard.anchor(a, sSide);
    const point = !b.w && !b.h;
    const tSide = point ? PlotBoard.enteringSide(S, b) : ed.t_side || facing[1];
    const T = PlotBoard.anchor(b, tSide);
    const nS = SIDE_NORMAL[sSide];
    const nT = SIDE_NORMAL[tSide];
    const bx = ed.bend_x || 0;
    const by = ed.bend_y || 0;
    const style = ed.style || 'curved';

    if (style === 'straight') {
      const m = { x: (S.x + T.x) / 2 + bx, y: (S.y + T.y) / 2 + by };
      const d = bx || by ? `M${S.x},${S.y} L${m.x},${m.y} L${T.x},${T.y}` : `M${S.x},${S.y} L${T.x},${T.y}`;
      return { d, mid: m, S, T, axis: 'xy' };
    }

    if (style === 'elbow') {
      const stub = 22;
      const S1 = { x: S.x + nS.x * stub, y: S.y + nS.y * stub };
      const T1 = { x: T.x + nT.x * stub, y: T.y + nT.y * stub };
      let pts;
      let mid;
      let axis;
      if (nS.x) { // leaves sideways: across, a vertical run that slides left/right, then across
        const mx = (nT.x ? (S1.x + T1.x) / 2 : T1.x) + bx;
        pts = [S, S1, { x: mx, y: S1.y }, { x: mx, y: T1.y }, T1, T];
        mid = { x: mx, y: (S1.y + T1.y) / 2 };
        axis = 'x';
      } else { // leaves up/down: a horizontal run that slides up/down
        const my = (nT.y ? (S1.y + T1.y) / 2 : T1.y) + by;
        pts = [S, S1, { x: S1.x, y: my }, { x: T1.x, y: my }, T1, T];
        mid = { x: (S1.x + T1.x) / 2, y: my };
        axis = 'y';
      }
      const dedup = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
      const clean = dedup.filter((p, i, arr) => i === 0 || i === arr.length - 1
        || !((arr[i - 1].x === p.x && p.x === arr[i + 1].x) || (arr[i - 1].y === p.y && p.y === arr[i + 1].y)));
      return { d: `M${clean.map(p => `${p.x},${p.y}`).join(' L')}`, mid, S, T, axis };
    }

    // Curved: control points leave each card straight out of its side; the bend pulls the middle.
    const dist = Math.hypot(T.x - S.x, T.y - S.y);
    const k = Math.min(220, Math.max(40, dist * 0.45));
    const c1 = { x: S.x + nS.x * k + bx * 4 / 3, y: S.y + nS.y * k + by * 4 / 3 };
    const c2 = { x: T.x + nT.x * k + bx * 4 / 3, y: T.y + nT.y * k + by * 4 / 3 };
    const mid = { x: (S.x + 3 * c1.x + 3 * c2.x + T.x) / 8, y: (S.y + 3 * c1.y + 3 * c2.y + T.y) / 8 };
    return { d: `M${S.x},${S.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${T.x},${T.y}`, mid, S, T, axis: 'xy' };
  }

  // The route for a stored connection, following an end that is being dragged if there is one.
  routeOf(ed) {
    const a = this.boxOf(`e${ed.source_id}`);
    const b = this.boxOf(`e${ed.target_id}`);
    const o = this.override;
    if (o && o.id === ed.id) {
      if (o.which === 'target') return a && PlotBoard.route(a, o.box, { ...ed, t_side: o.side || '', bend_x: 0, bend_y: 0 });
      // Dragging the start: route backwards from the fixed end, then flip which end gets the arrow.
      const r = b && PlotBoard.route(b, o.box, { ...ed, s_side: ed.t_side, t_side: o.side || '', bend_x: 0, bend_y: 0 });
      return r && { ...r, S: r.T, T: r.S, reversed: true };
    }
    return a && b ? PlotBoard.route(a, b, ed) : null;
  }

  drawEdges() {
    const sel = ui.selection && ui.selection.kind === 'edge' ? ui.selection.id : null;
    const parts = [];
    const labels = [];
    let handles = '';
    for (const ed of this.edges) {
      const r = this.routeOf(ed);
      if (!r) continue;
      const on = ed.id === sel;
      const marker = `url(#${on ? 'arr-sel' : 'arr'})`;
      parts.push(`<g class="edge ${on ? 'sel' : ''}" data-edge="${ed.id}"><path class="hit" d="${r.d}"/>`
        + `<path class="line" d="${r.d}" ${r.reversed ? `marker-start="${marker}"` : `marker-end="${marker}"`}/></g>`);
      if (ed.label) labels.push(`<div class="edge-label ${on ? 'sel' : ''}" data-edge="${ed.id}" style="left:${r.mid.x}px;top:${r.mid.y}px">${esc(ed.label)}</div>`);
      if (on && !this.override) {
        // Selected arrow: a bend handle in the middle and a grip on each end.
        handles = `
          <div class="eh-bend ${r.axis}" data-bend="${ed.id}" style="left:${r.mid.x}px;top:${r.mid.y}px" title="Drag to reshape · double-click to reset"></div>
          <div class="eh-end" data-end="source" data-eid="${ed.id}" style="left:${r.S.x}px;top:${r.S.y}px" title="Drag onto any side of a card to move this end"></div>
          <div class="eh-end" data-end="target" data-eid="${ed.id}" style="left:${r.T.x}px;top:${r.T.y}px" title="Drag onto any side of a card to move this end"></div>`;
      }
    }
    this.edgeLayer.innerHTML = parts.join('');
    this.labels.innerHTML = labels.join('');
    this.handles.innerHTML = handles;
  }

  highlight() {
    const s = ui.selection;
    $$('.pcard.selected', this.cards).forEach(c => c.classList.remove('selected'));
    if (s && s.kind === 'entry') this.elOf(`e${s.id}`)?.classList.add('selected');
    if (s && s.kind === 'note') this.elOf(`n${s.id}`)?.classList.add('selected');
    this.drawEdges();
  }

  onSelect() { this.highlight(); }

  applyView() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.vp.style.backgroundPosition = `${x}px ${y}px`;
    this.vp.style.backgroundSize = `${24 * z}px ${24 * z}px`;
    $('.zoom-pct', this.el).textContent = `${Math.round(z * 100)}%`;
    this.saveView();
  }

  toWorld(clientX, clientY) {
    const r = this.vp.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.x) / this.view.z, y: (clientY - r.top - this.view.y) / this.view.z };
  }

  center() {
    const r = this.vp.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  zoomAt(factor, clientX, clientY) {
    const r = this.vp.getBoundingClientRect();
    const cx = clientX ?? r.left + r.width / 2;
    const cy = clientY ?? r.top + r.height / 2;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.view.z * factor));
    const wx = (cx - r.left - this.view.x) / this.view.z;
    const wy = (cy - r.top - this.view.y) / this.view.z;
    this.view = { x: cx - r.left - wx * z, y: cy - r.top - wy * z, z };
    this.applyView();
  }

  fit() {
    const boxes = [...this.events.map(e => this.boxOf(`e${e.id}`)), ...this.notes.map(n => this.boxOf(`n${n.id}`))].filter(Boolean);
    if (!boxes.length) { this.view = { x: 120, y: 90, z: 1 }; return this.applyView(); }
    const x1 = Math.min(...boxes.map(b => b.x));
    const y1 = Math.min(...boxes.map(b => b.y));
    const x2 = Math.max(...boxes.map(b => b.x + b.w));
    const y2 = Math.max(...boxes.map(b => b.y + b.h));
    const r = this.vp.getBoundingClientRect();
    const z = Math.min(1.1, Math.max(ZOOM_MIN, Math.min((r.width - 120) / (x2 - x1), (r.height - 120) / (y2 - y1))));
    this.view = { z, x: (r.width - (x2 - x1) * z) / 2 - x1 * z, y: (r.height - (y2 - y1) * z) / 2 - y1 * z };
    this.applyView();
  }

  // Scrolls a card into the middle of the view.
  reveal(key) {
    const b = this.boxOf(key);
    if (!b) return;
    const r = this.vp.getBoundingClientRect();
    this.view.x = r.width / 2 - (b.x + b.w / 2) * this.view.z;
    this.view.y = r.height / 2 - (b.y + b.h / 2) * this.view.z;
    this.world.classList.add('animate');
    this.applyView();
    setTimeout(() => this.world.classList.remove('animate'), 300);
  }

  // Lays events out in columns: each event goes one column right of everything that leads to it.
  async arrange() {
    if (this.events.length > 1 && !(await confirmBox('Arrange the board?',
      'Events are laid out left to right following their connections. Sticky notes stay where they are.', 'Arrange'))) return;
    const ids = this.events.map(e => e.id);
    const incoming = new Map(ids.map(id => [id, 0]));
    const out = new Map(ids.map(id => [id, []]));
    for (const e of this.edges) { incoming.set(e.target_id, incoming.get(e.target_id) + 1); out.get(e.source_id).push(e.target_id); }
    const rank = new Map();
    const queue = ids.filter(id => !incoming.get(id));
    queue.forEach(id => rank.set(id, 0));
    while (queue.length) {
      const id = queue.shift();
      for (const t of out.get(id)) {
        rank.set(t, Math.max(rank.get(t) || 0, rank.get(id) + 1));
        incoming.set(t, incoming.get(t) - 1);
        if (!incoming.get(t)) queue.push(t);
      }
    }
    const maxRank = Math.max(0, ...rank.values());
    ids.filter(id => !rank.has(id)).forEach(id => rank.set(id, maxRank + 1)); // part of a loop
    const columns = new Map();
    for (const e of [...this.events].sort((a, b) => a.board_y - b.board_y)) {
      const r = rank.get(e.id);
      if (!columns.has(r)) columns.set(r, []);
      columns.get(r).push(e);
    }
    const x0 = Math.min(...this.events.map(e => e.board_x));
    const y0 = Math.min(...this.events.map(e => e.board_y));
    for (const [r, col] of columns) {
      let y = y0;
      for (const e of col) {
        e.board_x = x0 + r * 320;
        e.board_y = y;
        y += (this.elOf(`e${e.id}`)?.offsetHeight || 120) + 40;
      }
    }
    await api.saveBoardPositions(this.events.map(e => ({ id: e.id, x: e.board_x, y: e.board_y })));
    this.render();
    await this.clearNotesFromCards();
    this.fit();
  }

  // After arranging, sticky notes that ended up on top of a card move up above it.
  async clearNotesFromCards() {
    const cards = this.events.map(e => this.boxOf(`e${e.id}`)).filter(Boolean);
    const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const n of this.notes) {
      const box = this.boxOf(`n${n.id}`);
      if (!box) continue;
      let moved = false;
      for (let guard = 0; guard < 20; guard++) {
        const card = cards.find(c => hits(box, c));
        if (!card) break;
        box.y = card.y - box.h - 30;
        moved = true;
      }
      if (!moved) continue;
      n.y = Math.round(box.y);
      const el = this.elOf(`n${n.id}`);
      el.style.top = `${n.y}px`;
      await api.updateBoardNote(n.id, { y: n.y });
    }
  }

  // ---------------------------------------------------------------- creating things

  // `at` is where the new card's center goes; `topLeft` places its corner exactly instead.
  async addEvent(at, { linkFrom, fromSide = '', toSide = '', topLeft } = {}) {
    const p = at || this.center();
    const id = await createEntry('Event', '');
    const pos = topLeft || { x: p.x - 120, y: p.y - 30 };
    await api.saveBoardPositions([{ id, x: Math.round(pos.x), y: Math.round(pos.y) }]);
    if (linkFrom) await api.addRelation({ source_id: linkFrom, target_id: id, label: '', style: this.arrowStyle, s_side: fromSide, t_side: toSide });
    await this.refresh();
    select({ kind: 'entry', id });
    inspector.focusTitle();
  }

  async addNote(at) {
    const p = at || this.center();
    const id = await api.createBoardNote({ x: Math.round(p.x - 100), y: Math.round(p.y - 40) });
    await this.refresh();
    select({ kind: 'note', id });
    $('.sn-text', this.elOf(`n${id}`))?.focus();
  }

  async link(sourceId, targetId, sSide = '', tSide = '') {
    if (sourceId === targetId) return;
    const existing = this.edges.find(e => e.source_id === sourceId && e.target_id === targetId);
    if (existing) return select({ kind: 'edge', id: existing.id });
    const id = await api.addRelation({ source_id: sourceId, target_id: targetId, label: '', style: this.arrowStyle, s_side: sSide, t_side: tSide });
    await this.refresh();
    select({ kind: 'edge', id });
  }

  async addParticipant(eventId, entryId) {
    const ev = this.events.find(e => e.id === eventId);
    const who = ui.byId.get(entryId);
    if (!ev || !who || who.type === 'Event') return;
    if ((this.participants.get(eventId) || []).some(p => p.id === entryId)) return toast(`${who.name} is already in “${ev.name}”`);
    await api.addRelation({ source_id: eventId, target_id: entryId, label: 'involves' });
    toast(`Added ${who.name} to “${ev.name || 'Untitled event'}”`);
    await dataChanged();
    if (ui.selection && ui.selection.kind === 'entry' && [eventId, entryId].includes(ui.selection.id)) inspector.reload();
  }

  async deleteNote(id) {
    const n = this.notes.find(x => x.id === id);
    if (n && n.text.trim() && !(await confirmBox('Delete sticky note?', n.text.slice(0, 140)))) return;
    await api.deleteBoardNote(id);
    if (ui.selection && ui.selection.kind === 'note' && ui.selection.id === id) select(null);
    this.refresh();
  }

  async deleteEdge(id) {
    await api.deleteRelation(id);
    if (ui.selection && ui.selection.kind === 'edge' && ui.selection.id === id) select(null);
    dataChanged();
  }

  setNotesFlag(id, has) {
    const card = this.elOf(`e${id}`);
    if (card) $('.pc-flag', card).classList.toggle('hidden', !has);
  }

  // ---------------------------------------------------------------- interaction

  bind() {
    this.el.addEventListener('click', e => {
      const arrow = e.target.closest('[data-arrow]');
      if (arrow) {
        this.setArrowStyle(arrow.dataset.arrow);
        return toast(`New connections will be ${ARROW_STYLES.find(s => s.key === arrow.dataset.arrow).label.toLowerCase()} arrows`);
      }
      const b = e.target.closest('[data-b]');
      if (!b) return;
      ({
        event: () => this.addEvent(),
        note: () => this.addNote(),
        arrange: () => this.arrange(),
        fit: () => this.fit(),
        in: () => this.zoomAt(1.2),
        out: () => this.zoomAt(1 / 1.2),
      })[b.dataset.b]();
    });

    this.vp.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.shiftKey) { this.view.x -= e.deltaY; this.applyView(); return; }
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });

    this.vp.addEventListener('pointerdown', e => this.onPointerDown(e));

    this.vp.addEventListener('dblclick', e => {
      if (e.target.closest('.sticky')) return;
      const bend = e.target.closest('[data-bend]');
      if (bend) return this.setEdge(Number(bend.dataset.bend), { bend_x: 0, bend_y: 0 });
      const card = e.target.closest('.pcard.ev');
      if (card) { select({ kind: 'entry', id: Number(card.dataset.ev) }); return inspector.focusTitle(); }
      const label = e.target.closest('[data-edge]');
      if (label) return inspector.focusEdgeLabel();
      if (this.isBackground(e.target)) this.addEvent(this.toWorld(e.clientX, e.clientY));
    });

    this.vp.addEventListener('contextmenu', e => {
      e.preventDefault();
      const at = this.toWorld(e.clientX, e.clientY);
      const card = e.target.closest('.pcard.ev');
      const note = e.target.closest('.sticky');
      const edge = e.target.closest('[data-edge]');
      if (card) {
        const id = Number(card.dataset.ev);
        select({ kind: 'entry', id });
        return showMenu(e.clientX, e.clientY, [
          { label: 'Rename', icon: 'edit', run: () => inspector.focusTitle() },
          { label: 'Add the next event', icon: 'plus', run: () => {
            const b = this.boxOf(`e${id}`);
            this.addEvent({ x: b.x + b.w + 200, y: b.y + 30 }, { linkFrom: id });
          } },
          { label: 'Delete event', icon: 'trash', danger: true, run: () => deleteEntry(id) },
        ]);
      }
      if (note) {
        const id = Number(note.dataset.note);
        select({ kind: 'note', id });
        return showMenu(e.clientX, e.clientY, [
          ...Object.keys(NOTE_COLORS).map(c => ({ label: c[0].toUpperCase() + c.slice(1), icon: 'sticky', run: () => this.setNoteColor(id, c) })),
          { label: 'Turn into event', icon: 'board', run: () => this.noteToEvent(id) },
          { label: 'Delete note', icon: 'trash', danger: true, run: () => this.deleteNote(id) },
        ]);
      }
      if (edge) {
        const id = Number(edge.dataset.edge);
        select({ kind: 'edge', id });
        return showMenu(e.clientX, e.clientY, [
          { label: 'Edit label', icon: 'edit', run: () => inspector.focusEdgeLabel() },
          { label: 'Delete connection', icon: 'trash', danger: true, run: () => this.deleteEdge(id) },
        ]);
      }
      showMenu(e.clientX, e.clientY, [
        { label: 'New event here', icon: 'plus', run: () => this.addEvent(at) },
        { label: 'New sticky note here', icon: 'sticky', run: () => this.addNote(at) },
        { label: 'Fit everything in view', icon: 'fit', run: () => this.fit() },
      ]);
    });

    // Sticky note text is edited right on the board.
    this.cards.addEventListener('input', e => {
      const t = e.target.closest('.sn-text');
      if (!t) return;
      const n = this.notes.find(x => x.id === Number(t.closest('.sticky').dataset.note));
      n.text = t.textContent;
      this.saveNoteText(n.id, n.text);
      this.drawEdges();
    });

    // Dragging cast members (from the left panel) onto an event.
    this.vp.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('application/x-omni-entry')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'link';
      const card = e.target.closest('.pcard.ev');
      $$('.pcard.drop-target', this.cards).forEach(c => c !== card && c.classList.remove('drop-target'));
      card?.classList.add('drop-target');
    });
    this.vp.addEventListener('dragleave', e => {
      if (!this.vp.contains(e.relatedTarget)) $$('.pcard.drop-target', this.cards).forEach(c => c.classList.remove('drop-target'));
    });
    this.vp.addEventListener('drop', e => {
      const id = Number(e.dataTransfer.getData('application/x-omni-entry'));
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      $$('.pcard.drop-target', this.cards).forEach(c => c.classList.remove('drop-target'));
      const card = e.target.closest('.pcard.ev');
      if (card) this.addParticipant(Number(card.dataset.ev), id);
      else toast('Drop them onto an event card to add them to that scene');
    });
  }

  isBackground(t) {
    return t === this.vp || t === this.world || t.closest('.board-edges') && !t.closest('.edge') || t.classList.contains('board-hint');
  }

  onPointerDown(e) {
    if (e.button === 2) return;
    const t = e.target;
    if (e.button === 1 || this.isBackground(t)) return this.dragPan(e);
    if (t.closest('.pc-handle')) return this.dragConnect(e, Number(t.closest('.pcard').dataset.ev), t.closest('.pc-handle').dataset.side);
    const bend = t.closest('[data-bend]');
    if (bend) return this.dragBend(e, Number(bend.dataset.bend));
    const end = t.closest('[data-end]');
    if (end) return this.dragEnd(e, Number(end.dataset.eid), end.dataset.end);
    const edge = t.closest('[data-edge]');
    if (edge) {
      // Pressing on an arrow selects it; dragging it reshapes it straight away.
      const id = Number(edge.dataset.edge);
      select({ kind: 'edge', id });
      return this.dragBend(e, id);
    }
    const card = t.closest('.pcard');
    if (!card) return;
    if (card.classList.contains('sticky')) {
      select({ kind: 'note', id: Number(card.dataset.note) });
      if (t.closest('.sn-text')) return; // typing, not moving
      return this.dragCard(e, `n${card.dataset.note}`);
    }
    select({ kind: 'entry', id: Number(card.dataset.ev) });
    this.dragCard(e, `e${card.dataset.ev}`);
  }

  // Follows one pointer until it is released. The pointer is only captured once it actually moves,
  // so plain clicks and double-clicks still reach the element that was clicked.
  track(e, onMove, onUp) {
    const id = e.pointerId;
    let captured = false;
    const move = ev => {
      if (ev.pointerId !== id) return;
      if (!captured) { captured = true; try { this.vp.setPointerCapture(id); } catch {} }
      onMove(ev);
    };
    const up = ev => {
      if (ev.pointerId !== id) return;
      this.vp.removeEventListener('pointermove', move);
      this.vp.removeEventListener('pointerup', up);
      this.vp.removeEventListener('pointercancel', up);
      onUp(ev);
    };
    this.vp.addEventListener('pointermove', move);
    this.vp.addEventListener('pointerup', up);
    this.vp.addEventListener('pointercancel', up);
  }

  dragPan(e) {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
    let moved = false;
    this.vp.classList.add('panning');
    this.track(e, ev => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      this.view.x = start.vx + ev.clientX - start.x;
      this.view.y = start.vy + ev.clientY - start.y;
      this.applyView();
    }, () => {
      this.vp.classList.remove('panning');
      if (!moved) select(null); // a click on empty board clears the selection
    });
  }

  dragCard(e, key) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    const el = this.elOf(key);
    const p = this.posOf(key);
    const start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y };
    let moved = false;
    this.track(e, ev => {
      const dx = (ev.clientX - start.x) / this.view.z;
      const dy = (ev.clientY - start.y) / this.view.z;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) el.classList.add('dragging');
      moved = true;
      const x = Math.round(start.px + dx);
      const y = Math.round(start.py + dy);
      if (key[0] === 'e') { const ev2 = this.events.find(v => v.id === Number(key.slice(1))); ev2.board_x = x; ev2.board_y = y; }
      else { const n = this.notes.find(v => v.id === Number(key.slice(1))); n.x = x; n.y = y; }
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      this.drawEdges();
    }, () => {
      el.classList.remove('dragging');
      if (!moved) return;
      const np = this.posOf(key);
      if (key[0] === 'e') api.saveBoardPositions([{ id: Number(key.slice(1)), x: np.x, y: np.y }]);
      else api.updateBoardNote(Number(key.slice(1)), { x: np.x, y: np.y });
    });
  }

  // The event card (and which of its sides) under the pointer, ignoring one card.
  cardAt(ev, exceptId) {
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const card = under && under.closest('.pcard.ev');
    const id = card ? Number(card.dataset.ev) : null;
    if (!id || id === exceptId) return null;
    const box = this.boxOf(`e${id}`);
    const handle = under.closest('.pc-handle');
    return { id, card, box, side: handle ? handle.dataset.side : PlotBoard.nearestSide(box, this.toWorld(ev.clientX, ev.clientY)) };
  }

  showDropSide(hit) {
    $$('.pcard.drop-target', this.cards).forEach(c => c !== (hit && hit.card) && c.classList.remove('drop-target'));
    $$('.pc-handle.drop-side', this.cards).forEach(h => h.classList.remove('drop-side'));
    if (!hit) return;
    hit.card.classList.add('drop-target');
    $(`.pc-handle.${hit.side}`, hit.card).classList.add('drop-side');
  }

  // Dragging from one of a card's four dots: onto a card connects them, into space creates the next event.
  dragConnect(e, sourceId, side) {
    e.preventDefault();
    e.stopPropagation();
    const src = this.boxOf(`e${sourceId}`);
    const startClient = { x: e.clientX, y: e.clientY };
    let hit = null;
    this.temp.classList.remove('hidden');
    this.vp.classList.add('connecting');
    const draw = ev => {
      const p = this.toWorld(ev.clientX, ev.clientY);
      hit = this.cardAt(ev, sourceId);
      this.showDropSide(hit);
      const end = hit ? hit.box : { x: p.x, y: p.y, w: 0, h: 0 };
      this.temp.setAttribute('d', PlotBoard.route(src, end, { style: this.arrowStyle, s_side: side, t_side: hit ? hit.side : '' }).d);
    };
    this.track(e, draw, ev => {
      this.temp.classList.add('hidden');
      this.vp.classList.remove('connecting');
      this.showDropSide(null);
      if (hit) return this.link(sourceId, hit.id, side, hit.side);
      if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) > 40) {
        // The new card is placed so the arrow meets the middle of the side it enters.
        const p = this.toWorld(ev.clientX, ev.clientY);
        const toSide = PlotBoard.enteringSide(PlotBoard.anchor(src, side), p);
        const w = 240;
        const h = 64;
        const topLeft = {
          left: { x: p.x, y: p.y - h / 2 }, right: { x: p.x - w, y: p.y - h / 2 },
          top: { x: p.x - w / 2, y: p.y }, bottom: { x: p.x - w / 2, y: p.y - h },
        }[toSide];
        this.addEvent(null, { linkFrom: sourceId, fromSide: side, toSide, topLeft });
      }
    });
  }

  // Reshaping an arrow: elbows slide their middle run, straight and curved arrows bend freely.
  dragBend(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const ed = this.edges.find(x => x.id === id);
    const r = ed && this.routeOf(ed);
    if (!r) return;
    const start = { x: e.clientX, y: e.clientY, bx: ed.bend_x || 0, by: ed.bend_y || 0 };
    let moved = false;
    this.track(e, ev => {
      const dx = (ev.clientX - start.x) / this.view.z;
      const dy = (ev.clientY - start.y) / this.view.z;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (r.axis !== 'y') ed.bend_x = Math.round(start.bx + dx);
      if (r.axis !== 'x') ed.bend_y = Math.round(start.by + dy);
      this.drawEdges();
    }, () => {
      if (moved) api.updateRelation(id, { bend_x: ed.bend_x || 0, bend_y: ed.bend_y || 0 });
    });
  }

  // Moving one end of an arrow to another side, or to another card.
  dragEnd(e, id, which) {
    e.preventDefault();
    e.stopPropagation();
    const ed = this.edges.find(x => x.id === id);
    if (!ed) return;
    const fixedId = which === 'target' ? ed.source_id : ed.target_id;
    let hit = null;
    this.vp.classList.add('connecting');
    const move = ev => {
      const p = this.toWorld(ev.clientX, ev.clientY);
      hit = this.cardAt(ev, fixedId);
      this.showDropSide(hit);
      this.override = { id, which, box: hit ? hit.box : { x: p.x, y: p.y, w: 0, h: 0 }, side: hit ? hit.side : '' };
      this.drawEdges();
    };
    this.track(e, move, async () => {
      this.vp.classList.remove('connecting');
      this.showDropSide(null);
      this.override = null;
      if (!hit) return this.drawEdges();
      const cardChanged = hit.id !== (which === 'target' ? ed.target_id : ed.source_id);
      const patch = which === 'target' ? { target_id: hit.id, t_side: hit.side } : { source_id: hit.id, s_side: hit.side };
      Object.assign(ed, patch, { bend_x: 0, bend_y: 0 });
      await api.updateRelation(id, { ...patch, bend_x: 0, bend_y: 0 });
      this.drawEdges();
      if (cardChanged) { inspector.render(); dataChanged(); }
    });
  }

  async setEdge(id, patch) {
    const ed = this.edges.find(x => x.id === id);
    if (!ed) return;
    Object.assign(ed, patch);
    await api.updateRelation(id, patch);
    this.drawEdges();
  }

  setArrowStyle(style) {
    this.arrowStyle = style;
    store.set('omni.arrowStyle', style);
    this.markArrowStyle();
  }

  markArrowStyle() {
    $$('[data-arrow]', this.el).forEach(b => b.classList.toggle('on', b.dataset.arrow === this.arrowStyle));
  }

  async setNoteColor(id, color) {
    await api.updateBoardNote(id, { color });
    this.notes.find(n => n.id === id).color = color;
    this.elOf(`n${id}`)?.style.setProperty('--nc', NOTE_COLORS[color]);
    if (ui.selection && ui.selection.kind === 'note') inspector.render();
  }

  // A sticky note that has become a real plot point.
  async noteToEvent(id) {
    const n = this.notes.find(x => x.id === id);
    if (!n) return;
    const [first, ...rest] = n.text.trim().split('\n');
    const eid = await createEntry('Event', first.slice(0, 120) || '');
    if (rest.join('\n').trim()) await api.updateEntry(eid, { notes: rest.join('\n').trim() });
    await api.saveBoardPositions([{ id: eid, x: n.x, y: n.y }]);
    await api.deleteBoardNote(id);
    await this.refresh();
    select({ kind: 'entry', id: eid });
  }

  // Delete key on the board.
  deleteSelection() {
    const s = ui.selection;
    if (!s) return;
    if (s.kind === 'entry' && this.events.some(e => e.id === s.id)) deleteEntry(s.id);
    if (s.kind === 'note') this.deleteNote(s.id);
    if (s.kind === 'edge') this.deleteEdge(s.id);
  }
}
