# Omniscient

A desktop app for plotting stories: arrange events on a board, connect them, put your
characters and places into each scene, and keep notes as the plot takes shape.

## Use

- **Worlds** – the app opens on a profile screen, one tile per story (arrow keys + Enter, E to edit).
  A new story is **standalone** (its own library) or a **prequel/sequel** of another: a series shares one
  library of characters, places and lore, while each story keeps its own events and plot board.
- **Plot board** (home) – event cards on a canvas. Double-click to add an event; drag cards to arrange;
  drag the dot on a card's right edge onto another event to connect them, or into empty space to create
  the next event already connected. Click a connection to label it (causes, foreshadows, meanwhile…).
  Sticky notes hold loose ideas and can be turned into events. Color events by plot thread.
  **Arrange** lays events out left to right following their connections. Scroll to zoom, drag the
  background to pan, Delete removes the selected card or connection.
- **Cast panel** (left) – characters, locations, factions, items, creatures and lore. Drag one onto an
  event card to put them in that scene; click for details.
- **Details panel** (right) – edits whatever is selected: when it happens, summary, thread color, who's
  in the scene, plot links, notes (type `[[` to link anything), tags and fields, images, and
  "Mentioned in" backlinks. For characters it lists every event they appear in.
- **Codex, Relationship web, Timeline** – the cast as image cards, who-is-related-to-whom as a graph,
  and events in story order (drag to reorder).

| Shortcut | Action |
| --- | --- |
| Double-click board | New event |
| Ctrl+O | Find anything (or create it by name) |
| Ctrl+P | All commands |
| Ctrl+N | New event, character, place… |
| Ctrl+1 … Ctrl+4 | Plot board, Codex, Relationship web, Timeline |
| Delete | Delete the selected card or connection (on the board) |
| Esc | Clear the selection |
| Ctrl+[ / Ctrl+] | Hide or show the cast / details panel |

## Where data lives

`%APPDATA%\Omniscient\`
- `worlds.json` – the list of worlds (stories), their pictures' file names and which series they belong to
- `library\` – the original library from before worlds existed (shown as "My World")
- `worlds\<id>\` – one folder per standalone story or series:
  `omniscient.sqlite` (entries, connections, board positions, sticky notes, captions), `images\`, and world pictures

Use **Back up library…** in the sidebar to copy the open world's folder (the whole series) somewhere safe.
Set the `OMNISCIENT_DATA_DIR` environment variable to keep everything elsewhere.

## Develop

```
npm install
npm start        # run the app
npm run build:editor  # rebuild src/renderer/vendor/editor.js after changing src/editor/
npm run dist     # build dist\Omniscient Setup <version>.exe
```

Electron + sql.js (SQLite compiled to WebAssembly, no native build step) + Cytoscape.js (graph)
+ CodeMirror 6 (notes editor, bundled with esbuild).
