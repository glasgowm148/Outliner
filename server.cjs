const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4310);
const ROOT_DIR = __dirname;
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.TABROWS_DB_PATH
  ? path.resolve(process.env.TABROWS_DB_PATH)
  : path.join(process.env.TABROWS_DATA_DIR ? path.resolve(process.env.TABROWS_DATA_DIR) : DEFAULT_DATA_DIR, 'tabrows.sqlite');
const RELATIVE_DB_PATH = path.relative(ROOT_DIR, DB_PATH) || path.basename(DB_PATH);
const DEFAULT_LIST_NAME = 'Untitled';
const SESSION_COOKIE_NAME = 'tabrows_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.TABROWS_SECURE_COOKIES === '1';
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;
const REVISION_LIMIT = 50;

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
    rows.collapsed
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
    users.email AS email
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
    lists.position
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
    lists.user_id AS ownerUserId,
    users.email AS ownerEmail
  FROM lists
  JOIN users ON users.id = lists.user_id
  WHERE lists.public_token = ?
`);
const selectRowsByListId = db.prepare(`
  SELECT id, text, level, color, collapsed
  FROM rows
  WHERE list_id = ?
  ORDER BY position, rowid
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
const insertRow = db.prepare('INSERT INTO rows (id, list_id, text, level, color, collapsed, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
const deleteUserLists = db.prepare('DELETE FROM lists WHERE user_id = ?');
const claimUnownedLists = db.prepare('UPDATE lists SET user_id = ? WHERE user_id IS NULL');
const insertListShare = db.prepare('INSERT OR IGNORE INTO list_shares (list_id, user_id, created_at) VALUES (?, ?, ?)');
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

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function normalizeListName(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || DEFAULT_LIST_NAME;
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

function normalizeRow(row) {
  return {
    id: typeof row?.id === 'string' && row.id ? row.id : createId(),
    text: typeof row?.text === 'string' ? normalizeText(row.text) : '',
    level: Number.isInteger(row?.level) ? Math.max(0, row.level) : 0,
    color: typeof row?.color === 'string' ? row.color : '',
    collapsed: Boolean(row?.collapsed)
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

function normalizeList(list) {
  return {
    id: typeof list?.id === 'string' && list.id ? list.id : createId(),
    name: normalizeListName(list?.name),
    rows: normalizeRows(Array.isArray(list?.rows) ? list.rows : [])
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
  assertUniqueSnapshotIds(lists);
  const currentId = lists.some((list) => list.id === payload.currentId)
    ? payload.currentId
    : lists[0].id;

  return { currentId, lists };
}

function loadDbFromSqlite(userId) {
  const lists = selectAccessibleLists.all(userId, userId, userId, userId, userId);
  if (!lists.length) return null;

  const rowsByList = new Map();
  selectAccessibleRows.all(userId, userId, userId, userId).forEach((row) => {
    const rows = rowsByList.get(row.listId) || [];
    rows.push({
      id: row.id,
      text: row.text,
      level: row.level,
      color: row.color,
      collapsed: Boolean(row.collapsed)
    });
    rowsByList.set(row.listId, rows);
  });

  const collaboratorsByList = new Map();
  selectListCollaborators.all(userId).forEach((collaborator) => {
    const collaborators = collaboratorsByList.get(collaborator.listId) || [];
    collaborators.push({
      userId: collaborator.userId,
      email: collaborator.email
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
  const anyExistingIds = new Set(
    normalized.lists
      .map((list) => selectListById.get(list.id)?.id || '')
      .filter(Boolean)
  );
  const ownedListsInPayload = normalized.lists.filter((list) => {
    const existing = accessibleLists.get(list.id);
    if (!existing) return !anyExistingIds.has(list.id);
    return existing.ownerUserId === userId;
  });
  const ownedPositions = new Map(ownedListsInPayload.map((list, index) => [list.id, index]));

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
      const existsGlobally = anyExistingIds.has(list.id);
      const currentSnapshot = existing ? loadListSnapshotById(list.id) : null;
      const nextSnapshot = {
        id: list.id,
        name: list.name,
        rows: list.rows
      };
      const snapshotChanged = currentSnapshot
        ? snapshotComparableValue(currentSnapshot) !== snapshotComparableValue(nextSnapshot)
        : true;

      if (!existing && existsGlobally) {
        return;
      }

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
        if (snapshotChanged) {
          recordListRevision(list.id, existing.ownerUserId, 'auto');
          updateListName.run(list.name, list.id);
          deleteRowsByListId.run(list.id);
        } else {
          return;
        }
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

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (COOKIE_SECURE) parts.push('Secure');
  appendResponseHeader(response, 'Set-Cookie', parts.join('; '));
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
  const sessionId = parseCookies(request)[SESSION_COOKIE_NAME];
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
      collapsed: Boolean(row.collapsed)
    }))
  };
}

function normalizeRevisionLabel(value) {
  return String(value ?? '').trim().slice(0, 80);
}

function normalizeListSnapshot(snapshot, listId) {
  return {
    id: listId,
    name: normalizeListName(snapshot?.name),
    rows: normalizeRows(Array.isArray(snapshot?.rows) ? snapshot.rows : [])
  };
}

function snapshotComparableValue(snapshot) {
  return JSON.stringify({
    name: normalizeListName(snapshot?.name),
    rows: normalizeRows(Array.isArray(snapshot?.rows) ? snapshot.rows : [])
  });
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

  return selectListRevisions.all(listId, ownerUserId, REVISION_LIMIT).map((revision) => {
    let rowCount = 0;
    try {
      const snapshot = JSON.parse(revision.snapshotJson);
      rowCount = Array.isArray(snapshot?.rows) ? snapshot.rows.length : 0;
    } catch {
      rowCount = 0;
    }

    return {
      id: revision.id,
      kind: revision.kind,
      label: revision.label,
      createdAt: revision.createdAt,
      rowCount
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

function shareListWithUser(ownerUserId, listId, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw createHttpError(400, 'Enter a valid email address.');
  }

  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can share this list.');

  const user = selectUserByEmail.get(normalizedEmail);
  if (!user) throw createHttpError(404, 'That user does not exist yet.');
  if (user.id === ownerUserId) throw createHttpError(400, 'You already own this list.');

  insertListShare.run(listId, user.id, new Date().toISOString());
  return loadDbFromSqlite(ownerUserId);
}

function revokeListShareForUser(ownerUserId, listId, shareUserId) {
  const list = selectListById.get(listId);
  if (!list) throw createHttpError(404, 'List not found.');
  if (list.ownerUserId !== ownerUserId) throw createHttpError(403, 'Only the list owner can manage collaborators.');
  if (typeof shareUserId !== 'string' || !shareUserId.trim()) {
    throw createHttpError(400, 'Collaborator user id is required.');
  }

  deleteListShare.run(listId, shareUserId.trim());
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
    ownerEmail: list.ownerEmail,
    rows: selectRowsByListId.all(list.id).map((row) => ({
      id: row.id,
      text: row.text,
      level: row.level,
      color: row.color,
      collapsed: Boolean(row.collapsed)
    }))
  };
}

function registerUser(email, password, response) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw createHttpError(400, 'Enter a valid email address.');
  }
  validatePassword(password);

  if (selectUserByEmail.get(normalizedEmail)) {
    throw createHttpError(409, 'An account with that email already exists.');
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
  if (!user || !verifyPassword(String(password ?? ''), user.passwordSalt, user.passwordHash)) {
    throw createHttpError(401, 'Incorrect email or password.');
  }

  createSession(user.id, response);
  return selectUserById.get(user.id);
}

function logoutUser(request, response) {
  const sessionId = parseCookies(request)[SESSION_COOKIE_NAME];
  if (sessionId) {
    deleteSessionById.run(sessionId);
  }
  clearSessionCookie(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

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
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        rejectOnce(createHttpError(413, 'Request body too large.'));
        request.destroy();
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
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
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
    'Content-Type': 'text/plain; charset=utf-8'
  }));
  response.end(text);
}

function sendMethodNotAllowed(response, methods) {
  response.writeHead(405, defaultHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    Allow: methods.join(', ')
  }));
  response.end('Method not allowed');
}

function sendError(response, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  sendJson(response, statusCode, {
    error: statusCode === 500 ? 'Internal server error.' : error.message
  });
}

function serveStatic(response, pathname) {
  if (pathname.startsWith('/public/')) {
    pathname = '/';
  }

  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) {
    sendText(response, 404, 'Not found');
    return;
  }

  const filePath = path.join(ROOT_DIR, fileName);
  const extension = path.extname(fileName);

  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, defaultHeaders({
      'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    }));
    response.end(content);
  } catch {
    sendText(response, 404, 'Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
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

  if (listShareMatch) {
    try {
      const user = requireAuthenticatedUser(request, response);
      const listId = decodePathComponent(listShareMatch[1], 'List id');

      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        const dbSnapshot = shareListWithUser(user.id, listId, body?.email);
        sendJson(response, 200, { ok: true, db: dbSnapshot });
        return;
      }

      if (request.method === 'DELETE') {
        const body = await readJsonBody(request);
        const dbSnapshot = revokeListShareForUser(user.id, listId, body?.userId);
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

  serveStatic(response, url.pathname);
});

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
  console.log(`TabRows server running at http://${HOST}:${port}`);
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
