const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parsePort(process.env.PORT, 4310);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');
const DATA_DIR = process.env.OUTLINER_DATA_DIR || process.env.TABROWS_DATA_DIR || DEFAULT_DATA_DIR;
const EXPLICIT_DB_PATH = process.env.OUTLINER_DB_PATH || process.env.TABROWS_DB_PATH;
const DEFAULT_DB_PATH = path.join(path.resolve(DATA_DIR), 'outliner.sqlite');
const LEGACY_DEFAULT_DB_PATH = path.join(path.resolve(DATA_DIR), 'tabrows.sqlite');
const DB_PATH = EXPLICIT_DB_PATH
  ? path.resolve(EXPLICIT_DB_PATH)
  : (fs.existsSync(LEGACY_DEFAULT_DB_PATH) && !fs.existsSync(DEFAULT_DB_PATH) ? LEGACY_DEFAULT_DB_PATH : DEFAULT_DB_PATH);
const RELATIVE_DB_PATH = path.relative(ROOT_DIR, DB_PATH) || path.basename(DB_PATH);
const DEFAULT_LIST_NAME = 'Untitled';
const SESSION_COOKIE_NAME = 'outliner_session';
const LEGACY_SESSION_COOKIE_NAME = 'tabrows_session';
const SESSION_COOKIE_NAMES = [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME];
const MUTATION_HEADER_NAMES = ['x-outliner-request', 'x-tabrows-request'];
const MUTATION_HEADER_VALUE = '1';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.OUTLINER_SECURE_COOKIES === '1' || process.env.TABROWS_SECURE_COOKIES === '1';
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;
const REVISION_LIMIT = 50;
const MAX_ID_LENGTH = 128;
const MAX_URL_LENGTH = 2_048;
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;
const MAX_LIST_NAME_LENGTH = 160;
const MAX_ROW_TEXT_LENGTH = 50_000;
const MAX_ROWS_PER_LIST = 10_000;
const MAX_TOTAL_ROWS_PER_SNAPSHOT = 20_000;
const MAX_OPERATIONS_PER_REQUEST = 1_000;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 80;
const AUTH_RATE_LIMIT_MAX_PER_IP = 300;
const AUTH_RATE_LIMIT_MAX_ENTRIES = 10_000;
const ALLOW_REGISTRATION = (process.env.OUTLINER_ALLOW_REGISTRATION ?? process.env.TABROWS_ALLOW_REGISTRATION) !== '0';
const DUMMY_PASSWORD_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_PASSWORD_HASH = crypto.scryptSync('invalid-password', DUMMY_PASSWORD_SALT, 64).toString('hex');
const authRateLimit = new Map();

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/storage.js', 'storage.js'],
  ['/outline.js', 'outline.js'],
  ['/markdown.js', 'markdown.js'],
  ['/styles.css', 'styles.css']
]);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

