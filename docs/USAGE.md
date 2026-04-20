# Usage

## Quick Start

Requirements:

- Node.js `24.3+`
- npm

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310), then create an account on the auth screen.

Development server:

```bash
npm run dev
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Run the app with `node server.js` |
| `npm run dev` | Run with Node watch mode |
| `npm run check:syntax` | Syntax-check server and browser modules |
| `npm run check:hygiene` | Check tracked files for conflict markers and trailing whitespace |
| `npm run check` | Run syntax checks, tests, production dependency audit, and hygiene checks |
| `npm run clean` | Remove generated local test artifacts |
| `npm test` | Run smoke, unit, and browser tests |
| `npm run test:smoke` | Run API/server smoke tests |
| `npm run test:unit` | Run unit tests |
| `npm run test:e2e` | Run Playwright browser tests |

If Playwright browsers are not installed yet:

```bash
npx playwright install
```

## Import And Export

Outliner supports two structural paste/import formats:

- Plain-text tab-indented outlines
- Normal markdown list outlines

The importer uses explicit structure only. Tab-indented plain text uses indentation; markdown outlines use list markers plus indentation; plain prose stays as row text. Emojis, headings, bold text, and words are not used to guess hierarchy.

```text
Project
	Planning
		Scope
		Questions
	Build
```

```markdown
- Project
  - Planning
    - Scope
    - Questions
  - Build
```

Row markdown export opens a preview modal with copy and download actions. Full JSON backup import/export is available from Settings and is intended for restore or migration.

## Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Edit selected row | `ee` or double-click |
| Add row below current subtree | `Enter` |
| New line inside row | `Shift + Enter` |
| Bold / italic / link selected row text | `Cmd/Ctrl + B` / `Cmd/Ctrl + I` / `Cmd/Ctrl + K` |
| Indent / outdent | `Tab` / `Shift + Tab` |
| Move branch | `Alt + Up` / `Alt + Down` |
| Collapse / expand | `Left` / `Right` |
| Undo | `Cmd/Ctrl + Z` |
| Redo | `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y` |
| Select all visible rows | `Cmd/Ctrl + A` |
| Apply colour | `1` to `9` |
| Clear colour | `0` |

## Settings

The account menu provides keyboard and colour references, database stats, JSON backup export/import, structure repair, and sign out.

The list menu provides history and checkpoints, sharing controls, public-link controls, and delete or leave actions.

## Troubleshooting

- If the page loads but data does not persist, check that the server is running and `data/` is writable.
- If Playwright tests fail on a fresh machine, run `npx playwright install`.
- If public links load over HTTPS but login does not persist, check `OUTLINER_SECURE_COOKIES` and reverse-proxy headers.
- If markdown import nests incorrectly, verify the source preserves list markers or tab indentation.
