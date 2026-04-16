import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  LEGACY_DB_KEY,
  bootstrapDbKey,
  buildDbOperations,
  createDefaultDb,
  loadBootstrapDb,
  migrateLegacyBootstrapDb,
  normalizeDbObject,
  parseDbBackupText,
  serializeDbBackup,
  writeStoredDb
} from '../../storage.js';

test('createDefaultDb produces the full list metadata shape', () => {
  const db = createDefaultDb();
  assert.equal(typeof db.currentId, 'string');
  assert.equal(db.lists.length, 1);
  assert.deepEqual(
    Object.keys(db.lists[0]).sort(),
    [
      'accessRole',
      'canEdit',
      'canLeave',
      'canShare',
      'collaborators',
      'id',
      'isOwner',
      'name',
      'ownerEmail',
      'ownerUserId',
      'publicShareToken',
      'rows'
    ]
  );
  assert.equal(db.lists[0].publicShareToken, '');
  assert.equal(db.lists[0].accessRole, 'owner');
  assert.equal(db.lists[0].canEdit, true);
});

test('normalizeDbObject preserves share metadata and repairs invalid tree shape', () => {
  const normalized = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Shared',
        isOwner: false,
        ownerUserId: 'owner-1',
        ownerEmail: 'owner@example.com',
        accessRole: 'viewer',
        canEdit: false,
        canShare: false,
        canLeave: true,
        publicShareToken: 'public-token',
        collaborators: [{ userId: 'user-2', email: 'friend@example.com', role: 'viewer' }],
        rows: [
          { id: 'row-1', text: 'Root', level: 0 },
          { id: 'row-1', text: 'Impossible jump', level: 4 }
        ]
      }
    ]
  });

  assert.equal(normalized.lists[0].isOwner, false);
  assert.equal(normalized.lists[0].accessRole, 'viewer');
  assert.equal(normalized.lists[0].canEdit, false);
  assert.equal(normalized.lists[0].publicShareToken, 'public-token');
  assert.equal(normalized.lists[0].collaborators[0].email, 'friend@example.com');
  assert.equal(normalized.lists[0].collaborators[0].role, 'viewer');
  assert.deepEqual(normalized.lists[0].rows.map((row) => row.level), [0, 1]);
  assert.equal(new Set(normalized.lists[0].rows.map((row) => row.id)).size, 2);
});

test('serializeDbBackup and parseDbBackupText round-trip wrapped backups', () => {
  const db = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Backup',
        publicShareToken: 'public-token',
        rows: [{ id: 'row-1', text: 'Root', level: 0 }]
      }
    ]
  });

  const serialized = serializeDbBackup(db);
  const parsedJson = JSON.parse(serialized);
  assert.equal(parsedJson.format, BACKUP_FORMAT);
  assert.equal(parsedJson.version, BACKUP_VERSION);

  assert.deepEqual(parseDbBackupText(serialized), db);
});

test('parseDbBackupText also accepts a raw db payload', () => {
  const db = {
    currentId: 'list-1',
    lists: [{ id: 'list-1', name: 'Raw', rows: [{ id: 'row-1', text: 'Root', level: 0 }] }]
  };
  assert.deepEqual(parseDbBackupText(JSON.stringify(db)), normalizeDbObject(db));
});

test('migrateLegacyBootstrapDb moves the legacy cache into the scoped key', () => {
  const previousLocalStorage = globalThis.localStorage;

  try {
    const store = new Map([
      [LEGACY_DB_KEY, JSON.stringify({
        currentId: 'legacy-list',
        lists: [{ id: 'legacy-list', name: 'Legacy', rows: [{ id: 'legacy-row', text: 'Old', level: 0 }] }]
      })]
    ]);

    globalThis.localStorage = {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      }
    };

    assert.equal(loadBootstrapDb('alice').currentId, 'legacy-list');
    assert.equal(migrateLegacyBootstrapDb('alice'), true);
    assert.equal(store.has(LEGACY_DB_KEY), false);
    assert.equal(store.has(bootstrapDbKey('alice')), true);
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
});

test('writeStoredDb surfaces server error messages', async () => {
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'List id already exists.' })
    });

    await assert.rejects(
      writeStoredDb(createDefaultDb()),
      (error) => error?.status === 409 && error.message === 'List id already exists.'
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('buildDbOperations emits row-level updates instead of whole-list rewrites', () => {
  const previousDb = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Shared',
        isOwner: true,
        rows: [
          { id: 'row-1', text: 'Alpha', level: 0, color: '', collapsed: false },
          { id: 'row-2', text: 'Beta', level: 0, color: '', collapsed: false }
        ]
      }
    ]
  });
  const nextDb = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Shared',
        isOwner: true,
        rows: [
          { id: 'row-1', text: 'Alpha updated', level: 0, color: '', collapsed: false },
          { id: 'row-2', text: 'Beta', level: 0, color: '', collapsed: false },
          { id: 'row-3', text: 'Gamma', level: 0, color: '', collapsed: false }
        ]
      }
    ]
  });

  assert.deepEqual(buildDbOperations(previousDb, nextDb), {
    currentId: 'list-1',
    operations: [
      {
        type: 'row-update',
        listId: 'list-1',
        position: 0,
        row: { id: 'row-1', text: 'Alpha updated', level: 0, color: '', collapsed: false, revision: 0 },
        expectedRevision: 0
      },
      {
        type: 'row-create',
        listId: 'list-1',
        position: 2,
        row: { id: 'row-3', text: 'Gamma', level: 0, color: '', collapsed: false, revision: 0 }
      }
    ]
  });
});

test('buildDbOperations ignores local mutations to read-only shared lists', () => {
  const previousDb = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Shared',
        isOwner: false,
        accessRole: 'viewer',
        canEdit: false,
        rows: [{ id: 'row-1', text: 'Alpha', level: 0, collapsed: true }]
      }
    ]
  });
  const nextDb = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Renamed locally',
        isOwner: false,
        accessRole: 'viewer',
        canEdit: false,
        rows: [{ id: 'row-1', text: 'Alpha changed locally', level: 0, collapsed: false }]
      }
    ]
  });

  assert.deepEqual(buildDbOperations(previousDb, nextDb), {
    currentId: 'list-1',
    operations: []
  });
});
