export const DB_KEY_PREFIX = 'tabrows-db-v1';
export const LEGACY_DB_KEY = 'tabrows-db-v1';
export const STORAGE_API_PATH = '/api/db';
export const STORAGE_STATS_API_PATH = '/api/stats';
export const AUTH_SESSION_API_PATH = '/api/auth/session';
export const AUTH_LOGIN_API_PATH = '/api/auth/login';
export const AUTH_REGISTER_API_PATH = '/api/auth/register';
export const AUTH_LOGOUT_API_PATH = '/api/auth/logout';
export const DEFAULT_LIST_NAME = 'Untitled';
export const BACKUP_FORMAT = 'tabrows-backup';
export const BACKUP_VERSION = 1;

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRow(text = '', level = 0, color = '', collapsed = false) {
  return { id: createId(), text, level, color, collapsed };
}

function createDefaultRows() {
  return [
    createRow('TabRows', 0),
    createRow('simple nested rows', 1),
    createRow('select multiple, then Tab', 1, '2'),
    createRow('colour with 1 to 6', 1, '5')
  ];
}

export function createDefaultDb() {
  const listId = createId();
  return {
    currentId: listId,
    lists: [
      {
        id: listId,
        name: 'TabRows',
        rows: createDefaultRows()
      }
    ]
  };
}

export function bootstrapDbKey(userId = 'guest') {
  const scope = typeof userId === 'string' && userId ? userId : 'guest';
  return `${DB_KEY_PREFIX}:${scope}`;
}

function readBootstrapDbForKey(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadBootstrapDb(userId = 'guest') {
  const scopedDb = readBootstrapDbForKey(bootstrapDbKey(userId));
  if (scopedDb) return scopedDb;

  const legacyDb = readBootstrapDbForKey(LEGACY_DB_KEY);
  return legacyDb || createDefaultDb();
}

export function writeBootstrapDb(db, userId = 'guest') {
  try {
    localStorage.setItem(bootstrapDbKey(userId), JSON.stringify(db));
  } catch {
    // ignore bootstrap cache failures
  }
}

export function clearBootstrapDb(userId = 'guest') {
  try {
    localStorage.removeItem(bootstrapDbKey(userId));
  } catch {
    // ignore bootstrap cache failures
  }
}

export function migrateLegacyBootstrapDb(userId = 'guest') {
  const scopedKey = bootstrapDbKey(userId);
  const scopedDb = readBootstrapDbForKey(scopedKey);
  if (scopedDb) return false;

  const legacyDb = readBootstrapDbForKey(LEGACY_DB_KEY);
  if (!legacyDb) return false;

  try {
    localStorage.setItem(scopedKey, JSON.stringify(legacyDb));
    localStorage.removeItem(LEGACY_DB_KEY);
    return true;
  } catch {
    return false;
  }
}

export function normalizeDbObject(db) {
  if (!db || !Array.isArray(db.lists) || !db.lists.length) {
    return createDefaultDb();
  }

  const seenListIds = new Set();
  const seenRowIds = new Set();
  const normalized = {
    currentId: typeof db.currentId === 'string' ? db.currentId : '',
    lists: db.lists.map((list) => normalizeList(list, seenListIds, seenRowIds))
  };

  if (!normalized.lists.some((list) => list.id === normalized.currentId)) {
    normalized.currentId = normalized.lists[0].id;
  }

  return normalized;
}

export function cloneDb(db) {
  if (globalThis.structuredClone) return globalThis.structuredClone(db);
  return JSON.parse(JSON.stringify(db));
}

export function serializeDbBackup(db) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    db: normalizeDbObject(cloneDb(db))
  }, null, 2);
}

export function parseDbBackupText(text) {
  let parsed;

  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }

  const candidate = parsed?.format === BACKUP_FORMAT
    ? parsed.db
    : (parsed?.db || parsed);

  if (!candidate || !Array.isArray(candidate.lists) || !candidate.lists.length) {
    throw new Error('Backup file does not contain a valid TabRows database.');
  }

  return normalizeDbObject(candidate);
}

export async function readStoredDb() {
  const response = await fetch(STORAGE_API_PATH, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const error = new Error(`Storage read failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  return payload?.db || null;
}

export async function readAuthSession() {
  const response = await fetch(AUTH_SESSION_API_PATH, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Session read failed: ${response.status}`);
  }

  return response.json();
}

async function postAuth(url, payload = null) {
  const response = await fetch(url, {
    method: 'POST',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Auth request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

export function loginUser(email, password) {
  return postAuth(AUTH_LOGIN_API_PATH, { email, password });
}

export function registerUser(email, password) {
  return postAuth(AUTH_REGISTER_API_PATH, { email, password });
}

export function logoutUser() {
  return postAuth(AUTH_LOGOUT_API_PATH);
}

export async function readStorageStats() {
  const response = await fetch(STORAGE_STATS_API_PATH, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const error = new Error(`Storage stats failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  return payload?.stats || null;
}

export async function writeStoredDb(db, options = {}) {
  const { keepalive = false } = options;
  const response = await fetch(STORAGE_API_PATH, {
    method: 'PUT',
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db })
  });

  if (!response.ok) {
    const error = new Error(`Storage write failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
}

function normalizeList(list, seenListIds = new Set(), seenRowIds = new Set()) {
  return {
    id: normalizeUniqueId(list?.id, seenListIds),
    name: normalizeListName(list?.name),
    rows: normalizeRows(Array.isArray(list?.rows) ? list.rows : [], seenRowIds)
  };
}

function normalizeRows(rows, seenRowIds = new Set()) {
  let previousLevel = 0;

  return rows.map((row, index) => {
    const normalized = normalizeRow(row, seenRowIds);
    const maximumLevel = index === 0 ? 0 : previousLevel + 1;
    normalized.level = Math.max(0, Math.min(normalized.level, maximumLevel));
    previousLevel = normalized.level;
    return normalized;
  });
}

function normalizeRow(row, seenRowIds = new Set()) {
  return {
    id: normalizeUniqueId(row?.id, seenRowIds),
    text: typeof row?.text === 'string' ? normalizeText(row.text) : '',
    level: Number.isInteger(row?.level) ? Math.max(0, row.level) : 0,
    color: typeof row?.color === 'string' ? row.color : '',
    collapsed: Boolean(row?.collapsed)
  };
}

function normalizeUniqueId(value, seenIds) {
  let id = typeof value === 'string' && value ? value : createId();
  while (seenIds.has(id)) id = createId();
  seenIds.add(id);
  return id;
}

export function normalizeListName(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || DEFAULT_LIST_NAME;
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}
