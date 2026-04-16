# Contributing

TabRows is intentionally small and inspectable. Keep changes direct, dependency-light, and easy to audit.

## Setup

```bash
npm install
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310).

## Before Opening A Pull Request

Run:

```bash
npm run check
git diff --check
```

## Development Guidelines

- Prefer plain JavaScript, HTML, and CSS over new tooling.
- Avoid new runtime dependencies unless they remove more risk than they add.
- Keep markdown import structural. Do not infer hierarchy from emojis, headings, bold text, or wording.
- Preserve read-only behavior for public lists and viewer collaborators.
- Add tests for parser, storage, sharing, auth, and permission changes.
- Do not commit local databases, `.env` files, screenshots with private data, or generated Playwright artifacts.

## Security-Sensitive Changes

For auth, sharing, public links, markdown rendering, or server request handling:

- Add or update smoke tests.
- Verify public list responses do not leak owner email addresses or private collaborator data.
- Verify mutating API routes remain same-origin protected.
- Verify user-generated markdown remains sanitized.