function parsePort(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer from 0 to 65535.');
  }
  return port;
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    current_list_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    public_token TEXT UNIQUE,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS list_shares (
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (list_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS list_revisions (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rows (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    level INTEGER NOT NULL,
    color TEXT NOT NULL,
    collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_list_shares_user_id ON list_shares (user_id);
  CREATE INDEX IF NOT EXISTS idx_list_revisions_list_created ON list_revisions (list_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_list_revisions_owner_created ON list_revisions (owner_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rows_list_position ON rows (list_id, position);
`);

ensureColumn('lists', 'user_id', 'user_id TEXT');
ensureColumn('lists', 'public_token', 'public_token TEXT');
ensureColumn('list_shares', 'role', "role TEXT NOT NULL DEFAULT 'editor'");
ensureColumn('rows', 'revision', 'revision INTEGER NOT NULL DEFAULT 0');
db.exec("UPDATE list_shares SET role = 'editor' WHERE role IS NULL OR role NOT IN ('viewer', 'editor')");
db.exec('CREATE INDEX IF NOT EXISTS idx_lists_user_position ON lists (user_id, position)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_public_token ON lists (public_token) WHERE public_token IS NOT NULL');

const selectLegacyCurrentId = db.prepare('SELECT value FROM app_meta WHERE key = ?');
const selectUserCount = db.prepare('SELECT COUNT(*) AS count FROM users');
const selectUnownedListCount = db.prepare('SELECT COUNT(*) AS count FROM lists WHERE user_id IS NULL');
const selectUserByEmail = db.prepare(`
  SELECT
    id,
    email,
    password_salt AS passwordSalt,
    password_hash AS passwordHash,
    current_list_id AS currentListId
  FROM users
  WHERE email = ?
`);
const selectUserById = db.prepare(`
  SELECT
    id,
    email,
    current_list_id AS currentListId
  FROM users
  WHERE id = ?
`);
const selectSessionById = db.prepare(`
  SELECT
    sessions.id,
    sessions.user_id AS userId,
    sessions.expires_at AS expiresAt,
    users.email
  FROM sessions
  JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = ?
`);
const selectAccessibleLists = db.prepare(`
  SELECT
    lists.id,
    lists.name,
    lists.user_id AS ownerUserId,
    owners.email AS ownerEmail,
    lists.public_token AS publicToken,
    list_shares.role AS shareRole,
    CASE WHEN lists.user_id = ? THEN 1 ELSE 0 END AS isOwner,
    lists.position
  FROM lists
  JOIN users AS owners ON owners.id = lists.user_id
  LEFT JOIN list_shares ON list_shares.list_id = lists.id AND list_shares.user_id = ?
  WHERE lists.user_id = ? OR list_shares.user_id = ?
  ORDER BY
    CASE WHEN lists.user_id = ? THEN 0 ELSE 1 END,
    lists.position,
    lists.rowid
`);
const selectAccessibleRows = db.prepare(`
  SELECT
    rows.id,
    rows.list_id AS listId,
    rows.text,
    rows.level,
    rows.color,
    rows.collapsed,
    rows.revision
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  LEFT JOIN list_shares ON list_shares.list_id = lists.id AND list_shares.user_id = ?
  WHERE lists.user_id = ? OR list_shares.user_id = ?
  ORDER BY
    CASE WHEN lists.user_id = ? THEN 0 ELSE 1 END,
    lists.position,
    lists.rowid,
    rows.position,
    rows.rowid
`);
const selectListCollaborators = db.prepare(`
  SELECT
    list_shares.list_id AS listId,
    users.id AS userId,
    users.email AS email,
    list_shares.role AS role
  FROM list_shares
  JOIN lists ON lists.id = list_shares.list_id
  JOIN users ON users.id = list_shares.user_id
  WHERE lists.user_id = ?
  ORDER BY list_shares.list_id, users.email COLLATE NOCASE, users.rowid
`);
const selectAccessibleListAccess = db.prepare(`
  SELECT
    lists.id,
    lists.user_id AS ownerUserId,
    lists.position,
    list_shares.role AS shareRole
  FROM lists
  LEFT JOIN list_shares ON list_shares.list_id = lists.id AND list_shares.user_id = ?
  WHERE lists.user_id = ? OR list_shares.user_id = ?
`);
const selectFirstAccessibleListId = db.prepare(`
  SELECT lists.id
  FROM lists
  LEFT JOIN list_shares ON list_shares.list_id = lists.id AND list_shares.user_id = ?
  WHERE lists.user_id = ? OR list_shares.user_id = ?
  ORDER BY
    CASE WHEN lists.user_id = ? THEN 0 ELSE 1 END,
    lists.position,
    lists.rowid
  LIMIT 1
`);
const selectListById = db.prepare(`
  SELECT
    lists.id,
    lists.user_id AS ownerUserId,
    lists.name,
    lists.public_token AS publicToken
  FROM lists
  WHERE lists.id = ?
`);
const selectAccessibleListById = db.prepare(`
  SELECT
    lists.id,
    lists.user_id AS ownerUserId,
    lists.name,
    lists.public_token AS publicToken,
    owners.email AS ownerEmail,
    list_shares.role AS shareRole,
    CASE WHEN lists.user_id = ? THEN 1 ELSE 0 END AS isOwner
  FROM lists
  JOIN users AS owners ON owners.id = lists.user_id
  LEFT JOIN list_shares ON list_shares.list_id = lists.id AND list_shares.user_id = ?
  WHERE lists.id = ? AND (lists.user_id = ? OR list_shares.user_id = ?)
`);
const selectListByPublicToken = db.prepare(`
  SELECT
    lists.id,
    lists.name,
    lists.user_id AS ownerUserId
  FROM lists
  WHERE lists.public_token = ?
`);
const selectRowsByListId = db.prepare(`
  SELECT id, text, level, color, collapsed, revision
  FROM rows
  WHERE list_id = ?
  ORDER BY position, rowid
`);
const selectRowById = db.prepare(`
  SELECT id, list_id AS listId, revision
  FROM rows
  WHERE id = ?
`);
const selectRowSnapshotById = db.prepare(`
  SELECT
    id,
    list_id AS listId,
    text,
    level,
    color,
    collapsed,
    revision,
    position
  FROM rows
  WHERE id = ?
`);
const selectListRevisions = db.prepare(`
  SELECT
    id,
    kind,
    label,
    snapshot_json AS snapshotJson,
    created_at AS createdAt
  FROM list_revisions
  WHERE list_id = ? AND owner_user_id = ?
  ORDER BY created_at DESC, rowid DESC
  LIMIT ?
`);
const selectListRevisionById = db.prepare(`
  SELECT
    id,
    list_id AS listId,
    owner_user_id AS ownerUserId,
    kind,
    label,
    snapshot_json AS snapshotJson,
    created_at AS createdAt
  FROM list_revisions
  WHERE list_id = ? AND owner_user_id = ? AND id = ?
`);
const selectListShareByListAndUser = db.prepare(`
  SELECT list_id AS listId, user_id AS userId, role
  FROM list_shares
  WHERE list_id = ? AND user_id = ?
`);
const selectFirstUserListId = db.prepare('SELECT id FROM lists WHERE user_id = ? ORDER BY position, rowid LIMIT 1');
const insertUser = db.prepare(`
  INSERT INTO users (id, email, password_salt, password_hash, current_list_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateUserCurrentList = db.prepare('UPDATE users SET current_list_id = ? WHERE id = ?');
const insertSession = db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)');
const deleteSessionById = db.prepare('DELETE FROM sessions WHERE id = ?');
const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
const insertList = db.prepare('INSERT INTO lists (id, user_id, name, public_token, position) VALUES (?, ?, ?, ?, ?)');
const updateListName = db.prepare('UPDATE lists SET name = ? WHERE id = ?');
const updateOwnedListPosition = db.prepare('UPDATE lists SET name = ?, position = ? WHERE id = ?');
const updateListPublicToken = db.prepare('UPDATE lists SET public_token = ? WHERE id = ?');
const deleteListById = db.prepare('DELETE FROM lists WHERE id = ?');
const deleteRowsByListId = db.prepare('DELETE FROM rows WHERE list_id = ?');
const deleteRowByIdAndList = db.prepare('DELETE FROM rows WHERE id = ? AND list_id = ?');
const insertRow = db.prepare('INSERT INTO rows (id, list_id, text, level, color, collapsed, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
const updateRowById = db.prepare(`
  UPDATE rows
  SET text = ?, level = ?, color = ?, collapsed = ?, position = ?, revision = revision + 1
  WHERE id = ? AND list_id = ?
`);
const deleteUserLists = db.prepare('DELETE FROM lists WHERE user_id = ?');
const claimUnownedLists = db.prepare('UPDATE lists SET user_id = ? WHERE user_id IS NULL');
const insertListShare = db.prepare('INSERT OR IGNORE INTO list_shares (list_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
const updateListShareRole = db.prepare('UPDATE list_shares SET role = ? WHERE list_id = ? AND user_id = ?');
const deleteListShare = db.prepare('DELETE FROM list_shares WHERE list_id = ? AND user_id = ?');
const insertListRevision = db.prepare(`
  INSERT INTO list_revisions (id, list_id, owner_user_id, kind, label, snapshot_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const pruneListRevisions = db.prepare(`
  DELETE FROM list_revisions
  WHERE list_id = ?
    AND id NOT IN (
      SELECT id
      FROM list_revisions
      WHERE list_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    )
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function createId() {
  return crypto.randomUUID();
}

function normalizeId(value, fallback = null) {
  const id = typeof value === 'string' && value ? value : (fallback ?? createId());
  if (id.length > MAX_ID_LENGTH) {
    throw createHttpError(400, `Ids must be ${MAX_ID_LENGTH} characters or fewer.`);
  }
  return id;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function normalizeListName(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length > MAX_LIST_NAME_LENGTH) {
    throw createHttpError(400, `List name must be ${MAX_LIST_NAME_LENGTH} characters or fewer.`);
  }
  return trimmed || DEFAULT_LIST_NAME;
}

function normalizeShareRole(value) {
  return value === 'viewer' ? 'viewer' : 'editor';
}

function parseShareRole(value, defaultRole = 'editor') {
  if (value === undefined || value === null || value === '') return defaultRole;
  if (value === 'viewer' || value === 'editor') return value;
  throw createHttpError(400, 'Role must be viewer or editor.');
}

function canEditAccessibleList(list, userId) {
  return Boolean(list && (list.ownerUserId === userId || normalizeShareRole(list.shareRole) === 'editor'));
}

function assertCanEditAccessibleList(list, userId) {
  if (!canEditAccessibleList(list, userId)) {
    throw createHttpError(403, 'You only have view access to this list.');
  }
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidEmail(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_EMAIL_LENGTH
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    throw createHttpError(400, `Password must be 8-${MAX_PASSWORD_LENGTH} characters.`);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function clientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function assertAuthRateLimit(request, email = '') {
  const now = Date.now();
  const normalizedEmail = normalizeEmail(email);
  const ip = clientAddress(request);

  if (authRateLimit.size > AUTH_RATE_LIMIT_MAX_ENTRIES) {
    authRateLimit.clear();
  }

  for (const [entryKey, entry] of authRateLimit) {
    if (now - entry.startedAt > AUTH_RATE_LIMIT_WINDOW_MS) {
      authRateLimit.delete(entryKey);
    }
  }

  function incrementLimit(key, maximum) {
    const entry = authRateLimit.get(key) || { count: 0, startedAt: now };
    if (now - entry.startedAt > AUTH_RATE_LIMIT_WINDOW_MS) {
      entry.count = 0;
      entry.startedAt = now;
    }

    entry.count += 1;
    authRateLimit.set(key, entry);

    if (entry.count > maximum) {
      throw createHttpError(429, 'Too many auth attempts. Try again later.');
    }
  }

  incrementLimit(`ip:${ip}`, AUTH_RATE_LIMIT_MAX_PER_IP);
  incrementLimit(`email:${ip}:${normalizedEmail || 'unknown'}`, AUTH_RATE_LIMIT_MAX);
}

function assertRegistrationAllowed() {
  if (!ALLOW_REGISTRATION) {
    throw createHttpError(403, 'Registration is disabled on this server.');
  }
}

function normalizeRow(row) {
  const text = typeof row?.text === 'string' ? normalizeText(row.text) : '';
  if (text.length > MAX_ROW_TEXT_LENGTH) {
    throw createHttpError(400, `Row text must be ${MAX_ROW_TEXT_LENGTH} characters or fewer.`);
  }

  return {
    id: normalizeId(row?.id),
    text,
    level: Number.isInteger(row?.level) ? Math.max(0, row.level) : 0,
    color: typeof row?.color === 'string' ? row.color.slice(0, 32) : '',
    collapsed: Boolean(row?.collapsed),
    revision: Number.isInteger(row?.revision) ? Math.max(0, row.revision) : 0
  };
}

function normalizeRows(rows) {
  let previousLevel = 0;

  return rows.map((row, index) => {
    const normalized = normalizeRow(row);
    const maximumLevel = index === 0 ? 0 : previousLevel + 1;
    normalized.level = Math.max(0, Math.min(normalized.level, maximumLevel));
    previousLevel = normalized.level;
    return normalized;
  });
}

function assertPersistedRowsValid(listId) {
  const persistedRows = selectRowsByListId.all(listId);
  if (persistedRows.length > MAX_ROWS_PER_LIST) {
    throw createHttpError(400, `Lists can contain at most ${MAX_ROWS_PER_LIST} rows.`);
  }

  let previousLevel = 0;
  persistedRows.forEach((row, index) => {
    const maximumLevel = index === 0 ? 0 : previousLevel + 1;
    if (!Number.isInteger(row.level) || row.level < 0 || row.level > maximumLevel) {
      throw createHttpError(400, 'Row levels must form a valid outline.');
    }
    previousLevel = row.level;
  });
}

function normalizeList(list) {
  const rows = Array.isArray(list?.rows) ? list.rows : [];
  if (rows.length > MAX_ROWS_PER_LIST) {
    throw createHttpError(400, `Lists can contain at most ${MAX_ROWS_PER_LIST} rows.`);
  }

  return {
    id: normalizeId(list?.id),
    name: normalizeListName(list?.name),
    rows: normalizeRows(rows)
  };
}

function assertUniqueSnapshotIds(lists) {
  const listIds = new Set();
  const rowIds = new Set();

  lists.forEach((list) => {
    if (listIds.has(list.id)) {
      throw createHttpError(400, 'Duplicate list ids are not allowed.');
    }
    listIds.add(list.id);

    list.rows.forEach((row) => {
      if (rowIds.has(row.id)) {
        throw createHttpError(400, 'Duplicate row ids are not allowed.');
      }
      rowIds.add(row.id);
    });
  });
}

function normalizeDbPayload(payload) {
  if (!payload || !Array.isArray(payload.lists) || !payload.lists.length) return null;

  const lists = payload.lists.map((list) => normalizeList(list));
  const rowCount = lists.reduce((count, list) => count + list.rows.length, 0);
  if (rowCount > MAX_TOTAL_ROWS_PER_SNAPSHOT) {
    throw createHttpError(400, `Snapshots can contain at most ${MAX_TOTAL_ROWS_PER_SNAPSHOT} rows.`);
  }
  assertUniqueSnapshotIds(lists);
  const currentId = lists.some((list) => list.id === payload.currentId)
    ? payload.currentId
    : lists[0].id;

  return { currentId, lists };
}

function normalizeDbOperationPayload(payload) {
  const operations = Array.isArray(payload?.operations)
    ? payload.operations
    : (Array.isArray(payload?.ops) ? payload.ops : []);
  if (operations.length > MAX_OPERATIONS_PER_REQUEST) {
    throw createHttpError(400, `Requests can contain at most ${MAX_OPERATIONS_PER_REQUEST} operations.`);
  }

  return {
    currentId: typeof payload?.currentId === 'string' ? payload.currentId : '',
    operations: operations.map((operation) => normalizeDbOperation(operation))
  };
}

function normalizeDbOperation(operation) {
  const type = String(operation?.type || '').trim();
  if (!type) throw createHttpError(400, 'Operation type is required.');

  if (type === 'list-create') {
    return {
      type,
      list: {
        id: normalizeId(operation?.list?.id),
        name: normalizeListName(operation?.list?.name),
        position: Number.isInteger(operation?.list?.position) ? Math.max(0, operation.list.position) : 0
      }
    };
  }

  if (type === 'list-update') {
    return {
      type,
      listId: normalizeId(operation?.listId, ''),
      name: normalizeListName(operation?.name),
      hasPosition: Number.isInteger(operation?.position),
      position: Number.isInteger(operation?.position) ? Math.max(0, operation.position) : 0
    };
  }

  if (type === 'list-delete') {
    return {
      type,
      listId: normalizeId(operation?.listId, '')
    };
  }

  if (type === 'row-create' || type === 'row-update') {
    return {
      type,
      listId: normalizeId(operation?.listId, ''),
      position: Number.isInteger(operation?.position) ? Math.max(0, operation.position) : 0,
      row: normalizeRow(operation?.row),
      expectedRevision: Number.isInteger(operation?.expectedRevision) ? Math.max(0, operation.expectedRevision) : null
    };
  }

  if (type === 'row-delete') {
    return {
      type,
      listId: normalizeId(operation?.listId, ''),
      rowId: normalizeId(operation?.rowId, ''),
      expectedRevision: Number.isInteger(operation?.expectedRevision) ? Math.max(0, operation.expectedRevision) : null
    };
  }

  throw createHttpError(400, `Unsupported operation type: ${type}`);
}

function createDefaultDbSnapshot(userId) {
  const user = selectUserById.get(userId);
  const listId = createId();
  return {
    currentId: listId,
    lists: [
      {
        id: listId,
        name: DEFAULT_LIST_NAME,
        isOwner: true,
        ownerUserId: userId,
        ownerEmail: user?.email || '',
        canShare: true,
        canLeave: false,
        publicShareToken: '',
        collaborators: [],
        rows: [
          {
            id: createId(),
            text: '',
            level: 0,
            color: '',
            collapsed: false
          }
        ]
      }
    ]
  };
}

function ensureUserHasDefaultDb(userId) {
  const existingListId = selectFirstAccessibleListId.get(userId, userId, userId, userId)?.id;
  if (existingListId) return;

  const snapshot = createDefaultDbSnapshot(userId);
  const list = snapshot.lists[0];

  db.exec('BEGIN IMMEDIATE');
  try {
    const currentListId = selectFirstAccessibleListId.get(userId, userId, userId, userId)?.id;
    if (!currentListId) {
      insertList.run(list.id, userId, list.name, null, 0);
      list.rows.forEach((row, position) => {
        insertRow.run(
          row.id,
          list.id,
          row.text,
          row.level,
          row.color,
          row.collapsed ? 1 : 0,
          position
        );
      });
      updateUserCurrentList.run(list.id, userId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function loadDbFromSqlite(userId) {
  const lists = selectAccessibleLists.all(userId, userId, userId, userId, userId);
  if (!lists.length) {
    ensureUserHasDefaultDb(userId);
    return loadDbFromSqlite(userId);
  }

  const rowsByList = new Map();
  selectAccessibleRows.all(userId, userId, userId, userId).forEach((row) => {
    const rows = rowsByList.get(row.listId) || [];
    rows.push({
      id: row.id,
      text: row.text,
      level: row.level,
      color: row.color,
      collapsed: Boolean(row.collapsed),
      revision: Number.isInteger(row.revision) ? row.revision : 0
    });
    rowsByList.set(row.listId, rows);
  });

  const collaboratorsByList = new Map();
  selectListCollaborators.all(userId).forEach((collaborator) => {
    const collaborators = collaboratorsByList.get(collaborator.listId) || [];
    collaborators.push({
      userId: collaborator.userId,
      email: collaborator.email,
      role: normalizeShareRole(collaborator.role)
    });
    collaboratorsByList.set(collaborator.listId, collaborators);
  });

  const user = selectUserById.get(userId);
  const currentId = user?.currentListId;

  // Return one merged snapshot that includes owned lists first, then shared
  // lists, so the client can treat both through the same state model.
  return {
    currentId: lists.some((list) => list.id === currentId) ? currentId : lists[0].id,
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      isOwner: Boolean(list.isOwner),
      ownerUserId: list.ownerUserId,
      ownerEmail: list.ownerEmail,
      accessRole: list.isOwner ? 'owner' : normalizeShareRole(list.shareRole),
      canEdit: Boolean(list.isOwner) || normalizeShareRole(list.shareRole) === 'editor',
      canShare: Boolean(list.isOwner),
      canLeave: !list.isOwner,
      publicShareToken: list.isOwner ? (list.publicToken || '') : '',
      collaborators: list.isOwner ? (collaboratorsByList.get(list.id) || []) : [],
      rows: rowsByList.get(list.id) || []
    }))
  };
}

function saveDbToSqlite(userId, payload) {
  const normalized = normalizeDbPayload(payload);
  if (!normalized) {
    throw createHttpError(400, 'Invalid database payload.');
  }

  const accessibleLists = new Map(
    selectAccessibleListAccess
      .all(userId, userId, userId)
      .map((list) => [list.id, list])
  );
  const payloadIds = new Set(normalized.lists.map((list) => list.id));
  const ownedListsInPayload = normalized.lists.filter((list) => {
    const existing = accessibleLists.get(list.id);
    if (!existing) return !selectListById.get(list.id)?.id;
    return existing.ownerUserId === userId;
  });
  const ownedPositions = new Map(ownedListsInPayload.map((list, index) => [list.id, index]));

  normalized.lists.forEach((list) => {
    const existing = accessibleLists.get(list.id);
    if (!existing && selectListById.get(list.id)) {
      throw createHttpError(409, 'List id already exists.');
    }

    list.rows.forEach((row) => {
      const existingRow = selectRowById.get(row.id);
      if (existingRow && existingRow.listId !== list.id) {
        throw createHttpError(409, 'Row id already exists.');
      }
    });
  });

  db.exec('BEGIN IMMEDIATE');
  try {
    // Owners can add/remove owned lists through snapshot writes. Shared lists
    // stay addressable in the same payload, but only their rows/name are updated.
    accessibleLists.forEach((list) => {
      if (list.ownerUserId === userId && !payloadIds.has(list.id)) {
        recordListRevision(list.id, list.ownerUserId, 'auto', 'Before delete');
        deleteListById.run(list.id);
      }
    });

    normalized.lists.forEach((list) => {
      const existing = accessibleLists.get(list.id);
      const currentSnapshot = existing ? loadListSnapshotById(list.id) : null;
      const nextSnapshot = {
        id: list.id,
        name: list.name,
        rows: list.rows
      };
      const snapshotChanged = currentSnapshot
        ? snapshotComparableValue(currentSnapshot) !== snapshotComparableValue(nextSnapshot)
        : true;

      if (!existing) {
        insertList.run(list.id, userId, list.name, null, ownedPositions.get(list.id) ?? 0);
      } else if (existing.ownerUserId === userId) {
        const nextPosition = ownedPositions.get(list.id) ?? existing.position;
        const positionChanged = nextPosition !== existing.position;

        if (snapshotChanged) {
          recordListRevision(list.id, existing.ownerUserId, 'auto');
        }

        if (snapshotChanged || positionChanged) {
          updateOwnedListPosition.run(list.name, nextPosition, list.id);
        }

        if (!snapshotChanged) {
          return;
        }
        deleteRowsByListId.run(list.id);
      } else {
        if (!snapshotChanged) {
          return;
        }
        assertCanEditAccessibleList(existing, userId);
        recordListRevision(list.id, existing.ownerUserId, 'auto');
        updateListName.run(list.name, list.id);
        deleteRowsByListId.run(list.id);
      }

      list.rows.forEach((row, rowIndex) => {
        insertRow.run(
          row.id,
          list.id,
          row.text,
          row.level,
          row.color,
          row.collapsed ? 1 : 0,
          rowIndex
        );
      });
    });

    const currentId = selectListById.get(normalized.currentId)
      ? selectAccessibleListById.get(userId, userId, normalized.currentId, userId, userId)?.id || null
      : null;
    const nextCurrentId = currentId || selectFirstAccessibleListId.get(userId, userId, userId, userId)?.id || null;
    updateUserCurrentList.run(nextCurrentId, userId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return loadDbFromSqlite(userId);
}

function saveDbOperationsToSqlite(userId, payload) {
  const normalized = normalizeDbOperationPayload(payload);
  const accessibleLists = new Map(
    selectAccessibleListAccess
      .all(userId, userId, userId)
      .map((list) => [list.id, { ...list }])
  );
  const pendingRevisions = new Map();
  const touchedListIds = new Set();

  function getAccessibleList(listId) {
    const list = accessibleLists.get(listId);
    if (!list) throw createHttpError(404, 'List not found.');
    return list;
  }

  function markListChanged(listId, ownerUserId) {
    if (pendingRevisions.has(listId)) return;
    pendingRevisions.set(listId, {
      ownerUserId,
      beforeSnapshot: loadListSnapshotById(listId)
    });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    normalized.operations.forEach((operation) => {
      if (operation.type === 'list-create') {
        if (selectListById.get(operation.list.id)) {
          throw createHttpError(409, 'List id already exists.');
        }
        insertList.run(
          operation.list.id,
          userId,
          operation.list.name,
          null,
          operation.list.position
        );
        accessibleLists.set(operation.list.id, {
          id: operation.list.id,
          ownerUserId: userId,
          position: operation.list.position
        });
        touchedListIds.add(operation.list.id);
        return;
      }

      if (operation.type === 'list-update') {
        const list = getAccessibleList(operation.listId);
        assertCanEditAccessibleList(list, userId);
        if (list.ownerUserId === userId) {
          markListChanged(operation.listId, userId);
          const nextPosition = operation.hasPosition ? operation.position : list.position;
          updateOwnedListPosition.run(operation.name, nextPosition, operation.listId);
          list.position = nextPosition;
        } else {
          markListChanged(operation.listId, list.ownerUserId);
          updateListName.run(operation.name, operation.listId);
        }
        touchedListIds.add(operation.listId);
        return;
      }

      if (operation.type === 'list-delete') {
        const list = getAccessibleList(operation.listId);
        if (list.ownerUserId !== userId) {
          throw createHttpError(403, 'Only the list owner can delete this list.');
        }
        const beforeSnapshot = loadListSnapshotById(operation.listId);
        if (beforeSnapshot) {
          recordListRevision(operation.listId, userId, 'auto', 'Before delete', beforeSnapshot);
        }
        deleteListById.run(operation.listId);
        accessibleLists.delete(operation.listId);
        pendingRevisions.delete(operation.listId);
        return;
      }

      if (operation.type === 'row-delete') {
        const list = getAccessibleList(operation.listId);
        assertCanEditAccessibleList(list, userId);
        const existingRow = selectRowSnapshotById.get(operation.rowId);
        if (!existingRow) throw createHttpError(404, 'Row not found.');
        if (existingRow.listId !== operation.listId) {
          throw createHttpError(409, 'Row id already exists in another list.');
        }
        if (!Number.isInteger(operation.expectedRevision)) {
          throw createHttpError(400, 'Row delete operations require an expected revision.');
        }
        if (existingRow.revision !== operation.expectedRevision) {
          throw createRowConflictError('That row changed on the server. Reload before deleting it.', existingRow, operation);
        }
        markListChanged(operation.listId, list.ownerUserId);
        deleteRowByIdAndList.run(operation.rowId, operation.listId);
        touchedListIds.add(operation.listId);
        return;
      }

      if (operation.type === 'row-create') {
        const list = getAccessibleList(operation.listId);
        assertCanEditAccessibleList(list, userId);
        const existingRow = selectRowById.get(operation.row.id);
        if (existingRow) {
          throw createHttpError(409, 'Row id already exists.');
        }
        markListChanged(operation.listId, list.ownerUserId);
        insertRow.run(
          operation.row.id,
          operation.listId,
          operation.row.text,
          operation.row.level,
          operation.row.color,
          operation.row.collapsed ? 1 : 0,
          operation.position
        );
        touchedListIds.add(operation.listId);
        return;
      }

      if (operation.type === 'row-update') {
        const list = getAccessibleList(operation.listId);
        assertCanEditAccessibleList(list, userId);
        const existingRow = selectRowSnapshotById.get(operation.row.id);
        if (!existingRow) throw createHttpError(404, 'Row not found.');
        if (existingRow.listId !== operation.listId) {
          throw createHttpError(409, 'Row id already exists in another list.');
        }
        if (!Number.isInteger(operation.expectedRevision)) {
          throw createHttpError(400, 'Row update operations require an expected revision.');
        }
        if (existingRow.revision !== operation.expectedRevision) {
          throw createRowConflictError('That row changed on the server. Reload before saving your edit.', existingRow, operation);
        }
        markListChanged(operation.listId, list.ownerUserId);
        updateRowById.run(
          operation.row.text,
          operation.row.level,
          operation.row.color,
          operation.row.collapsed ? 1 : 0,
          operation.position,
          operation.row.id,
          operation.listId
        );
        touchedListIds.add(operation.listId);
        return;
      }
    });

    touchedListIds.forEach((listId) => {
      if (selectListById.get(listId)) assertPersistedRowsValid(listId);
    });

    pendingRevisions.forEach(({ ownerUserId, beforeSnapshot }, listId) => {
      if (!beforeSnapshot) return;
      const afterSnapshot = loadListSnapshotById(listId);
      if (!afterSnapshot) return;
      if (snapshotComparableValue(beforeSnapshot) === snapshotComparableValue(afterSnapshot)) return;
      recordListRevision(listId, ownerUserId, 'auto', '', beforeSnapshot);
    });

    const nextCurrentId = accessibleLists.has(normalized.currentId)
      ? normalized.currentId
      : (selectFirstAccessibleListId.get(userId, userId, userId, userId)?.id || null);
    updateUserCurrentList.run(nextCurrentId, userId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return loadDbFromSqlite(userId);
}

function claimLegacyDataForFirstUser(userId) {
  if (selectUserCount.get().count !== 1) return false;
  if (selectUnownedListCount.get().count === 0) return false;

  db.exec('BEGIN IMMEDIATE');
  try {
    claimUnownedLists.run(userId);
    const legacyCurrentId = selectLegacyCurrentId.get('currentId')?.value || null;
    const firstListId = selectFirstUserListId.get(userId)?.id || null;
    updateUserCurrentList.run(legacyCurrentId || firstListId, userId);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function loadStorageStats(userId) {
  const user = selectUserById.get(userId);
  const dbSnapshot = loadDbFromSqlite(userId);
  const fileStats = fs.statSync(DB_PATH);
  const lists = dbSnapshot?.lists || [];
  const rows = lists.flatMap((list) => list.rows);
  const currentList = lists.find((list) => list.id === dbSnapshot?.currentId) || null;
  const maxLevel = rows.reduce((max, row) => Math.max(max, row.level), -1);

  return {
    dbPath: RELATIVE_DB_PATH,
    fileSizeBytes: fileStats.size,
    updatedAt: fileStats.mtime.toISOString(),
    userEmail: user?.email || null,
    listCount: lists.length,
    rowCount: rows.length,
    coloredRowCount: rows.filter((row) => row.color).length,
    collapsedRowCount: rows.filter((row) => row.collapsed).length,
    maxDepth: maxLevel < 0 ? 0 : maxLevel + 1,
    currentListName: currentList?.name || null,
    currentListRowCount: currentList?.rows.length || 0
  };
}

function createHttpError(statusCode, message, metadata = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (metadata.code) error.code = metadata.code;
  if (metadata.details) error.details = metadata.details;
  return error;
}

function createRowConflictError(message, existingRow, operation) {
  return createHttpError(409, message, {
    code: 'ROW_CONFLICT',
    details: {
      listId: existingRow.listId,
      rowId: existingRow.id,
      actualRevision: existingRow.revision,
      expectedRevision: operation.expectedRevision,
      serverRow: {
        id: existingRow.id,
        text: existingRow.text,
        level: existingRow.level,
        color: existingRow.color,
        collapsed: Boolean(existingRow.collapsed),
        revision: existingRow.revision,
        position: existingRow.position
      }
    }
  });
}

function decodePathComponent(value, label = 'Path value') {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    throw createHttpError(400, `${label} is invalid.`);
  }
}

function appendResponseHeader(response, name, value) {
  const current = response.getHeader(name);
  if (!current) {
    response.setHeader(name, value);
    return;
  }

  const values = Array.isArray(current) ? current : [current];
  values.push(value);
  response.setHeader(name, values);
}

function setSessionCookie(response, sessionId, expiresAt) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];

  if (COOKIE_SECURE) parts.push('Secure');
  appendResponseHeader(response, 'Set-Cookie', parts.join('; '));
}

function clearSessionCookie(response) {
  SESSION_COOKIE_NAMES.forEach((cookieName) => {
    const parts = [
      `${cookieName}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ];

    if (COOKIE_SECURE) parts.push('Secure');
    appendResponseHeader(response, 'Set-Cookie', parts.join('; '));
  });
}

function parseCookies(request) {
  const raw = request.headers.cookie || '';
  const cookies = {};

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  raw.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return;
    cookies[key] = safeDecode(rest.join('='));
  });

  return cookies;
}

function deleteExpiredSessionsNow() {
  deleteExpiredSessions.run(new Date().toISOString());
}

function createSession(userId, response) {
  deleteExpiredSessionsNow();
  const sessionId = createId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  insertSession.run(sessionId, userId, expiresAt, now.toISOString());
  setSessionCookie(response, sessionId, expiresAt);
  return sessionId;
}

function getSessionUser(request, response) {
  deleteExpiredSessionsNow();
  const cookies = parseCookies(request);
  const sessionId = SESSION_COOKIE_NAMES.map((cookieName) => cookies[cookieName]).find(Boolean);
  if (!sessionId) return null;

  const session = selectSessionById.get(sessionId);
  if (!session) {
    clearSessionCookie(response);
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    deleteSessionById.run(sessionId);
    clearSessionCookie(response);
    return null;
  }

  return {
    id: session.userId,
    email: session.email
  };
}

function requireAuthenticatedUser(request, response) {
  const user = getSessionUser(request, response);
  if (!user) {
    throw createHttpError(401, 'Authentication required.');
  }
  return user;
}

function userSummary(user) {
  return { id: user.id, email: user.email };
}

function createPublicToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function isUniqueConstraintError(error) {
  return /UNIQUE constraint failed/i.test(String(error?.message || ''));
}

function loadListSnapshotById(listId) {
  const list = selectListById.get(listId);
  if (!list) return null;

  return {
    id: list.id,
    name: list.name,
    rows: selectRowsByListId.all(list.id).map((row) => ({
      id: row.id,
      text: row.text,
      level: row.level,
      color: row.color,
      collapsed: Boolean(row.collapsed),
      revision: Number.isInteger(row.revision) ? row.revision : 0
    }))
  };
}

function normalizeRevisionLabel(value) {
  return String(value ?? '').trim().slice(0, 80);
}

function normalizeListSnapshot(snapshot, listId) {
  const rows = normalizeRows(Array.isArray(snapshot?.rows) ? snapshot.rows : []).map((row) => ({
    id: row.id,
    text: row.text,
    level: row.level,
    color: row.color,
    collapsed: row.collapsed
  }));

  return {
    id: listId,
    name: normalizeListName(snapshot?.name),
    rows
  };
}

function snapshotComparableValue(snapshot) {
  return JSON.stringify(normalizeListSnapshot(snapshot, snapshot?.id || ''));
}

function rowPreviewText(row) {
  const firstLine = normalizeText(row?.text).split('\n').find((line) => line.trim()) || '(empty row)';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function rowContentChanged(a, b) {
  return !a || !b
    || normalizeText(a.text) !== normalizeText(b.text)
    || a.level !== b.level
    || a.color !== b.color
    || Boolean(a.collapsed) !== Boolean(b.collapsed);
}

function diffListSnapshots(currentSnapshot, targetSnapshot) {
  const current = normalizeListSnapshot(currentSnapshot, currentSnapshot?.id || targetSnapshot?.id || '');
  const target = normalizeListSnapshot(targetSnapshot, targetSnapshot?.id || currentSnapshot?.id || '');
  const currentRows = new Map(current.rows.map((row) => [row.id, row]));
  const targetRows = new Map(target.rows.map((row) => [row.id, row]));
  const preview = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let moved = 0;
  const currentPositions = new Map(current.rows.map((row, index) => [row.id, index]));

  target.rows.forEach((row, targetIndex) => {
    const existing = currentRows.get(row.id);
    if (!existing) {
      added += 1;
      if (preview.length < 4) preview.push(`Restore row: ${rowPreviewText(row)}`);
      return;
    }
    if (rowContentChanged(existing, row)) {
      changed += 1;
      if (preview.length < 4) preview.push(`Change row: ${rowPreviewText(existing)} -> ${rowPreviewText(row)}`);
    }
    if (currentPositions.get(row.id) !== targetIndex) {
      moved += 1;
      if (preview.length < 4) preview.push(`Move row: ${rowPreviewText(row)}`);
    }
  });

  current.rows.forEach((row) => {
    if (targetRows.has(row.id)) return;
    removed += 1;
    if (preview.length < 4) preview.push(`Remove row: ${rowPreviewText(row)}`);
  });

  return {
    nameChanged: current.name !== target.name,
    added,
    removed,
    changed,
    moved,
    preview
  };
}

function recordListRevision(listId, ownerUserId, kind, label = '', snapshot = loadListSnapshotById(listId)) {
  if (!snapshot) return;
  const createdAt = new Date().toISOString();
  insertListRevision.run(
    createId(),
    listId,
    ownerUserId,
    kind,
    normalizeRevisionLabel(label),
    JSON.stringify(normalizeListSnapshot(snapshot, listId)),
    createdAt
  );
  pruneListRevisions.run(listId, listId, REVISION_LIMIT);
}

function listRevisionsForOwner(ownerUserId, listId) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can view history.');
  const currentSnapshot = loadListSnapshotById(listId);

  return selectListRevisions.all(listId, ownerUserId, REVISION_LIMIT).map((revision) => {
    let rowCount = 0;
    let diff = { nameChanged: false, added: 0, removed: 0, changed: 0, moved: 0, preview: [] };
    try {
      const snapshot = JSON.parse(revision.snapshotJson);
      rowCount = Array.isArray(snapshot?.rows) ? snapshot.rows.length : 0;
      diff = diffListSnapshots(currentSnapshot, snapshot);
    } catch {
      rowCount = 0;
    }

    return {
      id: revision.id,
      kind: revision.kind,
      label: revision.label,
      createdAt: revision.createdAt,
      rowCount,
      diff
    };
  });
}

function createListCheckpoint(ownerUserId, listId, label) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can create checkpoints.');

  db.exec('BEGIN IMMEDIATE');
  try {
    recordListRevision(listId, ownerUserId, 'checkpoint', label);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return listRevisionsForOwner(ownerUserId, listId);
}

function restoreListRevision(ownerUserId, listId, revisionId) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can restore history.');

  const revision = selectListRevisionById.get(listId, ownerUserId, String(revisionId || ''));
  if (!revision) throw createHttpError(404, 'Revision not found.');

  let snapshot;
  try {
    snapshot = normalizeListSnapshot(JSON.parse(revision.snapshotJson), listId);
  } catch {
    throw createHttpError(500, 'Revision data is invalid.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    recordListRevision(listId, ownerUserId, 'auto', 'Before restore');
    updateListName.run(snapshot.name, listId);
    deleteRowsByListId.run(listId);
    snapshot.rows.forEach((row, rowIndex) => {
      insertRow.run(
        row.id,
        listId,
        row.text,
        row.level,
        row.color,
        row.collapsed ? 1 : 0,
        rowIndex
      );
    });
    updateUserCurrentList.run(listId, ownerUserId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return loadDbFromSqlite(ownerUserId);
}

function shareListWithUser(ownerUserId, listId, email, role = 'editor') {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = parseShareRole(role);
  if (!isValidEmail(normalizedEmail)) {
    throw createHttpError(400, 'Enter a valid email address.');
  }

  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can share this list.');

  const user = selectUserByEmail.get(normalizedEmail);
  if (!user) throw createHttpError(404, 'Could not share with that user.');
  if (user.id === ownerUserId) throw createHttpError(400, 'You already own this list.');
  if (selectListShareByListAndUser.get(listId, user.id)) {
    throw createHttpError(409, 'That user already has access to this list.');
  }

  insertListShare.run(listId, user.id, normalizedRole, new Date().toISOString());
  return loadDbFromSqlite(ownerUserId);
}

function updateListShareRoleForUser(ownerUserId, listId, shareUserId, role) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can manage collaborators.');
  if (typeof shareUserId !== 'string' || !shareUserId.trim()) {
    throw createHttpError(400, 'Collaborator user id is required.');
  }

  const collaboratorId = shareUserId.trim();
  if (!selectListShareByListAndUser.get(listId, collaboratorId)) {
    throw createHttpError(404, 'Collaborator not found.');
  }

  updateListShareRole.run(parseShareRole(role), listId, collaboratorId);
  return loadDbFromSqlite(ownerUserId);
}

function revokeListShareForUser(ownerUserId, listId, shareUserId) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can manage collaborators.');
  if (typeof shareUserId !== 'string' || !shareUserId.trim()) {
    throw createHttpError(400, 'Collaborator user id is required.');
  }

  const collaboratorId = shareUserId.trim();
  if (!selectListShareByListAndUser.get(listId, collaboratorId)) {
    throw createHttpError(404, 'Collaborator not found.');
  }

  deleteListShare.run(listId, collaboratorId);
  return loadDbFromSqlite(ownerUserId);
}

function leaveSharedListForUser(userId, listId) {
  const list = selectAccessibleListById.get(userId, userId, listId, userId, userId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId === userId) throw createHttpError(400, 'Owners cannot leave their own list.');

  deleteListShare.run(listId, userId);
  const nextCurrentId = selectFirstAccessibleListId.get(userId, userId, userId, userId)?.id || null;
  updateUserCurrentList.run(nextCurrentId, userId);
  return loadDbFromSqlite(userId);
}

function enablePublicListShare(ownerUserId, listId) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can publish this list.');

  if (!list.publicToken) {
    let assigned = false;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        updateListPublicToken.run(createPublicToken(), listId);
        assigned = true;
        break;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }

    if (!assigned) {
      throw createHttpError(500, 'Could not create a public link.');
    }
  }

  return loadDbFromSqlite(ownerUserId);
}

function disablePublicListShare(ownerUserId, listId) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can unpublish this list.');

  updateListPublicToken.run(null, listId);
  return loadDbFromSqlite(ownerUserId);
}

function loadPublicListByToken(token) {
  const list = selectListByPublicToken.get(String(token || ''));
  if (!list) return null;

  return {
    id: list.id,
    name: list.name,
    rows: selectRowsByListId.all(list.id).map((row) => ({
      id: row.id,
      text: row.text,
      level: row.level,
      color: row.color,
      collapsed: Boolean(row.collapsed),
      revision: Number.isInteger(row.revision) ? row.revision : 0
    }))
  };
}

function registerUser(email, password, response) {
  assertRegistrationAllowed();
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw createHttpError(400, 'Enter a valid email address.');
  }
  validatePassword(password);

  if (selectUserByEmail.get(normalizedEmail)) {
    throw createHttpError(409, 'Could not create account with those details.');
  }

  const userId = createId();
  const now = new Date().toISOString();
  const { salt, hash } = hashPassword(password);
  insertUser.run(userId, normalizedEmail, salt, hash, null, now);
  claimLegacyDataForFirstUser(userId);

  createSession(userId, response);
  return selectUserById.get(userId);
}

function loginUser(email, password, response) {
  const normalizedEmail = normalizeEmail(email);
  const user = selectUserByEmail.get(normalizedEmail);
  const passwordValue = String(password ?? '');
  const passwordMatches = user
    ? verifyPassword(passwordValue, user.passwordSalt, user.passwordHash)
    : verifyPassword(passwordValue, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    throw createHttpError(401, 'Incorrect email or password.');
  }

  createSession(user.id, response);
  return selectUserById.get(user.id);
}

function logoutUser(request, response) {
  const cookies = parseCookies(request);
  const sessionId = SESSION_COOKIE_NAMES.map((cookieName) => cookies[cookieName]).find(Boolean);
  if (sessionId) {
    deleteSessionById.run(sessionId);
  }
  clearSessionCookie(response);
}

function requestHost(request) {
  return String(request.headers.host || '').toLowerCase();
}

function originHost(request) {
  const origin = request.headers.origin;
  if (!origin) return '';

  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    throw createHttpError(403, 'Request origin is invalid.');
  }
}

function assertTrustedMutationRequest(request, pathname) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  if (!String(pathname || '').startsWith('/api/')) return;

  const site = String(request.headers['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') {
    throw createHttpError(403, 'Cross-site writes are not allowed.');
  }

  const origin = originHost(request);
  if (origin && origin !== requestHost(request)) {
    throw createHttpError(403, 'Cross-origin writes are not allowed.');
  }

  if (!MUTATION_HEADER_NAMES.some((headerName) => request.headers[headerName] === MUTATION_HEADER_VALUE)) {
    throw createHttpError(403, 'Missing trusted request header.');
  }
}

function assertJsonRequest(request) {
  const mediaType = String(request.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    throw createHttpError(415, 'Expected application/json request body.');
  }
}

function readJsonBody(request) {
  assertJsonRequest(request);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let bodyTooLarge = false;

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function resolveOnce(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    request.on('data', (chunk) => {
      if (bodyTooLarge) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        bodyTooLarge = true;
        chunks.length = 0;
        rejectOnce(createHttpError(413, 'Request body too large.'));
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveOnce(raw ? JSON.parse(raw) : {});
      } catch {
        rejectOnce(createHttpError(400, 'Invalid JSON body.'));
      }
    });

    request.on('aborted', () => {
      rejectOnce(createHttpError(400, 'Request aborted.'));
    });

    request.on('close', () => {
      if (!settled && !request.complete) {
        rejectOnce(createHttpError(400, 'Request aborted.'));
      }
    });

    request.on('error', rejectOnce);
  });
}

function defaultHeaders(headers = {}) {
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "script-src-elem 'self'",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' http: https: data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    ...headers
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, defaultHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }));
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, defaultHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  }));
  response.end(text);
}

function sendMethodNotAllowed(response, methods) {
  response.writeHead(405, defaultHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    Allow: methods.join(', '),
    'Cache-Control': 'no-store'
  }));
  response.end('Method not allowed');
}

function sendError(response, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const payload = {
    error: statusCode === 500 ? 'Internal server error.' : error.message
  };
  if (statusCode !== 500 && error?.code) payload.code = error.code;
  if (statusCode !== 500 && error?.details) payload.details = error.details;
  sendJson(response, statusCode, payload);
}

function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendMethodNotAllowed(response, ['GET', 'HEAD']);
    return;
  }

  if (pathname.startsWith('/public/')) {
    pathname = '/';
  }

  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) {
    sendText(response, 404, 'Not found');
    return;
  }

  const filePath = path.join(PUBLIC_DIR, fileName);
  const extension = path.extname(fileName);

  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, defaultHeaders({
      'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    }));
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    sendText(response, 404, 'Not found');
  }
}

const server = http.createServer(async (request, response) => {
  let url;
  try {
    if (String(request.url || '').length > MAX_URL_LENGTH) {
      throw createHttpError(414, 'Request URL is too long.');
    }
    url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
    assertTrustedMutationRequest(request, url.pathname);
  } catch (error) {
    sendError(response, error);
    return;
  }

  const listShareMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/share$/);
  const listLeaveMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/leave$/);
  const listPublicMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/public-link$/);
  const listRevisionsMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/revisions$/);
  const listRevisionRestoreMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/revisions\/([^/]+)\/restore$/);
  const publicListMatch = url.pathname.match(/^\/api\/public\/([^/]+)$/);

  if (url.pathname === '/api/auth/session') {
    try {
      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, ['GET']);
        return;
      }

      const user = getSessionUser(request, response);
      sendJson(response, 200, { authenticated: Boolean(user), user: user ? userSummary(user) : null });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (url.pathname === '/api/auth/register') {
    try {
      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, ['POST']);
        return;
      }

      const body = await readJsonBody(request);
      assertAuthRateLimit(request, body?.email);
      const user = registerUser(body?.email, body?.password, response);
      sendJson(response, 200, { authenticated: true, user: userSummary(user) });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (url.pathname === '/api/auth/login') {
    try {
      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, ['POST']);
        return;
      }

      const body = await readJsonBody(request);
      assertAuthRateLimit(request, body?.email);
      const user = loginUser(body?.email, body?.password, response);
      sendJson(response, 200, { authenticated: true, user: userSummary(user) });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (url.pathname === '/api/auth/logout') {
    try {
      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, ['POST']);
        return;
      }

      logoutUser(request, response);
      sendJson(response, 200, { ok: true });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (url.pathname === '/api/db') {
    try {
      const user = requireAuthenticatedUser(request, response);

      if (request.method === 'GET') {
        sendJson(response, 200, { db: loadDbFromSqlite(user.id) });
        return;
      }

      if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        const dbPayload = body?.db || body;
        const savedDb = saveDbToSqlite(user.id, dbPayload);
        sendJson(response, 200, { ok: true, db: savedDb });
        return;
      }

      sendMethodNotAllowed(response, ['GET', 'PUT']);
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (url.pathname === '/api/db/ops') {
    try {
      const user = requireAuthenticatedUser(request, response);

      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, ['POST']);
        return;
      }

      const body = await readJsonBody(request);
      const savedDb = saveDbOperationsToSqlite(user.id, body);
      sendJson(response, 200, { ok: true, db: savedDb });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (listShareMatch) {
    try {
      const user = requireAuthenticatedUser(request, response);
      const listId = decodePathComponent(listShareMatch[1], 'List id');

      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        const dbSnapshot = shareListWithUser(user.id, listId, body?.email, body?.role);
        sendJson(response, 200, { ok: true, db: dbSnapshot });
        return;
      }

      if (request.method === 'PATCH') {
        const body = await readJsonBody(request);
        const dbSnapshot = updateListShareRoleForUser(user.id, listId, body?.userId, body?.role);
        sendJson(response, 200, { ok: true, db: dbSnapshot });
        return;
      }

      if (request.method === 'DELETE') {
        const body = await readJsonBody(request);
        const dbSnapshot = revokeListShareForUser(user.id, listId, body?.userId);
        sendJson(response, 200, { ok: true, db: dbSnapshot });
        return;
      }

      sendMethodNotAllowed(response, ['POST', 'PATCH', 'DELETE']);
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (listLeaveMatch) {
    try {
      const user = requireAuthenticatedUser(request, response);
      const listId = decodePathComponent(listLeaveMatch[1], 'List id');

      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, ['POST']);
        return;
      }

      const dbSnapshot = leaveSharedListForUser(user.id, listId);
      sendJson(response, 200, { ok: true, db: dbSnapshot });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (listPublicMatch) {
    try {
      const user = requireAuthenticatedUser(request, response);
      const listId = decodePathComponent(listPublicMatch[1], 'List id');

      if (request.method === 'POST') {
        const dbSnapshot = enablePublicListShare(user.id, listId);
        sendJson(response, 200, { ok: true, db: dbSnapshot });
        return;
      }

      if (request.method === 'DELETE') {
        const dbSnapshot = disablePublicListShare(user.id, listId);
        sendJson(response, 200, { ok: true, db: dbSnapshot });
        return;
      }

      sendMethodNotAllowed(response, ['POST', 'DELETE']);
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (listRevisionsMatch) {
    try {
      const user = requireAuthenticatedUser(request, response);
      const listId = decodePathComponent(listRevisionsMatch[1], 'List id');

      if (request.method === 'GET') {
        sendJson(response, 200, { revisions: listRevisionsForOwner(user.id, listId) });
        return;
      }

      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        sendJson(response, 200, { revisions: createListCheckpoint(user.id, listId, body?.label) });
        return;
      }

      sendMethodNotAllowed(response, ['GET', 'POST']);
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (listRevisionRestoreMatch) {
    try {
      const user = requireAuthenticatedUser(request, response);
      const listId = decodePathComponent(listRevisionRestoreMatch[1], 'List id');
      const revisionId = decodePathComponent(listRevisionRestoreMatch[2], 'Revision id');

      if (request.method !== 'POST') {
        sendMethodNotAllowed(response, ['POST']);
        return;
      }

      sendJson(response, 200, { ok: true, db: restoreListRevision(user.id, listId, revisionId) });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (publicListMatch) {
    try {
      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, ['GET']);
        return;
      }

      const list = loadPublicListByToken(decodePathComponent(publicListMatch[1], 'Public link token'));
      if (!list) {
        sendText(response, 404, 'Not found');
        return;
      }

      sendJson(response, 200, { list });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  if (url.pathname === '/api/stats') {
    try {
      const user = requireAuthenticatedUser(request, response);

      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, ['GET']);
        return;
      }

      sendJson(response, 200, { stats: loadStorageStats(user.id) });
      return;
    } catch (error) {
      sendError(response, error);
      return;
    }
  }

  serveStatic(request, response, url.pathname);
});

server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.on('error', (error) => {
  console.error(error);
  try {
    db.close();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`Outliner server running at http://${HOST}:${port}`);
  console.log(`SQLite file: ${DB_PATH}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
