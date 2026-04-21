# Deployment

Outliner runs as a Node app with persistent SQLite storage. It is not a static site and should not be hosted as only `public/` files.

Good fits:

- A VPS or home server running Node behind Caddy, Nginx, or another HTTPS reverse proxy
- Small app platforms that support persistent disks, such as Fly.io, Render, Railway, Hetzner, or DigitalOcean
- A private LAN server for local-only access

Important requirements:

- Node.js `24.3+`
- Persistent storage for the SQLite database
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

## Ubuntu VPS

This runbook deploys Outliner as a `systemd` service behind Nginx on Ubuntu. It assumes:

- Ubuntu 22.04 or newer
- A domain pointing at the server, for example `outliner.example.com`
- SSH access with a sudo-capable user
- Node.js `24.3+`

### Automated Setup

From a fresh Ubuntu server:

```bash
git clone https://github.com/glasgowm148/Outliner.git
cd Outliner
sudo ./setup.sh --domain outliner.example.com --email you@example.com
```

For a local-only service without Nginx or HTTPS:

```bash
sudo ./setup.sh
```

The script installs system packages, installs Node.js `24.x` when needed, copies the app to `/opt/outliner/app`, creates `/etc/outliner/outliner.env`, starts the `outliner` systemd service, and enables daily SQLite backups. With `--domain`, it also configures Nginx. With `--email`, it requests a Let's Encrypt certificate.

After creating your first account, disable registration:

```bash
sudo sed -i 's/^OUTLINER_ALLOW_REGISTRATION=.*/OUTLINER_ALLOW_REGISTRATION=0/' /etc/outliner/outliner.env
sudo systemctl restart outliner
```

Run `sudo ./setup.sh --help` for all options.

### 1. Install Packages

Install base packages:

```bash
sudo apt update
sudo apt install -y git curl nginx sqlite3
```

Install Node.js `24.x`. One common Ubuntu option is NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

Confirm the version is `24.3.0` or newer.

### 2. Create App User and Directories

Run the app as its own system user:

```bash
sudo useradd --system --home /opt/outliner --create-home --shell /usr/sbin/nologin outliner
sudo mkdir -p /opt/outliner/app /etc/outliner /var/lib/outliner /var/backups/outliner
sudo chown -R outliner:outliner /opt/outliner /var/lib/outliner
sudo chmod 750 /var/lib/outliner
```

`/opt/outliner/app` stores the code. `/var/lib/outliner` stores the SQLite database.

### 3. Clone and Install

Replace the repository URL if you are deploying from a fork:

```bash
sudo -u outliner git clone https://github.com/glasgowm148/Outliner.git /opt/outliner/app
cd /opt/outliner/app
sudo -u outliner npm ci --omit=dev
```

### 4. Configure Environment

Create `/etc/outliner/outliner.env`:

```bash
sudo tee /etc/outliner/outliner.env >/dev/null <<'EOF'
HOST=127.0.0.1
PORT=4310
OUTLINER_DATA_DIR=/var/lib/outliner
OUTLINER_DB_PATH=/var/lib/outliner/outliner.sqlite
OUTLINER_SECURE_COOKIES=1
OUTLINER_ALLOW_REGISTRATION=1
EOF
sudo chmod 640 /etc/outliner/outliner.env
sudo chown root:outliner /etc/outliner/outliner.env
```

Keep `OUTLINER_ALLOW_REGISTRATION=1` only long enough to create your first account. After that, set it to `0` and restart the service.

### 5. Create the systemd Service

Create `/etc/systemd/system/outliner.service`:

```ini
[Unit]
Description=Outliner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=outliner
Group=outliner
WorkingDirectory=/opt/outliner/app
Environment=NODE_ENV=production
EnvironmentFile=/etc/outliner/outliner.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/outliner
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now outliner
sudo systemctl status outliner
```

Check the local app:

```bash
curl -I http://127.0.0.1:4310/
```

Logs:

```bash
journalctl -u outliner -f
```

If Node is not at `/usr/bin/node`, run `command -v node` and update `ExecStart`.

### 6. Configure Nginx

Create `/etc/nginx/sites-available/outliner`:

```nginx
server {
    listen 80;
    server_name outliner.example.com;

    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/outliner /etc/nginx/sites-enabled/outliner
sudo nginx -t
sudo systemctl reload nginx
```

### 7. Add HTTPS

Install Certbot and request a certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d outliner.example.com
```

After HTTPS is active, `OUTLINER_SECURE_COOKIES=1` must stay enabled.

### 8. Firewall

Allow SSH, HTTP, and HTTPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

### 9. First Login and Lock Registration

Open:

```text
https://outliner.example.com
```

Create your account. Then disable open registration:

```bash
sudo sed -i 's/^OUTLINER_ALLOW_REGISTRATION=.*/OUTLINER_ALLOW_REGISTRATION=0/' /etc/outliner/outliner.env
sudo systemctl restart outliner
```

### 10. Backups

Create a backup script at `/usr/local/sbin/outliner-backup`:

```bash
sudo tee /usr/local/sbin/outliner-backup >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

src="/var/lib/outliner/outliner.sqlite"
dest_dir="/var/backups/outliner"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$dest_dir"
sqlite3 "$src" ".backup '$dest_dir/outliner-$stamp.sqlite'"
find "$dest_dir" -type f -name 'outliner-*.sqlite' -mtime +30 -delete
EOF
sudo chmod 750 /usr/local/sbin/outliner-backup
```

Create `/etc/systemd/system/outliner-backup.service`:

```ini
[Unit]
Description=Back up Outliner SQLite database

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/outliner-backup
```

Create `/etc/systemd/system/outliner-backup.timer`:

```ini
[Unit]
Description=Daily Outliner backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable the timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now outliner-backup.timer
systemctl list-timers outliner-backup.timer
```

Test a backup manually:

```bash
sudo systemctl start outliner-backup.service
ls -lh /var/backups/outliner
```

Copy backups off the server regularly. A local-only backup is not enough if the VPS is lost.

### 11. Updating

```bash
cd /opt/outliner/app
sudo -u outliner git pull --ff-only
sudo -u outliner npm ci --omit=dev
sudo systemctl restart outliner
sudo systemctl status outliner
```

If the update fails, check:

```bash
journalctl -u outliner -n 100 --no-pager
```

### 12. Restore From Backup

Stop the service, replace the database, and start it again:

```bash
sudo systemctl stop outliner
sudo cp /var/backups/outliner/outliner-YYYYMMDDTHHMMSSZ.sqlite /var/lib/outliner/outliner.sqlite
sudo chown outliner:outliner /var/lib/outliner/outliner.sqlite
sudo systemctl start outliner
```

### 13. Common Checks

Check service health:

```bash
systemctl status outliner
curl -I http://127.0.0.1:4310/
curl -I https://outliner.example.com/
```

Check Nginx:

```bash
sudo nginx -t
journalctl -u nginx -n 100 --no-pager
```

Check database ownership:

```bash
ls -lah /var/lib/outliner
sudo -u outliner test -w /var/lib/outliner && echo writable
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

- Do not expose the Node process directly to the internet. Keep it bound to `127.0.0.1` behind a reverse proxy.
- Use HTTPS and set `OUTLINER_SECURE_COOKIES=1`.
- Set `OUTLINER_ALLOW_REGISTRATION=0` after creating intended accounts if open registration is not wanted.
- Back up the SQLite database regularly and copy backups off the server.
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
