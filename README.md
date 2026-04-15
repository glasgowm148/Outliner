# TabRows

TabRows is a small keyboard-first outliner built with plain HTML, CSS, JavaScript, and a tiny Node + SQLite backend.

It is local-first, inspectable, and easy to modify. There is no framework, no build step, and no client/server split hidden behind tooling.

## Features

- Nested rows with indent, outdent, collapse, expand, and branch moves
- Fast keyboard editing with multiline row text
- Inline markdown rendering inside rows
- Multiple lists per account
- Email/password auth with isolated per-user data
- Shared editable lists between registered users
- Read-only public links for lists
- Cross-list and current-list search
- Owner-only checkpoints and restore history
- Undo/redo
- JSON backup, import, and repair
- SQLite persistence with a user-scoped bootstrap cache in `localStorage`

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

On first run, create an account on the auth screen.

## How Data Flows

- The browser renders from a local bootstrap cache immediately
- The app then hydrates from SQLite through the local server
- Authenticated saves are serialized so older writes cannot overtake newer ones
- Shared lists are the same server-side list for every collaborator

This keeps the UI responsive, but collaboration is still snapshot-based rather than real-time.

## Import And Export

TabRows supports two structural paste/import formats reliably:

1. Plain-text tab-indented outlines
2. Normal markdown list outlines

The importer is structural:

- tab-indented plain text uses indentation only
- markdown uses list markers plus indentation
- plain prose is treated as row text, not guessed hierarchy

If a format does not preserve explicit structure, TabRows will not invent it.

### Markdown Export

Row export opens a preview modal first, then lets you:

- copy the markdown
- download it

### Full Backup Export

Settings also supports full JSON backup/export for the entire database snapshot, plus import of that same format.

## Collaboration

Owners can:

- share a list with another registered user by email
- remove collaborators
- create and revoke a read-only public link
- create named checkpoints
- restore earlier revisions

Collaborators can:

- edit shared lists
- leave a shared list

Public links are read-only and do not require login.

## Markdown Support

Rows render common markdown, including:

- headings
- bold and italic
- blockquotes
- links and bare URLs
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

## Search

The search bar can search:

- the current list
- all accessible lists

Search navigation auto-expands ancestor rows as needed so matches are reachable.

## Storage And API

SQLite lives at:

```text
data/tabrows.sqlite
```

Main routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/session` | Read auth session |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/db` | Load current user data |
| `PUT` | `/api/db` | Save current user data |
| `GET` | `/api/stats` | Read database stats |
| `POST` | `/api/lists/:id/share` | Share a list with a user |
| `DELETE` | `/api/lists/:id/share` | Remove a collaborator |
| `POST` | `/api/lists/:id/leave` | Leave a shared list |
| `POST` | `/api/lists/:id/public-link` | Enable public link |
| `DELETE` | `/api/lists/:id/public-link` | Disable public link |
| `GET` | `/api/lists/:id/revisions` | List checkpoints/history |
| `POST` | `/api/lists/:id/revisions` | Create checkpoint |
| `POST` | `/api/lists/:id/revisions/:revisionId/restore` | Restore revision |
| `GET` | `/api/public/:token` | Read public list |

## Authentication

The auth model is intentionally simple:

- email + password
- `HttpOnly` session cookie
- one isolated dataset per user
- the first registered account can claim legacy pre-auth data already present in the database

There is no email verification, password reset, or OAuth yet.

## Settings

From the UI you can:

- inspect keyboard shortcuts and colour keys
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
├── app.js                    # Client app logic
├── index.html                # App shell
├── markdown.js               # Markdown rendering helpers
├── outline.js                # Structural paste/import parsing
├── server.cjs                # Node server and SQLite API
├── server.js                 # Thin ESM entry wrapper
├── storage.js                # Shared client storage helpers
├── styles.css                # UI styling
├── tests/smoke.test.mjs      # End-to-end smoke coverage
├── tests/unit/markdown.test.mjs
├── tests/unit/outline.test.mjs
├── tests/unit/storage.test.mjs
└── data/
```

## Current Limits

- No real-time collaboration or conflict resolution
- Shared-list edits are whole-snapshot and last-write-wins
- Public links are read-only
- Opening `index.html` directly bypasses the server-backed flow
- `node:sqlite` is still experimental in Node, even though it works well here

