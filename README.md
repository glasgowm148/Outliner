# TabRows

TabRows is a small keyboard-first outliner for nested lists. It is built with plain HTML, CSS, and JavaScript, with a tiny local Node server and SQLite for persistence.

## Features

- nested rows with fast keyboard editing
- multiple saved lists
- live search
- multi-select with `Shift` and `Cmd/Ctrl`
- inline row editing with multiline support
- indent, outdent, collapse, and expand
- move branches with keyboard shortcuts
- row colours mapped to number keys
- markdown rendering for:
  - bold
  - italic
  - blockquotes
  - bullet lists
  - links
- paste multiline outlines and convert them into nested rows
- undo and redo
- list-level actions with confirmation for destructive changes
- settings pane for shortcut and colour references
- SQLite-backed local storage
- database stats view

## Requirements

- Node.js `24.3+`

This project uses the built-in `node:sqlite` module, which is available in newer Node versions.

## Quick Start

1. Clone the repository.
2. Start the local server:
   ```bash
   npm start
   ```
3. Open:
   [http://127.0.0.1:4310](http://127.0.0.1:4310)

For local development with automatic restart:

```bash
npm run dev
```

## Storage

TabRows stores its data in a local SQLite file:

`data/tabrows.sqlite`

The browser UI talks to the local server over:

- `GET /api/db`
- `PUT /api/db`
- `GET /api/stats`

Browser `localStorage` under `tabrows-db-v1` is still used as a bootstrap fallback so older browser-only data can be loaded and then persisted into SQLite.

## Keyboard Shortcuts

- Edit selected row: `ee` or double-click
- Add row below current subtree: `Enter`
- New line inside a row: `Shift + Enter`
- Indent: `Tab`
- Outdent: `Shift + Tab`
- Move branch up: `Alt + Up`
- Move branch down: `Alt + Down`
- Collapse: `Left`
- Expand: `Right`
- Undo: `Cmd/Ctrl + Z`
- Redo: `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y`
- Select all visible rows: `Cmd/Ctrl + A`
- Colour rows: `1` to `6`
- Clear row colour: `0`

## Configuration

The server supports a few optional environment variables:

- `HOST`: server host, default `127.0.0.1`
- `PORT`: server port, default `4310`
- `TABROWS_DATA_DIR`: directory used for the SQLite database
- `TABROWS_DB_PATH`: full path to the SQLite database file

Example:

```bash
PORT=5000 TABROWS_DB_PATH=/tmp/tabrows.sqlite npm start
```

## Project Structure

- `index.html`: app shell and modal markup
- `styles.css`: UI styling
- `app.js`: client-side app logic
- `server.js`: static server and SQLite API
- `data/`: local database location

## Notes

- This is a local-first app intended to run on your machine.
- There is no authentication, user management, or sync layer.
- Opening `index.html` directly in the browser bypasses the SQLite-backed server flow.
- `node:sqlite` is still marked experimental by Node, even though it works well for this use case.

## Development

There is intentionally no framework and no build step. The app is kept small and inspectable on purpose.
