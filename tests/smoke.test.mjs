import assert from 'node:assert/strict';

import {
  LEGACY_DB_KEY,
  bootstrapDbKey,
  loadBootstrapDb,
  migrateLegacyBootstrapDb,
  normalizeDbObject,
  parseDbBackupText,
  serializeDbBackup
} from '../storage.js';
import { renderMarkdown } from '../markdown.js';

{
  assert.equal(
    renderMarkdown('- A\n1. B\n2. C\n- D'),
    '<ul><li>A</li></ul><ol><li>B</li><li>C</li></ol><ul><li>D</li></ul>'
  );
}

{
  assert.equal(
    renderMarkdown('2. Iron Panel'),
    '2. Iron Panel'
  );
}

{
  assert.equal(
    renderMarkdown('> **A**  >B'),
    '<blockquote><strong>A</strong><br>B</blockquote>'
  );
}

{
  assert.equal(
    renderMarkdown('| A | B | | - | - | | 1 | 2 |'),
    '<div class="md-table-wrap"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
  );
}

{
  const db = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Test',
        rows: [
          { id: 'row-1', text: 'Root', level: 0 },
          { id: 'row-2', text: 'Impossible jump', level: 4 },
          { id: 'row-2', text: 'Duplicate id', level: 7 }
        ]
      }
    ]
  });

  assert.deepEqual(
    db.lists[0].rows.map((row) => row.level),
    [0, 1, 2]
  );
  assert.equal(new Set(db.lists[0].rows.map((row) => row.id)).size, 3);
}

{
  const originalDb = {
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Backup test',
        rows: [{ id: 'row-1', text: 'Root', level: 0, color: '', collapsed: false }]
      }
    ]
  };

  const parsedBackup = parseDbBackupText(serializeDbBackup(originalDb));
  assert.deepEqual(parsedBackup, normalizeDbObject(originalDb));
}

{
  assert.throws(
    () => parseDbBackupText('{'),
    /valid JSON/
  );
}

{
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

    const legacyDb = loadBootstrapDb('alice');
    assert.equal(legacyDb.currentId, 'legacy-list');
    assert.equal(migrateLegacyBootstrapDb('alice'), true);
    assert.equal(store.has(LEGACY_DB_KEY), false);
    assert.equal(store.has(bootstrapDbKey('alice')), true);
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
}

console.log('Smoke checks passed.');
