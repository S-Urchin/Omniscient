// Markdown editor for entry notes, bundled by `npm run build:editor` into
// src/renderer/vendor/editor.js and exposed as window.OmniEditor.
import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, placeholder, drawSelection, highlightActiveLine, ViewPlugin,
  Decoration, MatchDecorator,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

const WIKILINK = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g;

const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '700', color: 'var(--text)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--text)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.monospace, fontFamily: 'Consolas, monospace', color: '#d6a77a' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--faint)' },
  { tag: t.list, color: 'var(--accent)' },
]);

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', fontSize: '16px', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7', overflow: 'visible' },
  '.cm-content': { padding: '0 0 40vh', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-placeholder': { color: 'var(--faint)', fontStyle: 'italic' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '260px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '5px 10px !important', display: 'flex', alignItems: 'center', gap: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--panel-2)', color: 'var(--text)' },
  '.cm-completionDetail': { marginLeft: 'auto', color: 'var(--muted)', fontStyle: 'normal', fontSize: '12px' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line)' },
}, { dark: true });

export function create(parent, options) {
  const { doc = '', onChange, entries, resolve, onOpenLink, onCursorLink } = options;

  // Highlights [[links]]; links to entries that don't exist yet are styled differently.
  const linkPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.matcher = new MatchDecorator({
        regexp: WIKILINK,
        decoration: m => Decoration.mark({
          class: resolve(m[1].trim()) ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-missing',
          attributes: { 'data-link': m[1].trim(), title: 'Ctrl+click to open' },
        }),
      });
      this.decorations = this.matcher.createDeco(view);
    }
    update(u) { this.decorations = this.matcher.updateDeco(u, this.decorations); }
  }, { decorations: v => v.decorations });

  // Typing [[ suggests entry names.
  const linkCompletion = ctx => {
    const before = ctx.matchBefore(/\[\[[^\[\]\n|]*/);
    if (!before) return null;
    const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
    return {
      from: before.from + 2,
      validFor: /^[^\[\]\n|]*$/,
      options: entries().map(e => ({
        label: e.name,
        detail: e.type,
        apply: (view, completion, from, to) => {
          const close = after === ']]' ? '' : ']]';
          view.dispatch({
            changes: { from, to, insert: completion.label + close },
            selection: { anchor: from + completion.label.length + 2 },
          });
        },
      })),
    };
  };

  const linkAt = (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(WIKILINK)) {
      const start = line.from + m.index;
      if (pos >= start && pos <= start + m[0].length) return m[1].trim();
    }
    return null;
  };

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        closeBrackets(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownStyle),
        autocompletion({ override: [linkCompletion], icons: false }),
        linkPlugin,
        theme,
        placeholder('Start writing… type [[ to link a character, place or anything else.'),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
        EditorView.updateListener.of(u => {
          if (u.docChanged) onChange(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) onCursorLink?.(linkAt(u.view, u.state.selection.main.head));
        }),
        EditorView.domEventHandlers({
          mousedown(e, v) {
            if (!(e.ctrlKey || e.metaKey)) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            const name = pos != null && linkAt(v, pos);
            if (!name) return false;
            e.preventDefault();
            onOpenLink(name, e.shiftKey);
            return true;
          },
        }),
      ],
    }),
  });

  return {
    view,
    focus: () => view.focus(),
    getValue: () => view.state.doc.toString(),
    // Replaces the text (e.g. after links were renamed elsewhere) without moving the cursor far.
    setValue(text) {
      if (text === view.state.doc.toString()) return;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } });
    },
    // Re-runs link decoration, e.g. after an entry is created so a link stops showing as missing.
    refresh: () => view.dispatch({ changes: { from: 0, to: 0, insert: '' } }),
    jumpToLine(n) {
      const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 80 }) });
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}
