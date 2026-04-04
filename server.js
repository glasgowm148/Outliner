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

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
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
`);

const selectCurrentId = db.prepare('SELECT value FROM app_meta WHERE key = ?');
const selectLists = db.prepare('SELECT id, name FROM lists ORDER BY position, rowid');
const selectListCount = db.prepare('SELECT COUNT(*) AS count FROM lists');
const selectRowCount = db.prepare('SELECT COUNT(*) AS count FROM rows');
const selectColoredRowCount = db.prepare(`SELECT COUNT(*) AS count FROM rows WHERE color <> ''`);
const selectCollapsedRowCount = db.prepare('SELECT COUNT(*) AS count FROM rows WHERE collapsed = 1');
const selectMaxLevel = db.prepare('SELECT COALESCE(MAX(level), -1) AS maxLevel FROM rows');
const selectCurrentListStats = db.prepare(`
  SELECT lists.name AS name, COUNT(rows.id) AS rowCount
  FROM lists
  LEFT JOIN rows ON rows.list_id = lists.id
  WHERE lists.id = ?
  GROUP BY lists.id, lists.name
`);
const selectRows = db.prepare(`
  SELECT
    rows.id,
    rows.list_id AS listId,
    rows.text,
    rows.level,
    rows.color,
    rows.collapsed
  FROM rows
  JOIN lists ON lists.id = rows.list_id
  ORDER BY lists.position, rows.position, rows.rowid
`);
const deleteRows = db.prepare('DELETE FROM rows');
const deleteLists = db.prepare('DELETE FROM lists');
const deleteCurrentId = db.prepare('DELETE FROM app_meta WHERE key = ?');
const insertList = db.prepare('INSERT INTO lists (id, name, position) VALUES (?, ?, ?)');
const insertRow = db.prepare('INSERT INTO rows (id, list_id, text, level, color, collapsed, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
const upsertCurrentId = db.prepare(`
  INSERT INTO app_meta (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function normalizeListName(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || DEFAULT_LIST_NAME;
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

function normalizeList(list) {
  return {
    id: typeof list?.id === 'string' && list.id ? list.id : createId(),
    name: normalizeListName(list?.name),
    rows: Array.isArray(list?.rows) ? list.rows.map((row) => normalizeRow(row)) : []
  };
}

function normalizeDbPayload(payload) {
  if (!payload || !Array.isArray(payload.lists) || !payload.lists.length) return null;

  const lists = payload.lists.map((list) => normalizeList(list));
  const currentId = lists.some((list) => list.id === payload.currentId)
    ? payload.currentId
    : lists[0].id;

  return { currentId, lists };
}

function loadDbFromSqlite() {
  const lists = selectLists.all();
  if (!lists.length) return null;

  const rowsByList = new Map();
  selectRows.all().forEach((row) => {
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

  const currentId = selectCurrentId.get('currentId')?.value;

  return {
    currentId: lists.some((list) => list.id === currentId) ? currentId : lists[0].id,
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      rows: rowsByList.get(list.id) || []
    }))
  };
}

function saveDbToSqlite(payload) {
  const normalized = normalizeDbPayload(payload);
  if (!normalized) {
    throw createHttpError(400, 'Invalid database payload.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    deleteRows.run();
    deleteLists.run();
    deleteCurrentId.run('currentId');

    normalized.lists.forEach((list, listIndex) => {
      insertList.run(list.id, list.name, listIndex);
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

    upsertCurrentId.run('currentId', normalized.currentId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return normalized;
}

function loadStorageStats() {
  const currentId = selectCurrentId.get('currentId')?.value || null;
  const listCount = selectListCount.get().count;
  const rowCount = selectRowCount.get().count;
  const coloredRowCount = selectColoredRowCount.get().count;
  const collapsedRowCount = selectCollapsedRowCount.get().count;
  const maxLevel = selectMaxLevel.get().maxLevel;
  const currentList = currentId ? selectCurrentListStats.get(currentId) : null;
  const fileStats = fs.statSync(DB_PATH);

  return {
    dbPath: RELATIVE_DB_PATH,
    fileSizeBytes: fileStats.size,
    updatedAt: fileStats.mtime.toISOString(),
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

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(createHttpError(413, 'Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(createHttpError(400, 'Invalid JSON body.'));
      }
    });

    request.on('error', reject);
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

  if (url.pathname === '/api/db') {
    try {
      if (request.method === 'GET') {
        sendJson(response, 200, { db: loadDbFromSqlite() });
        return;
      }

      if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        const dbPayload = body?.db || body;
        const savedDb = saveDbToSqlite(dbPayload);
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
      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, ['GET']);
        return;
      }

      sendJson(response, 200, { stats: loadStorageStats() });
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
