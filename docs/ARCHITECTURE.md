# Architecture

## Data Storage

Outliner uses a local-first UI model backed by server persistence:

- The browser paints immediately from a scoped `localStorage` bootstrap cache.
- The authenticated SQLite snapshot hydrates the app after session verification.
- Edits are sent as row/list operations through `/api/db/ops`.
- Large operation batches fall back to full snapshot writes.
- Saves are serialized in the client so older writes cannot overtake newer writes.
- Same-row edit conflicts return `409 ROW_CONFLICT` and open a resolution modal.
- Shared lists are one server-side list viewed by every collaborator.

SQLite data is stored in `data/outliner.sqlite` by default. Browser bootstrap caches are startup accelerators; SQLite is the source of truth after hydration.

## Collaboration Model

List owners can share a list with a registered user by email, choose `Viewer` or `Editor`, change collaborator roles, remove collaborators, create or revoke a read-only public link, create named checkpoints, and restore earlier revisions.

Editors can edit shared rows, rename the shared list, and leave the shared list. Viewers can read, search, navigate, expand/collapse locally, and leave the shared list.

Collaboration is not real-time multiplayer. There are no live cursors, presence indicators, or CRDT merges.

## Project Structure

```text
.
├── .editorconfig
├── .env.example
├── .github/
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── server.js
├── docs/
├── public/
│   ├── app.js
│   ├── index.html
│   ├── markdown.js
│   ├── outline.js
│   ├── storage.js
│   └── styles.css
├── src/
│   └── server.cjs
├── SECURITY.md
├── tests/
└── data/
```

## Current Limits

- Collaboration is not live real-time editing.
- Conflict handling is row-based, not CRDT/OT.
- Public links are read-only.
- The app expects to run through the Node server; opening `public/index.html` directly bypasses auth and SQLite.
- `node:sqlite` is still experimental in Node.
