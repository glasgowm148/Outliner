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

## How data is stored right now

The current build stores all lists in browser localStorage under:

`tabrows-db-v1`

That is fine for a prototype, but it is not the right long-term home for important lists.

## Smarter storage options

### Best immediate upgrade
Add **JSON export/import** for full-database backups.

Why:

- easy to implement
- human-readable
- portable
- gives users a real backup file outside the browser

### Best serious local-app path
Wrap TabRows in **Tauri** and store lists in **SQLite**.

Why:

- durable local storage
- one real database file
- transactional writes
- easy backups
- straightforward path to search, history, tags, backlinks, and sync later

## Recommended next step

1. Keep the current browser build for fast iteration.
2. Add full JSON export/import next.
3. Move to Tauri + SQLite when the data model settles.

## Dev notes

This project is intentionally plain HTML, CSS, and JS.
There is no framework and no build step.

Open `index.html` in a browser to run it.
