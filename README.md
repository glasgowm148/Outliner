# TabRows

TabRows is a small keyboard-first outliner built with plain HTML, CSS, JavaScript, and a tiny Node + SQLite backend.

It is designed to stay local-first, inspectable, and easy to modify.

## What It Does

- Nested rows with indent, outdent, collapse, expand, and branch moves
- Fast keyboard editing with multiline row support
- Inline markdown rendering inside rows
- Multiple saved lists per account
- Email/password auth with per-user data
- Undo/redo
- JSON backup, import, and repair
- SQLite persistence with a bootstrap cache in `localStorage`

## Quick Start

Requirements:

- Node.js `24.3+`

Run:

```bash
npm start
```

Open:

[http://127.0.0.1:4310](http://127.0.0.1:4310)

Useful scripts:

```bash
npm run dev
npm test
```

On first run, create an account in the auth screen. Each account gets its own lists and rows.

## Import And Export

TabRows supports two structural paste/import formats well:

1. Plain-text tab-indented outlines
2. Normal markdown list outlines

The importer is intentionally structural now:

- tab-indented plain text is parsed from indentation only
- markdown is parsed from list markers plus indentation
- plain prose is treated as row text, not guessed structure

That means round-tripping is reliable when the exported format still contains explicit structure.

### Markdown Export

Row export opens a preview modal first, then lets you:

- copy the markdown
- download it as a file

### Backup Export

Settings also supports full JSON backup/export for the whole database snapshot.

## Markdown Support

Rows render common markdown inline, including:

- headings
- bold and italic
- blockquotes
- links and raw URLs
- ordered and unordered lists
- tables
- inline images

This is intentionally lightweight, not a full markdown engine.

## Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Edit selected row | `ee` or double-click |
| Add row below current subtree | `Enter` |
| New line inside row | `Shift + Enter` |
| Indent / outdent | `Tab` / `Shift + Tab` |
| Move branch | `Alt + Up` / `Alt + Down` |
| Collapse / expand | `Left` / `Right` |
| Undo | `Cmd/Ctrl + Z` |
| Redo | `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y` |
| Select all visible rows | `Cmd/Ctrl + A` |
| Apply colour | `1` to `6` |
| Clear colour | `0` |

## Storage Model

TabRows stores users, sessions, lists, and rows in SQLite:

```text
data/tabrows.sqlite
```

The browser talks to the local server through:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/session` | Read auth session |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/db` | Load current user data |
| `PUT` | `/api/db` | Save current user data |
| `GET` | `/api/stats` | Read database stats |

The app also keeps a user-scoped bootstrap cache in `localStorage` so the UI can render immediately before SQLite finishes loading.

## Authentication

The auth flow is intentionally simple:

- email + password
- `HttpOnly` session cookie
- one isolated dataset per user
- first registered account claims any legacy pre-auth data already present in the database

There is no email verification, password reset, OAuth, or third-party identity provider yet.

## Settings

From the UI you can:

- view keyboard shortcuts and colour keys
- inspect database stats
- export a JSON backup
- import a JSON backup
- normalize and rewrite the current snapshot with `Repair structure`

## Configuration

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server host |
| `PORT` | `4310` | Server port |
| `TABROWS_DATA_DIR` | `./data` | Directory for the SQLite file |
| `TABROWS_DB_PATH` | `./data/tabrows.sqlite` | Full SQLite path |
| `TABROWS_SECURE_COOKIES` | unset | Set to `1` behind HTTPS so session cookies are `Secure` |

Example:

```bash
PORT=5000 TABROWS_DB_PATH=/tmp/tabrows.sqlite npm start
```

## Project Structure

```text
.
├── app.js            # Client app logic
├── index.html        # App shell
├── markdown.js       # Markdown rendering helpers
├── outline.js        # Paste/import parsing and merge helpers
├── server.cjs        # Node server and SQLite API
├── server.js         # Thin ESM entry wrapper
├── storage.js        # Shared client storage helpers
├── styles.css        # UI styling
├── tests/smoke.test.mjs
└── data/
```

## Current Limits

- No real-time collaboration
- Same-account concurrent edits are last-write-wins
- No list sharing between users yet
- Opening `index.html` directly bypasses the server-backed flow
- `node:sqlite` is still experimental in Node, even though it works well here

## Development Notes

The codebase is deliberately small:

- no framework
- no build step
- one server process
- one SQLite database

That makes it easy to inspect and patch, but it also means some behavior is intentionally straightforward rather than heavily abstracted.
