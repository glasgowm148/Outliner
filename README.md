# 🗂️ TabRows

> A small, keyboard-first outliner for nested lists.
> Built with plain HTML, CSS, and JavaScript, backed by a tiny local Node server and SQLite.

## Why TabRows?

TabRows is designed to stay fast, inspectable, and local-first.

- ⌨️ Keyboard-first editing for fast outlining
- 🌲 Nested rows with collapse, expand, indent, and branch moves
- 🔎 Live search across the current list
- 📝 Inline markdown rendering with smart paste support
- 🗂️ Multiple saved lists
- ↩️ Undo and redo for structural changes
- 🗄️ SQLite-backed local persistence
- ⚙️ Built-in settings and database stats views

## Highlights

### Editing

- Edit with `ee` or double-click
- Create multiline rows
- Select single rows, ranges, or multiple rows
- Move branches with `Alt + Up` / `Alt + Down`
- Apply row colours with number keys

### Markdown

TabRows renders common markdown directly inside rows:

- headings: `#` to `######`
- bold and italic
- blockquotes
- bullet lists
- links and raw URLs

### Paste Import

Paste a multiline outline and TabRows can turn it into nested rows.

- understands paragraph splits
- understands markdown bullets
- preserves nested outline structure
- attempts to merge pasted content into the current branch when the pasted path already matches the surrounding context

## Requirements

- Node.js `24.3+`

TabRows uses the built-in `node:sqlite` module, so it requires a recent Node release.

## Quick Start

```bash
npm start
```

Then open:

[http://127.0.0.1:4310](http://127.0.0.1:4310)

For development with automatic restart:

```bash
npm run dev
```

## Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Edit selected row | `ee` or double-click |
| Add row below current subtree | `Enter` |
| New line inside a row | `Shift + Enter` |
| Indent | `Tab` |
| Outdent | `Shift + Tab` |
| Move branch up | `Alt + Up` |
| Move branch down | `Alt + Down` |
| Collapse focused row | `Left` |
| Expand focused row | `Right` |
| Undo | `Cmd/Ctrl + Z` |
| Redo | `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y` |
| Select all visible rows | `Cmd/Ctrl + A` |
| Apply colours | `1` to `6` |
| Clear colour | `0` |

## Storage

TabRows stores its main data in a local SQLite file:

```text
data/tabrows.sqlite
```

The browser UI talks to the local server through:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/db` | Load all lists and rows |
| `PUT` | `/api/db` | Save the full app state |
| `GET` | `/api/stats` | Read database stats |

`localStorage` key `tabrows-db-v1` is still used as a bootstrap cache so older browser-only data can be loaded and then persisted into SQLite.

## Configuration

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server host |
| `PORT` | `4310` | Server port |
| `TABROWS_DATA_DIR` | `./data` | Directory used for the SQLite database |
| `TABROWS_DB_PATH` | `./data/tabrows.sqlite` | Full path to the SQLite database file |

Example:

```bash
PORT=5000 TABROWS_DB_PATH=/tmp/tabrows.sqlite npm start
```

## Project Structure

```text
.
├── app.js       # Client-side application logic
├── index.html   # App shell and modal markup
├── server.cjs   # Static server and SQLite API
├── server.js    # Thin ESM entry wrapper for Node
├── styles.css   # UI styling
├── data/        # Local database location
└── package.json # Run scripts
```

## Notes

- TabRows is a local app intended to run on your machine.
- There is no authentication, sync, or multi-user layer.
- Opening `index.html` directly bypasses the SQLite-backed server flow.
- `node:sqlite` is still marked experimental in Node, even though it works well here.
- The project intentionally has no framework and no build step.

## Development

The codebase is intentionally small and direct:

- plain HTML
- plain CSS
- plain JavaScript
- one small Node server
- one SQLite database

That keeps the app easy to inspect, patch, and run without tooling overhead.
