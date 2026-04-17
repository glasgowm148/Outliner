# Deployment

Outliner runs as a Node app with persistent SQLite storage. It is not a static site and should not be hosted as only `public/` files.

Good fits:

- A VPS or home server running Node behind Caddy, Nginx, or another HTTPS reverse proxy
- Small app platforms that support persistent disks, such as Fly.io, Render, Railway, Hetzner, or DigitalOcean
- A private LAN server for local-only access

Important requirements:

- Persistent storage for `data/outliner.sqlite`
- HTTPS for public internet deployments
- `OUTLINER_SECURE_COOKIES=1` when served over HTTPS
- Regular SQLite backups
- A process manager or platform restart policy

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server host |
| `PORT` | `4310` | Server port |
| `OUTLINER_DATA_DIR` | `./data` | Directory for the SQLite file |
| `OUTLINER_DB_PATH` | `./data/outliner.sqlite` | Full SQLite path |
| `OUTLINER_SECURE_COOKIES` | unset | Set to `1` behind HTTPS so session cookies are `Secure` |
| `OUTLINER_ALLOW_REGISTRATION` | `1` | Set to `0` to disable new account registration |

Examples:

```bash
PORT=5000 OUTLINER_DB_PATH=/tmp/outliner.sqlite npm start
```

```bash
HOST=0.0.0.0 PORT=4310 OUTLINER_SECURE_COOKIES=1 OUTLINER_ALLOW_REGISTRATION=0 npm start
```

## Security Notes

The server includes baseline hardening for self-hosted deployments:

- `HttpOnly`, `SameSite=Lax` session cookies
- Same-origin checks on mutating API requests
- JSON content-type checks for JSON bodies
- A trusted client header on mutating API requests
- Conservative request size limits
- Basic auth rate limiting
- Security headers and a restrictive content security policy
- Public list responses omit owner email addresses

Before running on a public host:

- Use HTTPS and set `OUTLINER_SECURE_COOKIES=1`.
- Set `OUTLINER_ALLOW_REGISTRATION=0` after creating intended accounts if open registration is not wanted.
- Back up `data/outliner.sqlite` regularly.
- Put the Node process behind a reverse proxy that enforces request/body limits.
- Treat email/password auth as basic app auth, not enterprise identity management.

## API

Mutating API routes are intended for the bundled browser client. They require same-origin requests and the `X-Outliner-Request: 1` header.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/session` | Read auth session |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/db` | Load current user snapshot |
| `PUT` | `/api/db` | Save a full snapshot |
| `POST` | `/api/db/ops` | Save operation-based row/list changes |
| `GET` | `/api/stats` | Read database stats |
| `POST` | `/api/lists/:id/share` | Share a list with a user |
| `PATCH` | `/api/lists/:id/share` | Update collaborator role |
| `DELETE` | `/api/lists/:id/share` | Remove a collaborator |
| `POST` | `/api/lists/:id/leave` | Leave a shared list |
| `POST` | `/api/lists/:id/public-link` | Enable public link |
| `DELETE` | `/api/lists/:id/public-link` | Disable public link |
| `GET` | `/api/lists/:id/revisions` | List history revisions |
| `POST` | `/api/lists/:id/revisions` | Create checkpoint |
| `POST` | `/api/lists/:id/revisions/:revisionId/restore` | Restore revision |
| `GET` | `/api/public/:token` | Read public list |

## Authentication

The auth model is deliberately simple: email and password, `HttpOnly` session cookie, per-user list ownership, and shared access through `list_shares`.

There is no email verification, password reset, OAuth, admin UI, or hosted account recovery flow.
