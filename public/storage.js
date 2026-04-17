export const DB_KEY_PREFIX = 'outliner-db-v1';
export const LEGACY_DB_KEY = 'tabrows-db-v1';
export const STORAGE_API_PATH = '/api/db';
export const STORAGE_OPS_API_PATH = '/api/db/ops';
export const STORAGE_STATS_API_PATH = '/api/stats';
export const AUTH_SESSION_API_PATH = '/api/auth/session';
export const AUTH_LOGIN_API_PATH = '/api/auth/login';
export const AUTH_REGISTER_API_PATH = '/api/auth/register';
export const AUTH_LOGOUT_API_PATH = '/api/auth/logout';
export const LIST_SHARE_API_PATH = '/api/lists';
export const PUBLIC_LIST_API_PATH = '/api/public';
export const DEFAULT_LIST_NAME = 'Untitled';
export const BACKUP_FORMAT = 'outliner-backup';
export const BACKUP_VERSION = 1;
const LEGACY_BACKUP_FORMAT = 'tabrows-backup';
const MUTATION_HEADERS = { 'X-Outliner-Request': '1' };
let fallbackIdCounter = 0;

function jsonMutationHeaders() {
  return { ...MUTATION_HEADERS, 'Content-Type': 'application/json' };
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `id-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  fallbackIdCounter = (fallbackIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `id-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

export function createRow(text = '', level = 0, color = '', collapsed = false) {
  return { id: createId(), text, level, color, collapsed, revision: 0 };
}

function createDefaultRows() {
  return [
    createRow('Outliner', 0),
    createRow('simple nested rows', 1),
    createRow('select multiple, then Tab', 1, '2'),
    createRow('colour with 1 to 9', 1, '5')
  ];
}

export function createDefaultDb() {
  const listId = createId();
  return {
    currentId: listId,
    lists: [
      {
        id: listId,
        name: 'Outliner',
        isOwner: true,
        ownerUserId: '',
        ownerEmail: '',
        accessRole: 'owner',
        canEdit: true,
        canShare: true,
        canLeave: false,
        publicShareToken: '',
        collaborators: [],
        rows: createDefaultRows()
      }
    ]
  };
}

export function bootstrapDbKey(userId = 'guest') {
  const scope = typeof userId === 'string' && userId ? userId : 'guest';
  return `${DB_KEY_PREFIX}:${scope}`;
}

function legacyBootstrapDbKeys(userId = 'guest') {
  const scope = typeof userId === 'string' && userId ? userId : 'guest';
  return [`${LEGACY_DB_KEY}:${scope}`, LEGACY_DB_KEY];
}

function readLegacyBootstrapDb(userId = 'guest') {
  for (const key of legacyBootstrapDbKeys(userId)) {
    const db = readBootstrapDbForKey(key);
    if (db) return { key, db };
  }
  return null;
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
  // Keep a per-user bootstrap cache so the UI can paint immediately before the
  // authenticated SQLite snapshot finishes hydrating.
  const scopedDb = readBootstrapDbForKey(bootstrapDbKey(userId));
  if (scopedDb) return scopedDb;

  return readLegacyBootstrapDb(userId)?.db || createDefaultDb();
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

  const legacy = readLegacyBootstrapDb(userId);
  if (!legacy) return false;

  try {
    localStorage.setItem(scopedKey, JSON.stringify(legacy.db));
    localStorage.removeItem(legacy.key);
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

  const candidate = (parsed?.format === BACKUP_FORMAT || parsed?.format === LEGACY_BACKUP_FORMAT)
    ? parsed.db
    : (parsed?.db || parsed);

  if (!candidate || !Array.isArray(candidate.lists) || !candidate.lists.length) {
    throw new Error('Backup file does not contain a valid Outliner database.');
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
    headers: payload ? jsonMutationHeaders() : MUTATION_HEADERS,
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
    headers: jsonMutationHeaders(),
    body: JSON.stringify({ db })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Storage write failed: ${response.status}`);
    error.status = response.status;
    error.code = body?.code || '';
    error.details = body?.details || null;
    throw error;
  }

  return body?.db || null;
}

function normalizeDbForDiff(db) {
  if (!db || !Array.isArray(db.lists)) {
    return { currentId: '', lists: [] };
  }
  return normalizeDbObject(cloneDb(db));
}

function comparableRow(row) {
  return {
    text: normalizeText(row?.text),
    level: Number.isInteger(row?.level) ? Math.max(0, row.level) : 0,
    color: typeof row?.color === 'string' ? row.color : '',
    collapsed: Boolean(row?.collapsed)
  };
}

function sameRow(a, b) {
  if (!a || !b) return false;
  const left = comparableRow(a);
  const right = comparableRow(b);
  return left.text === right.text
    && left.level === right.level
    && left.color === right.color
    && left.collapsed === right.collapsed;
}

function serializeRow(row) {
  const normalized = comparableRow(row);
  return {
    id: typeof row?.id === 'string' ? row.id : createId(),
    text: normalized.text,
    level: normalized.level,
    color: normalized.color,
    collapsed: normalized.collapsed,
    revision: Number.isInteger(row?.revision) ? Math.max(0, row.revision) : 0
  };
}

export function buildDbOperations(previousDb, nextDb) {
  const previous = normalizeDbForDiff(previousDb);
  const next = normalizeDbForDiff(nextDb);
  const operations = [];
  const previousListsById = new Map(previous.lists.map((list) => [list.id, list]));
  const nextListsById = new Map(next.lists.map((list) => [list.id, list]));
  const previousOwnedIds = previous.lists.filter((list) => list.isOwner !== false).map((list) => list.id);
  const nextOwnedIds = next.lists.filter((list) => list.isOwner !== false).map((list) => list.id);
  const nextOwnedPositions = new Map(nextOwnedIds.map((id, index) => [id, index]));

  next.lists.forEach((list) => {
    if (previousListsById.has(list.id)) return;
    if (list.isOwner === false) return;

    operations.push({
      type: 'list-create',
      list: {
        id: list.id,
        name: normalizeListName(list.name),
        position: nextOwnedPositions.get(list.id) ?? 0
      }
    });

    list.rows.forEach((row, position) => {
      operations.push({
        type: 'row-create',
        listId: list.id,
        position,
        row: serializeRow(row)
      });
    });
  });

  next.lists.forEach((list) => {
    const previousList = previousListsById.get(list.id);
    if (!previousList) return;
    const canWriteList = list.isOwner !== false || list.canEdit !== false;
    if (!canWriteList) return;

    const nextName = normalizeListName(list.name);
    const previousName = normalizeListName(previousList.name);
    const nextPosition = list.isOwner === false ? null : (nextOwnedPositions.get(list.id) ?? 0);
    const previousPosition = previousList.isOwner === false ? null : previousOwnedIds.indexOf(list.id);

    if (
      nextName !== previousName
      || (nextPosition !== null && previousPosition !== nextPosition)
    ) {
      operations.push({
        type: 'list-update',
        listId: list.id,
        name: nextName,
        ...(nextPosition === null ? {} : { position: nextPosition })
      });
    }

    const previousRowsById = new Map(previousList.rows.map((row, index) => [row.id, { row, index }]));
    const nextRowsById = new Map(list.rows.map((row, index) => [row.id, { row, index }]));

    previousList.rows.forEach((row) => {
      if (nextRowsById.has(row.id)) return;
      operations.push({
        type: 'row-delete',
        listId: list.id,
        rowId: row.id,
        expectedRevision: Number.isInteger(row?.revision) ? Math.max(0, row.revision) : 0
      });
    });

    list.rows.forEach((row, position) => {
      const previousEntry = previousRowsById.get(row.id);
      if (!previousEntry) {
        operations.push({
          type: 'row-create',
          listId: list.id,
          position,
          row: serializeRow(row)
        });
        return;
      }

      if (previousEntry.index === position && sameRow(previousEntry.row, row)) return;

      operations.push({
        type: 'row-update',
        listId: list.id,
        position,
        row: serializeRow(row),
        expectedRevision: Number.isInteger(previousEntry.row?.revision) ? Math.max(0, previousEntry.row.revision) : 0
      });
    });
  });

  previous.lists.forEach((list) => {
    if (nextListsById.has(list.id)) return;
    if (list.isOwner === false) return;
    operations.push({
      type: 'list-delete',
      listId: list.id
    });
  });

  return {
    currentId: next.currentId,
    operations
  };
}

export async function writeStoredDbOps(previousDb, nextDb, options = {}) {
  const { keepalive = false } = options;
  const payload = buildDbOperations(previousDb, nextDb);

  if (
    payload.currentId === normalizeDbForDiff(previousDb).currentId
    && payload.operations.length === 0
  ) {
    return normalizeDbForDiff(previousDb);
  }

  const response = await fetch(STORAGE_OPS_API_PATH, {
    method: 'POST',
    keepalive,
    headers: jsonMutationHeaders(),
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Storage write failed: ${response.status}`);
    error.status = response.status;
    error.code = body?.code || '';
    error.details = body?.details || null;
    throw error;
  }

  return body?.db || normalizeDbForDiff(nextDb);
}

export async function shareListWithEmail(listId, email, role = 'editor') {
  return postAuth(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/share`, { email, role });
}

export async function updateListShareRole(listId, userId, role) {
  const response = await fetch(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/share`, {
    method: 'PATCH',
    headers: jsonMutationHeaders(),
    body: JSON.stringify({ userId, role })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Share role update failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function revokeListShare(listId, userId) {
  const response = await fetch(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/share`, {
    method: 'DELETE',
    headers: jsonMutationHeaders(),
    body: JSON.stringify({ userId })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Share revoke failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function leaveSharedList(listId) {
  return postAuth(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/leave`);
}

export async function enablePublicListShare(listId) {
  return postAuth(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/public-link`);
}

export async function disablePublicListShare(listId) {
  const response = await fetch(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/public-link`, {
    method: 'DELETE',
    headers: MUTATION_HEADERS
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Public share update failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function readPublicList(token) {
  const response = await fetch(`${PUBLIC_LIST_API_PATH}/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const error = new Error(`Public list read failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  return payload?.list || null;
}

export async function readListRevisions(listId) {
  const response = await fetch(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/revisions`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body?.error || `Revision read failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return Array.isArray(body?.revisions) ? body.revisions : [];
}

export async function createListCheckpoint(listId, label = '') {
  const body = await postAuth(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/revisions`, { label });
  return Array.isArray(body?.revisions) ? body.revisions : [];
}

export async function restoreListRevision(listId, revisionId) {
  return postAuth(`${LIST_SHARE_API_PATH}/${encodeURIComponent(listId)}/revisions/${encodeURIComponent(revisionId)}/restore`);
}

function normalizeList(list, seenListIds = new Set(), seenRowIds = new Set()) {
  const isOwner = list?.isOwner !== false;
  const accessRole = typeof list?.accessRole === 'string' ? list.accessRole : (isOwner ? 'owner' : 'editor');
  const canEdit = typeof list?.canEdit === 'boolean'
    ? list.canEdit
    : (isOwner || accessRole === 'editor');

  return {
    id: normalizeUniqueId(list?.id, seenListIds),
    name: normalizeListName(list?.name),
    isOwner,
    ownerUserId: typeof list?.ownerUserId === 'string' ? list.ownerUserId : '',
    ownerEmail: typeof list?.ownerEmail === 'string' ? list.ownerEmail : '',
    accessRole,
    canEdit,
    canShare: Boolean(list?.canShare ?? list?.isOwner ?? true),
    canLeave: Boolean(list?.canLeave),
    publicShareToken: typeof list?.publicShareToken === 'string' ? list.publicShareToken : '',
    collaborators: Array.isArray(list?.collaborators)
      ? list.collaborators
        .map((collaborator) => ({
          userId: typeof collaborator?.userId === 'string' ? collaborator.userId : '',
          email: typeof collaborator?.email === 'string' ? collaborator.email : '',
          role: collaborator?.role === 'viewer' ? 'viewer' : 'editor'
        }))
        .filter((collaborator) => collaborator.userId && collaborator.email)
      : [],
    rows: normalizeRows(Array.isArray(list?.rows) ? list.rows : [], seenRowIds)
  };
}

function normalizeRows(rows, seenRowIds = new Set()) {
  let previousLevel = 0;

  return rows.map((row, index) => {
    const normalized = normalizeRow(row, seenRowIds);
    // Normalize impossible jumps back into a valid tree instead of trusting
    // imported or stale snapshots to already be structurally sound.
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
    collapsed: Boolean(row?.collapsed),
    revision: Number.isInteger(row?.revision) ? Math.max(0, row.revision) : 0
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
  return String(value ?? '').replace(/\r\n?/g, '\n');
}
