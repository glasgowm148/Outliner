#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="outliner"
APP_USER="outliner"
APP_GROUP=""
APP_DIR="/opt/outliner/app"
DATA_DIR="/var/lib/outliner"
BACKUP_DIR="/var/backups/outliner"
ENV_DIR="/etc/outliner"
ENV_FILE="/etc/outliner/outliner.env"
SERVICE_FILE="/etc/systemd/system/outliner.service"
BACKUP_SCRIPT="/usr/local/sbin/outliner-backup"
BACKUP_SERVICE_FILE="/etc/systemd/system/outliner-backup.service"
BACKUP_TIMER_FILE="/etc/systemd/system/outliner-backup.timer"
PORT="4310"
DOMAIN=""
EMAIL=""
REGISTRATION="1"
SECURE_COOKIES="auto"
SETUP_NGINX="auto"
SETUP_CERTBOT="auto"
SETUP_BACKUPS="1"
INSTALL_PACKAGES="1"
INSTALL_NODE="auto"
FORCE="0"

usage() {
  cat <<'EOF'
Usage:
  sudo ./setup.sh [options]

Common:
  sudo ./setup.sh
  sudo ./setup.sh --domain outliner.example.com --email you@example.com
  sudo ./setup.sh --domain outliner.example.com --email you@example.com --registration off

Options:
  --domain NAME              Configure Nginx for this domain.
  --email ADDRESS            Email for Let's Encrypt when Certbot is enabled.
  --app-dir DIR              App install directory. Default: /opt/outliner/app
  --data-dir DIR             SQLite data directory. Default: /var/lib/outliner
  --backup-dir DIR           Backup directory. Default: /var/backups/outliner
  --port PORT                Local app port. Default: 4310
  --user USER                System user. Default: outliner
  --registration on|off      Allow new signups. Default: on
  --secure-cookies on|off    Override secure cookie setting. Default: on with Certbot, otherwise off
  --nginx / --no-nginx       Enable or skip Nginx. Default: enabled with --domain
  --certbot / --no-certbot   Enable or skip Certbot. Default: enabled with --domain and --email
  --backups / --no-backups   Enable or skip daily SQLite backups. Default: enabled
  --install-node / --skip-node
                             Install Node.js 24.x if needed, or never install it.
  --skip-packages            Do not apt install packages.
  --force                    Overwrite existing env and Nginx files.
  -h, --help                 Show this help.
EOF
}

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

as_bool() {
  case "${1:-}" in
    on|yes|true|1) printf '1' ;;
    off|no|false|0) printf '0' ;;
    *) die "Expected on/off, got: $1" ;;
  esac
}

