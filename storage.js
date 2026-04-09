export const DB_KEY = 'tabrows-db-v1';
export const STORAGE_API_PATH = '/api/db';
export const STORAGE_STATS_API_PATH = '/api/stats';
export const DEFAULT_LIST_NAME = 'Untitled';

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
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

export function loadBootstrapDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : createDefaultDb();
  } catch {
    return createDefaultDb();
  }
}

export function writeBootstrapDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // ignore bootstrap cache failures
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

export async function readStoredDb() {
  const response = await fetch(STORAGE_API_PATH, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Storage read failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload?.db || null;
}

export async function readStorageStats() {
  const response = await fetch(STORAGE_STATS_API_PATH, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Storage stats failed: ${response.status}`);
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
    throw new Error(`Storage write failed: ${response.status}`);
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
