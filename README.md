# TabRows

TabRows is a minimal keyboard-first outliner inspired by Checkvist.

## Current features

- nested rows
- multi-select with Shift-click and Cmd/Ctrl-click
- `Enter` to add a row below the current subtree
- `ee` or double-click to edit a row
- `Shift+Enter` for multiline text
- `Tab` and `Shift+Tab` to indent and outdent
- `Alt+Up` and `Alt+Down` to move sibling branches
- `Left` and `Right` to collapse and expand
- per-row actions menu:
  - **Focus**: show that row as the current root
  - **Export Markdown**: export that row and its nested rows as a `.md` file
- breadcrumbs for focused view
- inline markdown rendering:
  - `**bold**`
  - `*italic*`
  - `> quote`
  - `[label](https://example.com)`
- row colours with keys `1` to `6`, `0` clears colour
- multiple named lists

## Storage

TabRows now stores lists in a real SQLite database file at:

`data/tabrows.sqlite`

The front-end talks to a small local Node server over `/api/db`.

Browser localStorage under `tabrows-db-v1` is still kept as a bootstrap/fallback cache so older in-browser data can be migrated into SQLite on first run.

## Run

1. Start the local server:
   `npm start`
2. Open:
   `http://127.0.0.1:4310`

If you open `index.html` directly, the app falls back to the browser cache and will not use the SQLite file.

## Dev notes

This project is intentionally plain HTML, CSS, JS, and a tiny Node server.
There is no framework and no build step.
