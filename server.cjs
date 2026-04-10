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
    name TEXT NOT NULL,
    position INTEGER NOT NULL
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
  CREATE INDEX IF NOT EXISTS idx_lists_user_position ON lists (user_id, position);
  CREATE INDEX IF NOT EXISTS idx_rows_list_position ON rows (list_id, position);
`);

ensureColumn('lists', 'user_id', 'user_id TEXT');

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
const selectUserLists = db.prepare('SELECT id, name FROM lists WHERE user_id = ? ORDER BY position, rowid');
const selectUserRows = db.prepare(`
  SELECT
    rows.id,
    rows.list_id AS listId,
    rows.text,
    rows.level,
    rows.color,
    rows.collapsed
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  WHERE lists.user_id = ?
  ORDER BY lists.position, rows.position, rows.rowid
`);
const selectUserListCount = db.prepare('SELECT COUNT(*) AS count FROM lists WHERE user_id = ?');
const selectUserRowCount = db.prepare(`
  SELECT COUNT(*) AS count
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  WHERE lists.user_id = ?
`);
const selectUserColoredRowCount = db.prepare(`
  SELECT COUNT(*) AS count
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  WHERE lists.user_id = ? AND rows.color <> ''
`);
const selectUserCollapsedRowCount = db.prepare(`
  SELECT COUNT(*) AS count
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  WHERE lists.user_id = ? AND rows.collapsed = 1
`);
const selectUserMaxLevel = db.prepare(`
  SELECT COALESCE(MAX(rows.level), -1) AS maxLevel
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  WHERE lists.user_id = ?
`);
const selectCurrentListStats = db.prepare(`
  SELECT lists.name AS name, COUNT(rows.id) AS rowCount
  FROM lists
  LEFT JOIN rows ON rows.list_id = lists.id
  WHERE lists.user_id = ? AND lists.id = ?
  GROUP BY lists.id, lists.name
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
const insertList = db.prepare('INSERT INTO lists (id, user_id, name, position) VALUES (?, ?, ?, ?)');
const insertRow = db.prepare('INSERT INTO rows (id, list_id, text, level, color, collapsed, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
const deleteUserLists = db.prepare('DELETE FROM lists WHERE user_id = ?');
const claimUnownedLists = db.prepare('UPDATE lists SET user_id = ? WHERE user_id IS NULL');

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function createId() {
  return crypto.randomUUID();
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function normalizeListName(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || DEFAULT_LIST_NAME;
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw createHttpError(400, 'Password must be at least 8 characters.');
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
  const lists = selectUserLists.all(userId);
  if (!lists.length) return null;

  const rowsByList = new Map();
  selectUserRows.all(userId).forEach((row) => {
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

  const user = selectUserById.get(userId);
  const currentId = user?.currentListId;

  return {
    currentId: lists.some((list) => list.id === currentId) ? currentId : lists[0].id,
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      rows: rowsByList.get(list.id) || []
    }))
  };
}

function saveDbToSqlite(userId, payload) {
  const normalized = normalizeDbPayload(payload);
  if (!normalized) {
    throw createHttpError(400, 'Invalid database payload.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    deleteUserLists.run(userId);

    normalized.lists.forEach((list, listIndex) => {
      insertList.run(list.id, userId, list.name, listIndex);
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

    updateUserCurrentList.run(normalized.currentId, userId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return normalized;
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
  const currentList = user?.currentListId ? selectCurrentListStats.get(userId, user.currentListId) : null;
  const fileStats = fs.statSync(DB_PATH);
  const listCount = selectUserListCount.get(userId).count;
  const rowCount = selectUserRowCount.get(userId).count;
  const coloredRowCount = selectUserColoredRowCount.get(userId).count;
  const collapsedRowCount = selectUserCollapsedRowCount.get(userId).count;
  const maxLevel = selectUserMaxLevel.get(userId).maxLevel;

  return {
    dbPath: RELATIVE_DB_PATH,
    fileSizeBytes: fileStats.size,
    updatedAt: fileStats.mtime.toISOString(),
    userEmail: user?.email || null,
    listCount,
    rowCount,
    coloredRowCount,
    collapsedRowCount,
    maxDepth: maxLevel < 0 ? 0 : maxLevel + 1,
    currentListName: currentList?.name || null,
    currentListRowCount: currentList ? Number(currentList.rowCount) : 0
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

  raw.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join('='));
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

    request.on('error', rejectOnce);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(text);
}

function sendMethodNotAllowed(response, methods) {
  response.writeHead(405, {
    'Content-Type': 'text/plain; charset=utf-8',
    Allow: methods.join(', ')
  });
  response.end('Method not allowed');
}

function sendError(response, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  sendJson(response, statusCode, {
    error: statusCode === 500 ? 'Internal server error.' : error.message
  });
}

function serveStatic(response, pathname) {
  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) {
    sendText(response, 404, 'Not found');
    return;
  }

  const filePath = path.join(ROOT_DIR, fileName);
  const extension = path.extname(fileName);

  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(content);
  } catch {
    sendText(response, 404, 'Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);

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

server.listen(PORT, HOST, () => {
  console.log(`TabRows server running at http://${HOST}:${PORT}`);
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
