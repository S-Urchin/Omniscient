// Registry of worlds (profiles). Each profile is one story. A standalone story has its own
// folder (database + images); prequels and sequels share the folder of the story they belong to,
// so a whole series sees the same characters and story elements. `order` places a story within
// its series (lower = earlier). worlds.json in the data root lists every profile.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = ['standalone', 'prequel', 'sequel'];

class Worlds {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'worlds.json');
    fs.mkdirSync(root, { recursive: true });
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { worlds: [] };
    for (const w of this.data.worlds) {
      w.kind ??= 'standalone';
      w.relatedTo ??= null;
      w.order ??= 0;
    }
    this.adoptLegacyLibrary();
  }

  // Before worlds existed, the single library lived in <root>/library. Keep it as the first world.
  adoptLegacyLibrary() {
    const legacy = path.join(this.root, 'library');
    const known = this.data.worlds.some(w => w.folder === 'library');
    if (!known && fs.existsSync(path.join(legacy, 'omniscient.sqlite'))) {
      this.data.worlds.push(this.record({ name: 'My World', color: '#c9a24a' }, 'library'));
      this.save();
    }
  }

  record({ name, color }, folder) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    return { id, name: name || 'Untitled world', color: color || '#c9a24a', folder: folder || `worlds/${id}`,
      kind: 'standalone', relatedTo: null, order: 0,
      avatar: null, entryCount: 0, createdAt: now, lastOpenedAt: null };
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Series are kept together in story order; the most recently used series comes first.
  list() {
    const recency = w => w.lastOpenedAt || w.createdAt;
    const groups = new Map();
    for (const w of this.data.worlds) {
      if (!groups.has(w.folder)) groups.set(w.folder, []);
      groups.get(w.folder).push(w);
    }
    return [...groups.values()]
      .map(g => ({ stories: g.sort((a, b) => a.order - b.order), latest: g.map(recency).sort().pop() }))
      .sort((a, b) => b.latest.localeCompare(a.latest))
      .flatMap(g => g.stories);
  }

  get(id) {
    return this.data.worlds.find(w => w.id === id) || null;
  }

  // Every story sharing this story's library, in story order (includes the story itself).
  seriesOf(id) {
    const w = this.get(id);
    if (!w) return [];
    return this.data.worlds.filter(x => x.folder === w.folder).sort((a, b) => a.order - b.order);
  }

  dir(id) {
    const w = this.get(id);
    if (!w) throw new Error('Unknown world');
    return path.join(this.root, w.folder);
  }

  create({ name, color, kind, relatedTo }) {
    const w = this.record({ name, color });
    const rel = KINDS.includes(kind) && kind !== 'standalone' ? this.get(relatedTo) : null;
    if (rel) {
      // Slot the new story directly before (prequel) or after (sequel) the one it relates to.
      const series = this.seriesOf(rel.id);
      const i = series.indexOf(rel);
      const neighbor = kind === 'prequel' ? series[i - 1] : series[i + 1];
      const step = kind === 'prequel' ? -1 : 1;
      w.kind = kind;
      w.relatedTo = rel.id;
      w.folder = rel.folder;
      w.order = neighbor ? (rel.order + neighbor.order) / 2 : rel.order + step;
      w.entryCount = rel.entryCount;
    }
    fs.mkdirSync(path.join(this.root, w.folder, 'images'), { recursive: true });
    this.data.worlds.push(w);
    this.save();
    return w;
  }

  update(id, patch) {
    const w = this.get(id);
    if (!w) return;
    for (const key of ['name', 'color', 'avatar', 'entryCount', 'lastOpenedAt']) {
      if (key in patch) w[key] = patch[key];
    }
    this.save();
    return w;
  }

  // The library is shared, so every story in a series shows the same entry count.
  setEntryCount(id, count) {
    const series = this.seriesOf(id);
    if (series.every(w => w.entryCount === count)) return;
    series.forEach(w => { w.entryCount = count; });
    this.save();
  }

  remove(id) {
    this.data.worlds = this.data.worlds.filter(w => w.id !== id);
    this.save();
  }
}

module.exports = { Worlds };
