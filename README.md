<h1 align="center">
  <br>
  🗂️
  <br>
  Outliner
</h1>

<p align="center">
  <strong>A keyboard-first outliner with sharing, public links, Markdown import/export, and SQLite persistence.</strong>
</p>

<p align="center">
  <img alt="Node.js 24.3+" src="https://img.shields.io/badge/Node.js-24.3%2B-5FA04E?logo=nodedotjs&logoColor=white">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-d6a04f"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="docs/USAGE.md">Usage</a>
  ·
  <a href="docs/DEPLOYMENT.md">Deployment</a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

Outliner is a small self-hosted outliner built with plain browser JavaScript and a Node + SQLite backend. It focuses on fast keyboard editing, portable Markdown/JSON exports, simple sharing, and local persistence you can back up.

<p align="center">
  <img src="docs/assets/social-preview.png" alt="Outliner preview" width="720">
</p>

## Features

- Nested rows with indent, outdent, collapse, expand, branch move, colour, and multi-select
- Fast keyboard editing with multiline row text
- Inline Markdown rendering for headings, emphasis, quotes, links, lists, tables, bare URLs, and images
- Multiple lists per account
- Email/password authentication with isolated per-user data
- Shared lists with `viewer` and `editor` collaborator roles
- Read-only public links that do not require login
- Current-list and all-list search with highlighted matches
- Undo/redo for local row changes
- Owner-only history, named checkpoints, restore previews, and revision restore
- Markdown row export through a preview modal with copy/download actions
- JSON backup import/export for the full database snapshot

## Quick Start

Requirements:

- Node.js `24.3+`
- npm

```bash
npm install
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310), then create an account.

## Docs

- [Usage](docs/USAGE.md): scripts, import/export, shortcuts, settings, and troubleshooting.
- [Deployment](docs/DEPLOYMENT.md): hosting requirements, configuration, security notes, API, and auth model.
- [Architecture](docs/ARCHITECTURE.md): storage flow, collaboration model, project layout, and current limits.
- [Contributing](CONTRIBUTING.md): local workflow and pull request expectations.
- [Security](SECURITY.md): vulnerability reporting and deployment baseline.

## Development

Run the full suite:

```bash
npm test
```

Run all project checks:

```bash
npm run check
```

If Playwright browsers are missing on a fresh machine:

```bash
npx playwright install
```

## License

[MIT](LICENSE)
