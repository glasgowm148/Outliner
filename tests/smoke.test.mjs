import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import {
  LEGACY_DB_KEY,
  bootstrapDbKey,
  cloneDb,
  loadBootstrapDb,
  migrateLegacyBootstrapDb,
  normalizeDbObject,
  parseDbBackupText,
  serializeDbBackup
} from '../public/storage.js';
import { renderMarkdown } from '../public/markdown.js';
import { parsePastedRows } from '../public/outline.js';

const TRUSTED_REQUEST_HEADER = 'X-Outliner-Request';

async function waitForServerUrl(child, stdout, stderr) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    const output = stdout.join('');
    const match = output.match(/Outliner server running at (http:\/\/[^\s]+)/);
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
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers[TRUSTED_REQUEST_HEADER] = '1';
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outliner-smoke-'));
  const dbPath = path.join(tempDir, 'outliner.sqlite');
  const stderr = [];
  const stdout = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: '0', OUTLINER_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  try {
    const baseUrl = await waitForServerUrl(child, stdout, stderr);
    assert.equal(child.exitCode, null, `Fresh DB server boot failed.\n${stderr.join('')}${stdout.join('')}`);

    const home = await fetch(baseUrl);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(home.headers.get('pragma'), 'no-cache');
    assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.match(home.headers.get('content-security-policy') || '', /script-src 'self'(?:;|$)/);
    assert.doesNotMatch(home.headers.get('content-security-policy') || '', /sha256-/);
    assert.doesNotMatch(home.headers.get('content-security-policy') || '', /unsafe-inline[^;]*script/);
    assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');

    const staticRoutes = [
      ['/app.js', 'text/javascript'],
      ['/storage.js', 'text/javascript'],
      ['/markdown.js', 'text/javascript'],
      ['/outline.js', 'text/javascript'],
      ['/styles.css', 'text/css'],
      ['/public/test-token', 'text/html']
    ];
    for (const [route, expectedType] of staticRoutes) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200, `${route} should load`);
      assert.ok(
        (response.headers.get('content-type') || '').startsWith(expectedType),
        `${route} should be served as ${expectedType}`
      );
    }

    const staticPost = await fetch(`${baseUrl}/`, { method: 'POST' });
    assert.equal(staticPost.status, 405);
    assert.equal(staticPost.headers.get('allow'), 'GET, HEAD');

    const textBodyRegister = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', [TRUSTED_REQUEST_HEADER]: '1' },
      body: JSON.stringify({ email: 'text-body@example.com', password: 'password123' })
    });
    assert.equal(textBodyRegister.status, 415);

    const smuggledContentTypeRegister = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; application/json', [TRUSTED_REQUEST_HEADER]: '1' },
      body: JSON.stringify({ email: 'smuggled-type@example.com', password: 'password123' })
    });
    assert.equal(smuggledContentTypeRegister.status, 415);

    const oversizedBodyRegister = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TRUSTED_REQUEST_HEADER]: '1' },
      body: JSON.stringify({ email: 'large-body@example.com', password: 'a'.repeat(5 * 1024 * 1024) })
    });
    assert.equal(oversizedBodyRegister.status, 413);

    const missingTrustedHeaderRegister = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing-header@example.com', password: 'password123' })
    });
    assert.equal(missingTrustedHeaderRegister.status, 403);

    const crossOriginRegister = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TRUSTED_REQUEST_HEADER]: '1',
        Origin: 'https://evil.example'
      },
      body: JSON.stringify({ email: 'evil@example.com', password: 'password123' })
    });
    assert.equal(crossOriginRegister.status, 403);

    const longPasswordResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TRUSTED_REQUEST_HEADER]: '1' },
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
    assert.equal(ownerAuth.response.headers.get('cache-control'), 'no-store, max-age=0');
    {
      const sessionToken = decodeURIComponent(ownerAuth.cookie.split('=', 2)[1] || '');
      const expectedStoredId = crypto.createHash('sha256').update(sessionToken).digest('hex');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const storedSession = db.prepare('SELECT id FROM sessions LIMIT 1').get();
        assert.equal(storedSession?.id, expectedStoredId);
        assert.notEqual(storedSession?.id, sessionToken);
      } finally {
        db.close();
      }
    }

    const crossOriginAuthedWrite = await fetch(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TRUSTED_REQUEST_HEADER]: '1',
        Cookie: ownerAuth.cookie,
        Origin: 'https://evil.example'
      },
      body: JSON.stringify({ currentId: '', operations: [] })
    });
    assert.equal(crossOriginAuthedWrite.status, 403);

    const logoutAuth = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { email: 'logout@example.com', password: 'password123' }
    });
    assert.equal(logoutAuth.response.status, 200);

    const logout = await requestJson(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      cookie: logoutAuth.cookie
    });
    assert.equal(logout.response.status, 200);
    assert.equal(logout.response.headers.get('clear-site-data'), '"cache", "storage"');

    const tooManyOperations = await requestJson(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      cookie: ownerAuth.cookie,
      body: {
        currentId: '',
        operations: Array.from({ length: 20_001 }, () => ({ type: 'list-delete', listId: 'missing' }))
      }
    });
    assert.equal(tooManyOperations.response.status, 400);

    const oversizedRow = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      cookie: ownerAuth.cookie,
      body: {
        db: {
          currentId: 'oversized',
          lists: [
            {
              id: 'oversized',
              name: 'Oversized',
              rows: [{ id: 'huge-row', text: 'x'.repeat(50_001), level: 0 }]
            }
          ]
        }
      }
    });
    assert.equal(oversizedRow.response.status, 400);

    const ownerDb = {
      currentId: 'shared-list',
      lists: [
        {
          id: 'shared-list',
          name: 'Shared',
          rows: [
            { id: 'row-1', text: 'Owner row', level: 0, color: '', collapsed: false },
            { id: 'row-2', text: 'Second row', level: 0, color: '', collapsed: false }
          ]
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

    const invalidOutlineOperation = await requestJson(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      cookie: ownerAuth.cookie,
      body: {
        currentId: 'shared-list',
        operations: [
          {
            type: 'row-create',
            listId: 'shared-list',
            position: 2,
            row: { id: 'invalid-level-row', text: 'Invalid level', level: 9, color: '', collapsed: false }
          }
        ]
      }
    });
    assert.equal(invalidOutlineOperation.response.status, 400);
    assert.match(invalidOutlineOperation.payload.error || '', /valid outline/);

    const afterInvalidOutlineOperation = await requestJson(`${baseUrl}/api/db`, {
      cookie: ownerAuth.cookie
    });
    assert.equal(afterInvalidOutlineOperation.response.status, 200);
    assert.equal(afterInvalidOutlineOperation.payload.db.lists[0].rows.some((row) => row.id === 'invalid-level-row'), false);

    const otherAuth = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { email: 'other@example.com', password: 'password123' }
    });
    assert.equal(otherAuth.response.status, 200);

    const conflictingListId = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: {
        db: {
          currentId: 'shared-list',
          lists: [
            {
              id: 'shared-list',
              name: 'Clash',
              rows: [{ id: 'other-row', text: 'Other row', level: 0, color: '', collapsed: false }]
            }
          ]
        }
      },
      cookie: otherAuth.cookie
    });
    assert.equal(conflictingListId.response.status, 409);

    const conflictingRowId = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: {
        db: {
          currentId: 'other-list',
          lists: [
            {
              id: 'other-list',
              name: 'Other',
              rows: [{ id: 'row-1', text: 'Collision', level: 0, color: '', collapsed: false }]
            }
          ]
        }
      },
      cookie: otherAuth.cookie
    });
    assert.equal(conflictingRowId.response.status, 409);

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
    assert.equal(publicList.payload.list.ownerEmail, undefined);
    assert.equal(publicList.payload.list.rows[0].text, 'Owner row');
    assert.equal(publicList.payload.list.rows[1].text, 'Second row');

    const invalidPublicToken = await fetch(`${baseUrl}/api/public/%E0%A4%A`);
    assert.equal(invalidPublicToken.status, 400);

    const malformedPublicToken = await fetch(`${baseUrl}/api/public/${encodeURIComponent(`${publicToken}.json`)}`);
    assert.equal(malformedPublicToken.status, 404);

    const collaboratorAuth = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { email: 'collab@example.com', password: 'password123' }
    });
    assert.equal(collaboratorAuth.response.status, 200);

    const viewerAuth = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: { email: 'viewer@example.com', password: 'password123' }
    });
    assert.equal(viewerAuth.response.status, 200);

    const collaboratorPublish = await requestJson(`${baseUrl}/api/lists/shared-list/public-link`, {
      method: 'POST',
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorPublish.response.status, 403);

    const collaboratorHistory = await requestJson(`${baseUrl}/api/lists/shared-list/revisions`, {
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorHistory.response.status, 403);

    const invalidRoleShare = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'POST',
      body: { email: 'viewer@example.com', role: 'admin' },
      cookie: ownerAuth.cookie
    });
    assert.equal(invalidRoleShare.response.status, 400);

    const viewerShare = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'POST',
      body: { email: 'viewer@example.com', role: 'viewer' },
      cookie: ownerAuth.cookie
    });
    assert.equal(viewerShare.response.status, 200);
    assert.equal(viewerShare.payload.db.lists[0].collaborators.find((user) => user.email === 'viewer@example.com').role, 'viewer');

    const viewerDb = await requestJson(`${baseUrl}/api/db`, {
      cookie: viewerAuth.cookie
    });
    assert.equal(viewerDb.response.status, 200);
    assert.equal(viewerDb.payload.db.lists[0].accessRole, 'viewer');
    assert.equal(viewerDb.payload.db.lists[0].canEdit, false);

    const viewerNoopSnapshotSave = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: { db: viewerDb.payload.db },
      cookie: viewerAuth.cookie
    });
    assert.equal(viewerNoopSnapshotSave.response.status, 200);

    viewerDb.payload.db.lists[0].rows[0].text = 'Viewer edit';
    const viewerSave = await requestJson(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      body: {
        currentId: viewerDb.payload.db.currentId,
        operations: [
          {
            type: 'row-update',
            listId: 'shared-list',
            position: 0,
            row: viewerDb.payload.db.lists[0].rows[0],
            expectedRevision: viewerDb.payload.db.lists[0].rows[0].revision
          }
        ]
      },
      cookie: viewerAuth.cookie
    });
    assert.equal(viewerSave.response.status, 403);

    const invalidRoleUpdate = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'PATCH',
      body: { userId: viewerAuth.payload.user.id, role: 'admin' },
      cookie: ownerAuth.cookie
    });
    assert.equal(invalidRoleUpdate.response.status, 400);

    const roleUpdate = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'PATCH',
      body: { userId: viewerAuth.payload.user.id, role: 'editor' },
      cookie: ownerAuth.cookie
    });
    assert.equal(roleUpdate.response.status, 200);
    assert.equal(roleUpdate.payload.db.lists[0].collaborators.find((user) => user.email === 'viewer@example.com').role, 'editor');

    const share = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'POST',
      body: { email: 'collab@example.com' },
      cookie: ownerAuth.cookie
    });
    assert.equal(share.response.status, 200);
    assert.equal(share.payload.db.lists[0].collaborators[0].email, 'collab@example.com');
    assert.equal(share.payload.db.lists[0].collaborators[0].role, 'editor');

    const duplicateShare = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'POST',
      body: { email: 'collab@example.com' },
      cookie: ownerAuth.cookie
    });
    assert.equal(duplicateShare.response.status, 409);

    const badRevoke = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'DELETE',
      body: {},
      cookie: ownerAuth.cookie
    });
    assert.equal(badRevoke.response.status, 400);

    const missingRevoke = await requestJson(`${baseUrl}/api/lists/shared-list/share`, {
      method: 'DELETE',
      body: { userId: 'missing-user' },
      cookie: ownerAuth.cookie
    });
    assert.equal(missingRevoke.response.status, 404);

    const collaboratorDb = await requestJson(`${baseUrl}/api/db`, {
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorDb.response.status, 200);
    assert.equal(collaboratorDb.payload.db.lists[0].isOwner, false);
    assert.equal(collaboratorDb.payload.db.lists[0].rows[0].text, 'Owner row');
    assert.equal(collaboratorDb.payload.db.lists[0].rows[1].text, 'Second row');

    const collaboratorSnapshot = cloneDb(collaboratorDb.payload.db);
    collaboratorSnapshot.lists[0].rows[0].text = 'Snapshot clobber';
    const collaboratorSnapshotSave = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: { db: collaboratorSnapshot },
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorSnapshotSave.response.status, 409);
    assert.match(collaboratorSnapshotSave.payload.error, /operation-based/);

    const ownerConcurrentDb = await requestJson(`${baseUrl}/api/db`, {
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerConcurrentDb.response.status, 200);

    const ownerSnapshot = cloneDb(ownerConcurrentDb.payload.db);
    ownerSnapshot.lists[0].rows[0].text = 'Owner snapshot clobber';
    const ownerSnapshotSave = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: { db: ownerSnapshot },
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerSnapshotSave.response.status, 409);
    assert.match(ownerSnapshotSave.payload.error, /operation-based/);

    const ownerSnapshotDelete = await requestJson(`${baseUrl}/api/db`, {
      method: 'PUT',
      body: {
        db: {
          currentId: 'private-only',
          lists: [
            {
              id: 'private-only',
              name: 'Private only',
              rows: [{ id: 'private-row', text: 'Private', level: 0 }]
            }
          ]
        }
      },
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerSnapshotDelete.response.status, 409);
    assert.match(ownerSnapshotDelete.payload.error, /operation-based/);

    ownerConcurrentDb.payload.db.lists[0].rows[0].text = 'Owner concurrent edit';
    const ownerConcurrentSave = await requestJson(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      body: {
        currentId: ownerConcurrentDb.payload.db.currentId,
        operations: [
          {
            type: 'row-update',
            listId: 'shared-list',
            position: 0,
            row: ownerConcurrentDb.payload.db.lists[0].rows[0],
            expectedRevision: ownerConcurrentDb.payload.db.lists[0].rows[0].revision
          }
        ]
      },
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerConcurrentSave.response.status, 200);

    collaboratorDb.payload.db.lists[0].rows[1].text = 'Collaborator edit';
    const collaboratorSave = await requestJson(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      body: {
        currentId: collaboratorDb.payload.db.currentId,
        operations: [
          {
            type: 'row-update',
            listId: 'shared-list',
            position: 1,
            row: collaboratorDb.payload.db.lists[0].rows[1],
            expectedRevision: collaboratorDb.payload.db.lists[0].rows[1].revision
          }
        ]
      },
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorSave.response.status, 200);

    collaboratorDb.payload.db.lists[0].rows[0].text = 'Stale collaborator edit';
    const staleCollaboratorSave = await requestJson(`${baseUrl}/api/db/ops`, {
      method: 'POST',
      body: {
        currentId: collaboratorDb.payload.db.currentId,
        operations: [
          {
            type: 'row-update',
            listId: 'shared-list',
            position: 0,
            row: collaboratorDb.payload.db.lists[0].rows[0],
            expectedRevision: collaboratorDb.payload.db.lists[0].rows[0].revision
          }
        ]
      },
      cookie: collaboratorAuth.cookie
    });
    assert.equal(staleCollaboratorSave.response.status, 409);

    const ownerReload = await requestJson(`${baseUrl}/api/db`, {
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerReload.payload.db.lists[0].rows[0].text, 'Owner concurrent edit');
    assert.equal(ownerReload.payload.db.lists[0].rows[1].text, 'Collaborator edit');

    const ownerHistory = await requestJson(`${baseUrl}/api/lists/shared-list/revisions`, {
      cookie: ownerAuth.cookie
    });
    assert.equal(ownerHistory.response.status, 200);
    const checkpointRevision = ownerHistory.payload.revisions.find((revision) => revision.label === 'Start');
    assert.ok(checkpointRevision);
    assert.ok(checkpointRevision.diff.changed >= 1);
    assert.ok(Array.isArray(checkpointRevision.diff.preview));

    const restore = await requestJson(`${baseUrl}/api/lists/shared-list/revisions/${encodeURIComponent(checkpointRevision.id)}/restore`, {
      method: 'POST',
      cookie: ownerAuth.cookie
    });
    assert.equal(restore.response.status, 200);
    assert.equal(restore.payload.db.lists[0].rows[0].text, 'Owner row');
    assert.equal(restore.payload.db.lists[0].rows[1].text, 'Second row');

    const leave = await requestJson(`${baseUrl}/api/lists/shared-list/leave`, {
      method: 'POST',
      cookie: collaboratorAuth.cookie
    });
    assert.equal(leave.response.status, 200);
    assert.equal(leave.payload.db.lists.length, 1);
    assert.equal(leave.payload.db.lists[0].isOwner, true);
    assert.equal(leave.payload.db.lists[0].name, 'Untitled');
    assert.equal(leave.payload.db.lists[0].rows.length, 1);
    assert.equal(leave.payload.db.lists[0].rows[0].text, '');

    const collaboratorAfterLeave = await requestJson(`${baseUrl}/api/db`, {
      cookie: collaboratorAuth.cookie
    });
    assert.equal(collaboratorAfterLeave.response.status, 200);
    assert.equal(collaboratorAfterLeave.payload.db.lists.length, 1);
    assert.equal(collaboratorAfterLeave.payload.db.lists[0].isOwner, true);

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
