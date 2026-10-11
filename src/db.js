// SQLite storage via sql.js (WASM, no native build). The whole database lives in
// memory and is flushed to a single .sqlite file on disk after every change.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  fields      TEXT NOT NULL DEFAULT '[]',
  tags        TEXT NOT NULL DEFAULT '[]',
  cover_id    INTEGER,
  event_date  TEXT NOT NULL DEFAULT '',
  event_order REAL NOT NULL DEFAULT 0,
  graph_x     REAL,
  graph_y     REAL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  file       TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  label     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS board_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id   TEXT,
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  text       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'yellow',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_entry ON images(entry_id);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relations(target_id);
`;

const ENTRY_COLUMNS = ['type', 'name', 'summary', 'notes', 'fields', 'tags', 'cover_id',
  'event_date', 'event_order', 'graph_x', 'graph_y', 'story_id', 'board_x', 'board_y', 'color'];
const JSON_COLUMNS = ['fields', 'tags'];

// [[Target]] or [[Target|shown text]] inside notes.
const WIKILINK = /\[\[([^\[\]\n|]+)(\|[^\[\]\n]+)?\]\]/g;
const escapeLike = s => s.replace(/[\\%_]/g, c => '\\' + c);

let sqlModule; // the WASM engine is loaded once and shared by every world's database

class Store {
  static async open(file) {
    sqlModule ??= initSqlJs({ wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) });
    const SQL = await sqlModule;
    const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    return new Store(db, file);
  }

  close() {
    this.db.close();
  }

  constructor(db, file) {
    this.db = db;
    this.file = file;
    db.run('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    this.migrate();
    this.flush();
  }

  // Columns added after the first release; older libraries get them on open.
  migrate() {
    const cols = this.all('PRAGMA table_info(entries)').map(c => c.name);
    // Which story (profile id) an Event belongs to. Other entries are shared by the whole series.
    if (!cols.includes('story_id')) this.db.run('ALTER TABLE entries ADD COLUMN story_id TEXT');
    // Where an event sits on the plot board, and its plot-thread color.
    if (!cols.includes('board_x')) this.db.run('ALTER TABLE entries ADD COLUMN board_x REAL');
    if (!cols.includes('board_y')) this.db.run('ALTER TABLE entries ADD COLUMN board_y REAL');
    if (!cols.includes('color')) this.db.run("ALTER TABLE entries ADD COLUMN color TEXT NOT NULL DEFAULT ''");

    // How a connection is drawn on the plot board: curved / straight / elbow, which side of each
    // card it attaches to ('' = whichever sides face each other), and how far it was dragged from its default shape.
    const rcols = this.all('PRAGMA table_info(relations)').map(c => c.name);
    if (!rcols.includes('style')) this.db.run("ALTER TABLE relations ADD COLUMN style TEXT NOT NULL DEFAULT ''");
    if (!rcols.includes('s_side')) this.db.run("ALTER TABLE relations ADD COLUMN s_side TEXT NOT NULL DEFAULT ''");
    if (!rcols.includes('t_side')) this.db.run("ALTER TABLE relations ADD COLUMN t_side TEXT NOT NULL DEFAULT ''");
    if (!rcols.includes('bend_x')) this.db.run('ALTER TABLE relations ADD COLUMN bend_x REAL NOT NULL DEFAULT 0');
    if (!rcols.includes('bend_y')) this.db.run('ALTER TABLE relations ADD COLUMN bend_y REAL NOT NULL DEFAULT 0');
  }

  // Write to a temp file then rename, so a crash mid-write never corrupts the library.
  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  // Runs one or more writes, then persists once.
  write(fn) {
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.flush();
      return result;
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  run(sql, params = []) {
    this.db.run(sql, params);
  }

  lastId() {
    return this.get('SELECT last_insert_rowid() AS id').id;
  }

  // ---- entries ----

  static decode(row) {
    if (!row) return row;
    for (const col of JSON_COLUMNS) {
      try { row[col] = JSON.parse(row[col]); } catch { row[col] = []; }
    }
    return row;
  }

  listEntries({ type, q, tag } = {}) {
    const where = [];
    const params = [];
    if (type) { where.push('e.type = ?'); params.push(type); }
    if (q) {
      where.push('(e.name LIKE ? OR e.summary LIKE ? OR e.notes LIKE ? OR e.tags LIKE ? OR e.fields LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    if (tag) { where.push('e.tags LIKE ?'); params.push(`%${JSON.stringify(tag)}%`); }
    const sql = `
      SELECT e.id, e.type, e.name, e.summary, e.tags, e.fields, e.event_date, e.event_order, e.graph_x, e.graph_y, e.story_id, e.board_x, e.board_y, e.color, length(e.notes) AS notes_len,
             COALESCE(c.file, (SELECT file FROM images WHERE entry_id = e.id ORDER BY sort, id LIMIT 1)) AS cover,
             (SELECT COUNT(*) FROM images WHERE entry_id = e.id) AS image_count
      FROM entries e LEFT JOIN images c ON c.id = e.cover_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.name COLLATE NOCASE`;
    return this.all(sql, params).map(Store.decode);
  }

  getEntry(id) {
    const entry = Store.decode(this.get('SELECT * FROM entries WHERE id = ?', [id]));
    if (!entry) return null;
    entry.images = this.all('SELECT * FROM images WHERE entry_id = ? ORDER BY sort, id', [id]);
    entry.relations = this.all(`
      SELECT r.id, r.label, r.source_id, r.target_id,
             CASE WHEN r.source_id = ? THEN 'out' ELSE 'in' END AS direction,
             o.id AS other_id, o.name AS other_name, o.type AS other_type
      FROM relations r
      JOIN entries o ON o.id = CASE WHEN r.source_id = ? THEN r.target_id ELSE r.source_id END
      WHERE r.source_id = ? OR r.target_id = ?
      ORDER BY o.name COLLATE NOCASE`, [id, id, id, id]);
    return entry;
  }

  createEntry(data) {
    const now = new Date().toISOString();
    return this.write(() => {
      const order = data.type === 'Event'
        ? (this.get("SELECT COALESCE(MAX(event_order), 0) + 1 AS n FROM entries WHERE type = 'Event'").n)
        : 0;
      this.run(`INSERT INTO entries (type, name, summary, fields, tags, event_order, story_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.type, data.name || 'Untitled', data.summary || '',
          JSON.stringify(data.fields || []), JSON.stringify(data.tags || []), order, data.story_id || null, now, now]);
      return this.lastId();
    });
  }

  updateEntry(id, patch) {
    const sets = [];
    const params = [];
    for (const col of ENTRY_COLUMNS) {
      if (!(col in patch)) continue;
      sets.push(`${col} = ?`);
      params.push(JSON_COLUMNS.includes(col) ? JSON.stringify(patch[col]) : patch[col]);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    params.push(new Date().toISOString(), id);
    const oldName = 'name' in patch ? this.get('SELECT name FROM entries WHERE id = ?', [id]).name : null;
    this.write(() => {
      this.run(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`, params);
      if (oldName != null && patch.name.trim() && oldName.trim() !== patch.name.trim()) {
        // If another entry still has the old name, existing links point at that one; leave them alone.
        const shared = this.get('SELECT COUNT(*) AS n FROM entries WHERE id != ? AND lower(trim(name)) = lower(?)', [id, oldName.trim()]).n;
        if (!shared) this.renameLinks(oldName, patch.name);
      }
    });
  }

  // Rewrites [[Old name]] links in every note so renaming an entry never breaks links to it.
  renameLinks(oldName, newName) {
    const target = oldName.trim().toLowerCase();
    const rows = this.all("SELECT id, notes FROM entries WHERE notes LIKE ? ESCAPE '\\'", [`%[[${escapeLike(oldName.trim())}%`]);
    for (const row of rows) {
      const notes = row.notes.replace(WIKILINK, (m, name, alias) =>
        name.trim().toLowerCase() === target ? `[[${newName.trim()}${alias || ''}]]` : m);
      if (notes !== row.notes) this.run('UPDATE entries SET notes = ? WHERE id = ?', [notes, row.id]);
    }
  }

  // Entries whose notes link to this one, with the lines that mention it.
  backlinks(id) {
    const entry = this.get('SELECT name FROM entries WHERE id = ?', [id]);
    if (!entry || !entry.name.trim()) return [];
    const target = entry.name.trim().toLowerCase();
    const rows = this.all(
      "SELECT id, name, type, notes FROM entries WHERE id != ? AND notes LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE",
      [id, `%[[${escapeLike(entry.name.trim())}%`]);
    return rows.map(r => {
      const lines = r.notes.split('\n').filter(l => [...l.matchAll(WIKILINK)].some(m => m[1].trim().toLowerCase() === target));
      return { id: r.id, name: r.name, type: r.type, snippets: lines.slice(0, 3).map(l => l.trim()) };
    }).filter(r => r.snippets.length);
  }

  // Note-to-note links for the graph, resolved by entry name.
  linkEdges() {
    const rows = this.all("SELECT id, name, notes FROM entries");
    const byName = new Map(rows.map(r => [r.name.trim().toLowerCase(), r.id]));
    const seen = new Set();
    const edges = [];
    for (const r of rows) {
      for (const m of r.notes.matchAll(WIKILINK)) {
        const target = byName.get(m[1].trim().toLowerCase());
        const key = `${r.id}>${target}`;
        if (target == null || target === r.id || seen.has(key)) continue;
        seen.add(key);
        edges.push({ source_id: r.id, target_id: target });
      }
    }
    return edges;
  }

  // Returns the image files that belonged to the entry so the caller can delete them.
  deleteEntry(id) {
    return this.write(() => {
      const files = this.all('SELECT file FROM images WHERE entry_id = ?', [id]).map(r => r.file);
      this.run('DELETE FROM entries WHERE id = ?', [id]);
      return files;
    });
  }

  // Events from before stories existed belong to whichever story owned the library then.
  assignOrphanEvents(storyId) {
    if (this.get("SELECT 1 AS x FROM entries WHERE type = 'Event' AND story_id IS NULL")) {
      this.write(() => this.run("UPDATE entries SET story_id = ? WHERE type = 'Event' AND story_id IS NULL", [storyId]));
    }
  }

  // Removes one story's events from a shared library. Returns their image files for deletion.
  deleteStoryEvents(storyId) {
    return this.write(() => {
      const files = this.all(`SELECT i.file FROM images i JOIN entries e ON e.id = i.entry_id
                              WHERE e.story_id = ?`, [storyId]).map(r => r.file);
      this.run('DELETE FROM entries WHERE story_id = ?', [storyId]);
      this.run('DELETE FROM board_notes WHERE story_id = ?', [storyId]);
      return files;
    });
  }

  saveBoardPositions(positions) {
    this.write(() => {
      for (const p of positions) this.run('UPDATE entries SET board_x = ?, board_y = ? WHERE id = ?', [p.x, p.y, p.id]);
    });
  }

  // ---- sticky notes on the plot board (one set per story) ----

  listBoardNotes(storyId) {
    return this.all('SELECT * FROM board_notes WHERE story_id = ? ORDER BY id', [storyId]);
  }

  createBoardNote(storyId, { x, y, text = '', color = 'yellow' }) {
    const now = new Date().toISOString();
    return this.write(() => {
      this.run('INSERT INTO board_notes (story_id, x, y, text, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [storyId, x, y, text, color, now, now]);
      return this.lastId();
    });
  }

  updateBoardNote(id, patch) {
    const sets = [];
    const params = [];
    for (const col of ['x', 'y', 'text', 'color']) {
      if (col in patch) { sets.push(`${col} = ?`); params.push(patch[col]); }
    }
    if (!sets.length) return;
    params.push(new Date().toISOString(), id);
    this.write(() => this.run(`UPDATE board_notes SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, params));
  }

  deleteBoardNote(id) {
    this.write(() => this.run('DELETE FROM board_notes WHERE id = ?', [id]));
  }

  saveGraphPositions(positions) {
    this.write(() => {
      for (const p of positions) this.run('UPDATE entries SET graph_x = ?, graph_y = ? WHERE id = ?', [p.x, p.y, p.id]);
    });
  }

  reorderEvents(ids) {
    this.write(() => ids.forEach((id, i) => this.run('UPDATE entries SET event_order = ? WHERE id = ?', [i + 1, id])));
  }

  listTags() {
    const counts = new Map();
    for (const { tags } of this.all('SELECT tags FROM entries')) {
      let list = [];
      try { list = JSON.parse(tags); } catch {}
      for (const t of list) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  typeCounts() {
    return this.all('SELECT type, COUNT(*) AS count FROM entries GROUP BY type');
  }

  // ---- images ----

  addImages(entryId, files) {
    const now = new Date().toISOString();
    this.write(() => {
      let sort = this.get('SELECT COALESCE(MAX(sort), 0) AS s FROM images WHERE entry_id = ?', [entryId]).s;
      for (const file of files) {
        this.run('INSERT INTO images (entry_id, file, sort, created_at) VALUES (?, ?, ?, ?)', [entryId, file, ++sort, now]);
      }
    });
  }

  updateImage(id, { caption }) {
    this.write(() => this.run('UPDATE images SET caption = ? WHERE id = ?', [caption, id]));
  }

  deleteImage(id) {
    return this.write(() => {
      const img = this.get('SELECT file FROM images WHERE id = ?', [id]);
      this.run('UPDATE entries SET cover_id = NULL WHERE cover_id = ?', [id]);
      this.run('DELETE FROM images WHERE id = ?', [id]);
      return img && img.file;
    });
  }

  // ---- relations ----

  addRelation({ source_id, target_id, label, style = '', s_side = '', t_side = '' }) {
    return this.write(() => {
      this.run('INSERT INTO relations (source_id, target_id, label, style, s_side, t_side) VALUES (?, ?, ?, ?, ?, ?)',
        [source_id, target_id, label || '', style, s_side, t_side]);
      return this.lastId();
    });
  }

  updateRelation(id, patch) {
    const sets = [];
    const params = [];
    for (const col of ['label', 'style', 's_side', 't_side', 'bend_x', 'bend_y', 'source_id', 'target_id']) {
      if (col in patch) { sets.push(`${col} = ?`); params.push(patch[col]); }
    }
    if (!sets.length) return;
    params.push(id);
    this.write(() => this.run(`UPDATE relations SET ${sets.join(', ')} WHERE id = ?`, params));
  }

  deleteRelation(id) {
    this.write(() => this.run('DELETE FROM relations WHERE id = ?', [id]));
  }

  relationLabels() {
    return this.all("SELECT DISTINCT label FROM relations WHERE label != '' ORDER BY label COLLATE NOCASE").map(r => r.label);
  }

  graph() {
    return {
      nodes: this.listEntries(),
      edges: this.all('SELECT id, source_id, target_id, label, style, s_side, t_side, bend_x, bend_y FROM relations'),
      links: this.linkEdges(),
    };
  }
}

module.exports = { Store };