need_value() {
  [[ $# -ge 2 && "${2:-}" != --* ]] || die "$1 requires a value."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) need_value "$@"; DOMAIN="$2"; shift 2 ;;
    --email) need_value "$@"; EMAIL="$2"; shift 2 ;;
    --app-dir) need_value "$@"; APP_DIR="$2"; shift 2 ;;
    --data-dir) need_value "$@"; DATA_DIR="$2"; shift 2 ;;
    --backup-dir) need_value "$@"; BACKUP_DIR="$2"; shift 2 ;;
    --port) need_value "$@"; PORT="$2"; shift 2 ;;
    --user) need_value "$@"; APP_USER="$2"; shift 2 ;;
    --registration) need_value "$@"; REGISTRATION="$(as_bool "$2")"; shift 2 ;;
    --secure-cookies) need_value "$@"; SECURE_COOKIES="$(as_bool "$2")"; shift 2 ;;
    --nginx) SETUP_NGINX="1"; shift ;;
    --no-nginx) SETUP_NGINX="0"; shift ;;
    --certbot) SETUP_CERTBOT="1"; shift ;;
    --no-certbot) SETUP_CERTBOT="0"; shift ;;
    --backups) SETUP_BACKUPS="1"; shift ;;
    --no-backups) SETUP_BACKUPS="0"; shift ;;
    --install-node) INSTALL_NODE="1"; shift ;;
    --skip-node) INSTALL_NODE="0"; shift ;;
    --skip-packages) INSTALL_PACKAGES="0"; shift ;;
    --force) FORCE="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run with sudo or as root."
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number."
(( PORT >= 1 && PORT <= 65535 )) || die "--port must be between 1 and 65535."
[[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || die "--user is not a valid system username."
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  die "--domain must be a plain DNS name, for example outliner.example.com."
fi

APP_DIR="$(realpath -m "$APP_DIR")"
DATA_DIR="$(realpath -m "$DATA_DIR")"
BACKUP_DIR="$(realpath -m "$BACKUP_DIR")"

for dir in "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"; do
  case "$dir" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/sys|/tmp|/usr|/var)
      die "Refusing unsafe directory: $dir"
      ;;
  esac
done

if [[ "$APP_DIR" == /home/* || "$APP_DIR" == /root/* ]]; then
  die "--app-dir must not be under /home or /root because the systemd service protects home directories."
fi

if [[ "$SETUP_NGINX" == "auto" ]]; then
  [[ -n "$DOMAIN" ]] && SETUP_NGINX="1" || SETUP_NGINX="0"
fi

if [[ "$SETUP_CERTBOT" == "auto" ]]; then
  [[ -n "$DOMAIN" && -n "$EMAIL" && "$SETUP_NGINX" == "1" ]] && SETUP_CERTBOT="1" || SETUP_CERTBOT="0"
fi

if [[ "$SECURE_COOKIES" == "auto" ]]; then
  [[ "$SETUP_CERTBOT" == "1" ]] && SECURE_COOKIES="1" || SECURE_COOKIES="0"
fi

if [[ "$SETUP_CERTBOT" == "1" && -z "$EMAIL" ]]; then
  die "--certbot requires --email."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MINIMUM="24.3.0"

[[ -f "$SCRIPT_DIR/package.json" ]] || die "Run this from the Outliner repository checkout."
[[ -f "$SCRIPT_DIR/server.js" ]] || die "server.js was not found next to setup.sh."

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    warn "This script is written for Ubuntu; detected ${PRETTY_NAME:-unknown}."
  fi
fi

need_command() {
  command -v "$1" >/dev/null 2>&1
}

node_ok() {
  need_command node || return 1
  local version
  version="$(node --version | sed 's/^v//')"
  dpkg --compare-versions "$version" ge "$NODE_MINIMUM"
}

disable_obsolete_nodesource_sources() {
  local stamp file disabled_any="0"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  shopt -s nullglob

  for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [[ -f "$file" ]] || continue
    if ! grep -Eq 'deb\.nodesource\.com/node_[0-9]+\.x' "$file"; then
      continue
    fi

    if grep -E '^[[:space:]]*[^#].*deb\.nodesource\.com/node_[0-9]+\.x' "$file" | grep -vq 'deb\.nodesource\.com/node_24\.x'; then
      warn "Disabling obsolete NodeSource apt entry in $file"
      sed -i".bak-outliner-$stamp" -E '/^[[:space:]]*#/!{/deb\.nodesource\.com\/node_[0-9]+\.x/ { /deb\.nodesource\.com\/node_24\.x/! s/^/# disabled by Outliner setup: / }}' "$file"
      disabled_any="1"
    fi
  done

  for file in /etc/apt/sources.list.d/*.sources; do
    [[ -f "$file" ]] || continue
    if grep -Eq 'deb\.nodesource\.com/node_[0-9]+\.x' "$file" && ! grep -Eq 'deb\.nodesource\.com/node_24\.x' "$file"; then
      warn "Disabling obsolete NodeSource apt source $file"
      mv "$file" "$file.disabled-by-outliner-$stamp"
      disabled_any="1"
    fi
  done

  if [[ "$disabled_any" == "1" ]]; then
    warn "Old NodeSource backups were left next to the original files."
  fi
}

install_packages() {
  [[ "$INSTALL_PACKAGES" == "1" ]] || return 0

  log "Installing base packages"
  export DEBIAN_FRONTEND=noninteractive
  disable_obsolete_nodesource_sources
  apt-get update
  apt-get install -y ca-certificates curl git rsync sqlite3

  if [[ "$SETUP_NGINX" == "1" ]]; then
    apt-get install -y nginx
  fi

  if [[ "$SETUP_CERTBOT" == "1" ]]; then
    apt-get install -y certbot python3-certbot-nginx
  fi
}

install_node_if_needed() {
  if node_ok; then
    log "Node.js $(node --version) is installed"
    return 0
  fi

  [[ "$INSTALL_NODE" != "0" ]] || die "Node.js $NODE_MINIMUM+ is required."

  log "Installing Node.js 24.x"
  local installer="/tmp/nodesource-setup-24.x.sh"
  disable_obsolete_nodesource_sources
  curl -fsSL https://deb.nodesource.com/setup_24.x -o "$installer"
  bash "$installer"
  apt-get install -y nodejs
  rm -f "$installer"
  node_ok || die "Node.js $NODE_MINIMUM+ was not installed successfully."
}

create_user_and_dirs() {
  log "Creating user and directories"

  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --home "/opt/outliner" --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi

  APP_GROUP="$(id -gn "$APP_USER")"
  mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$ENV_DIR"
  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
  chmod 750 "$DATA_DIR" "$BACKUP_DIR"
}

sync_app() {
  log "Copying app files to $APP_DIR"

  local source_dir
  source_dir="$(cd "$SCRIPT_DIR" && pwd)"
  local target_dir
  target_dir="$(cd "$APP_DIR" && pwd)"

  if [[ "$source_dir" != "$target_dir" ]]; then
    rsync -a --delete \
      --exclude='.git' \
      --exclude='.github' \
      --exclude='node_modules' \
      --exclude='data' \
      --exclude='.tmp' \
      --exclude='coverage' \
      --exclude='.nyc_output' \
      --exclude='playwright-report' \
      --exclude='test-results' \
      "$source_dir/" "$APP_DIR/"
  fi

  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
}

install_app_dependencies() {
  log "Installing production dependencies"
  runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" ci --omit=dev
}

write_env_file() {
  log "Writing environment config"

  if [[ -e "$ENV_FILE" && "$FORCE" != "1" ]]; then
    warn "$ENV_FILE already exists; leaving it unchanged. Use --force to overwrite."
    return 0
  fi

  cat >"$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=$PORT
OUTLINER_DATA_DIR=$DATA_DIR
OUTLINER_DB_PATH=$DATA_DIR/outliner.sqlite
OUTLINER_SECURE_COOKIES=$SECURE_COOKIES
OUTLINER_ALLOW_REGISTRATION=$REGISTRATION
EOF
  chown "root:$APP_GROUP" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
}

write_systemd_service() {
  log "Writing systemd service"

  local node_path
  node_path="$(command -v node)"

  cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=Outliner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=$node_path server.js
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$APP_NAME"
  systemctl restart "$APP_NAME"
}

write_backup_timer() {
  [[ "$SETUP_BACKUPS" == "1" ]] || return 0
  log "Installing daily backup timer"

  cat >"$BACKUP_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail

src="$DATA_DIR/outliner.sqlite"
dest_dir="$BACKUP_DIR"
stamp="\$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f "\$src" ]]; then
  echo "Database not found: \$src" >&2
  exit 0
fi

mkdir -p "\$dest_dir"
sqlite3 "\$src" ".backup '\$dest_dir/outliner-\$stamp.sqlite'"
find "\$dest_dir" -type f -name 'outliner-*.sqlite' -mtime +30 -delete
EOF
  chmod 750 "$BACKUP_SCRIPT"
  chown root:root "$BACKUP_SCRIPT"

  cat >"$BACKUP_SERVICE_FILE" <<EOF
[Unit]
Description=Back up Outliner SQLite database

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_GROUP
ExecStart=$BACKUP_SCRIPT
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=$DATA_DIR
ReadWritePaths=$BACKUP_DIR
EOF

  cat >"$BACKUP_TIMER_FILE" <<'EOF'
[Unit]
Description=Daily Outliner backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now outliner-backup.timer
}

write_nginx_site() {
  [[ "$SETUP_NGINX" == "1" ]] || return 0
  [[ -n "$DOMAIN" ]] || die "--nginx requires --domain."

  log "Configuring Nginx for $DOMAIN"

  local site_available="/etc/nginx/sites-available/outliner"
  local site_enabled="/etc/nginx/sites-enabled/outliner"

  if [[ -e "$site_available" && "$FORCE" != "1" ]]; then
    warn "$site_available already exists; leaving it unchanged. Use --force to overwrite."
  else
    cat >"$site_available" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  fi

  ln -sfn "$site_available" "$site_enabled"
  nginx -t
  systemctl reload nginx
}

run_certbot() {
  [[ "$SETUP_CERTBOT" == "1" ]] || return 0
  log "Requesting HTTPS certificate"
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"
}

check_service() {
  log "Checking service"
  systemctl is-active --quiet "$APP_NAME" || {
    systemctl status "$APP_NAME" --no-pager || true
    die "Outliner service is not active."
  }

  curl -fsSI "http://127.0.0.1:$PORT/" >/dev/null || die "Local health check failed."
}

print_summary() {
  local url="http://127.0.0.1:$PORT"
  if [[ -n "$DOMAIN" ]]; then
    [[ "$SETUP_CERTBOT" == "1" ]] && url="https://$DOMAIN" || url="http://$DOMAIN"
  fi

  cat <<EOF

Outliner setup complete.

URL: $url
Service: systemctl status outliner
Logs: journalctl -u outliner -f
Config: $ENV_FILE
Database: $DATA_DIR/outliner.sqlite
Backups: $BACKUP_DIR

After creating your first account, disable registration:
  sudo sed -i 's/^OUTLINER_ALLOW_REGISTRATION=.*/OUTLINER_ALLOW_REGISTRATION=0/' $ENV_FILE
  sudo systemctl restart outliner

EOF
}

install_packages
install_node_if_needed
create_user_and_dirs
sync_app
install_app_dependencies
write_env_file
write_systemd_service
write_backup_timer
write_nginx_site
run_certbot
check_service
print_summary
