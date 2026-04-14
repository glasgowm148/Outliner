import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

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
import { parsePastedRows } from '../outline.js';

async function waitForServerUrl(child, stdout, stderr) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    const output = stdout.join('');
    const match = output.match(/TabRows server running at (http:\/\/[^\s]+)/);
    if (match) return match[1];
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\n${stderr.join('')}${output}`);
    }
    await delay(25);
  }

  throw new Error(`Server did not report a URL.\n${stderr.join('')}${stdout.join('')}`);
}

async function requestJson(url, options = {}) {
  const { method = 'GET', body, cookie = '' } = options;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  const nextCookie = response.headers.get('set-cookie')?.split(';', 1)[0] || cookie;
  return { response, payload, cookie: nextCookie };
}

function rowRowid(dbPath, rowId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT rowid AS rowid FROM rows WHERE id = ?').get(rowId)?.rowid || 0;
  } finally {
    db.close();
  }
}

{
  assert.equal(normalizeDbObject({
    currentId: 'list-1',
    lists: [{ id: 'list-1', name: 'CR test', rows: [{ id: 'row-1', text: 'A\rB', level: 0 }] }]
  }).lists[0].rows[0].text, 'A\nB');
}

{
  assert.equal(
    renderMarkdown('- A\n1. B\n2. C\n- D'),
    '<ul><li>A</li></ul><ol><li>B</li><li>C</li></ol><ul><li>D</li></ul>'
  );
}

{
  assert.equal(
    renderMarkdown('+ A\n+ B'),
    '<ul><li>A</li><li>B</li></ul>'
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
    renderMarkdown('1. one\n\n2. two'),
    '<ol><li>one</li><li>two</li></ol>'
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
    renderMarkdown('> quote\n> - item\n> - item2'),
    '<blockquote>quote<ul><li>item</li><li>item2</li></ul></blockquote>'
  );
}

{
  assert.equal(
    renderMarkdown('| A | B | | - | - | | 1 | 2 |'),
    '<div class="md-table-wrap"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
  );
}

{
  const rows = parsePastedRows('A. Smith went home', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [{ text: 'A. Smith went home', level: 0 }]
  );
}

{
  const rows = parsePastedRows('+ Root\n  + Child', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'Root', level: 0 },
      { text: 'Child', level: 1 }
    ]
  );
}

{
  const rows = parsePastedRows('- Root\n\t- Child', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'Root', level: 0 },
      { text: 'Child', level: 1 }
    ]
  );
}

{
  const rows = parsePastedRows('Intro\n\t- Child', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'Intro', level: 0 },
      { text: 'Child', level: 1 }
    ]
  );
}

{
  const rows = parsePastedRows('1. Root\n\tChild', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: '1. Root', level: 0 },
      { text: 'Child', level: 1 }
    ]
  );
}

{
  const rows = parsePastedRows('- Root\n\tChild', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: '- Root', level: 0 },
      { text: 'Child', level: 1 }
    ]
  );
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrows-smoke-'));
  const dbPath = path.join(tempDir, 'tabrows.sqlite');
  const stderr = [];
  const stdout = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: '0', TABROWS_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  try {
    const baseUrl = await waitForServerUrl(child, stdout, stderr);
    assert.equal(child.exitCode, null, `Fresh DB server boot failed.\n${stderr.join('')}${stdout.join('')}`);

    const home = await fetch(baseUrl);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    const longPasswordResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'a'.repeat(1025)
      })
    });

    assert.equal(longPasswordResponse.status, 400);
    const longPasswordBody = await longPasswordResponse.json();
    assert.match(longPasswordBody.error || '', /Password must be 8-1024 characters/);

    const ownerAuth = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { email: 'owner@example.com', password: 'password123' }
    });
    assert.equal(ownerAuth.response.status, 200);

    const ownerDb = {
      currentId: 'shared-list',
      lists: [
        {
          id: 'shared-list',
          name: 'Shared',
          rows: [{ id: 'row-1', text: 'Owner row', level: 0, color: '', collapsed: false }]
        }
      ]
    };
    const ownerSave = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: { db: ownerDb },
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerSave.response.status, 200);

    const originalRowid = rowRowid(dbPath, 'row-1');
    assert.ok(originalRowid > 0);

    const ownerNoopSave = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: { db: ownerDb },
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerNoopSave.response.status, 200);
    assert.equal(rowRowid(dbPath, 'row-1'), originalRowid);

    const checkpoint = await requestJson(`${baseUrl}/api/lists/shared-list/revisions`, {
      method: 'POST',
      body: { label: 'Start' },
      cookie: ownerAuth.cookie
    });
    assert.equal(checkpoint.response.status, 200);
    assert.equal(checkpoint.payload.revisions[0].label, 'Start');

    const publish = await requestJson(`${baseUrl}/api/lists/shared-list/public-link`, {
      method: 'POST',
      cookie: ownerAuth.cookie
    });
    assert.equal(publish.response.status, 200);
    const publicToken = publish.payload.db.lists[0].publicShareToken;
    assert.equal(typeof publicToken, 'string');
    assert.ok(publicToken.length > 10);

    const publicPage = await fetch(`${baseUrl}/public/${encodeURIComponent(publicToken)}`);
    assert.equal(publicPage.status, 200);

    const publicList = await requestJson(`${baseUrl}/api/public/${encodeURIComponent(publicToken)}`);
    assert.equal(publicList.response.status, 200);
    assert.equal(publicList.payload.list.name, 'Shared');
    assert.equal(publicList.payload.list.ownerEmail, 'owner@example.com');
    assert.equal(publicList.payload.list.rows[0].text, 'Owner row');

    const invalidPublicToken = await fetch(`${baseUrl}/api/public/%E0%A4%A`);
    assert.equal(invalidPublicToken.status, 400);

    const collaboratorAuth = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { email: 'collab@example.com', password: 'password123' }
    });
    assert.equal(collaboratorAuth.response.status, 200);

    const collaboratorPublish = await requestJson(`${baseUrl}/api/lists/shared-list/public-link`, {
      method: 'POST',
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorPublish.response.status, 403);

    const collaboratorHistory = await requestJson(`${baseUrl}/api/lists/shared-list/revisions`, {
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorHistory.response.status, 403);

    const share = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'POST',
      body: { email: 'collab@example.com' },
      cookie: ownerAuth.cookie
    });
    assert.equal(share.response.status, 200);
    assert.equal(share.payload.db.lists[0].collaborators[0].email, 'collab@example.com');

    const badRevoke = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'DELETE',
      body: {},
      cookie: ownerAuth.cookie
    });
    assert.equal(badRevoke.response.status, 400);

    const collaboratorDb = await requestJson(`${baseUrl}/api/db`, {
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorDb.response.status, 200);
    assert.equal(collaboratorDb.payload.db.lists[0].isOwner, false);
    assert.equal(collaboratorDb.payload.db.lists[0].rows[0].text, 'Owner row');

    collaboratorDb.payload.db.lists[0].rows[0].text = 'Collaborator edit';
    const collaboratorSave = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: { db: collaboratorDb.payload.db },
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorSave.response.status, 200);

    const ownerReload = await requestJson(`${baseUrl}/api/db`, {
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerReload.payload.db.lists[0].rows[0].text, 'Collaborator edit');

    const ownerHistory = await requestJson(`${baseUrl}/api/lists/shared-list/revisions`, {
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerHistory.response.status, 200);
    const checkpointRevision = ownerHistory.payload.revisions.find((revision) => revision.label === 'Start');
    assert.ok(checkpointRevision);

    const restore = await requestJson(`${baseUrl}/api/lists/shared-list/revisions/${encodeURIComponent(checkpointRevision.id)}/restore`, {
      method: 'POST',
      cookie: ownerAuth.cookie
    });
    assert.equal(restore.response.status, 200);
    assert.equal(restore.payload.db.lists[0].rows[0].text, 'Owner row');

    const leave = await requestJson(`${baseUrl}/api/lists/shared-list/leave`, {
      method: 'POST',
      cookie: collaboratorAuth.cookie
    });
    assert.equal(leave.response.status, 200);
    assert.equal(leave.payload.db, null);

    const unpublish = await requestJson(`${baseUrl}/api/lists/shared-list/public-link`, {
      method: 'DELETE',
      cookie: ownerAuth.cookie
    });
    assert.equal(unpublish.response.status, 200);
    assert.equal(unpublish.payload.db.lists[0].publicShareToken, '');

    const missingPublic = await fetch(`${baseUrl}/api/public/${encodeURIComponent(publicToken)}`);
    assert.equal(missingPublic.status, 404);
  } finally {
    child.kill('SIGTERM');
    await delay(100);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
