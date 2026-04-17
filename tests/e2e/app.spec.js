import { test, expect } from '@playwright/test';

const PASSWORD = 'password123';
const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };
const TRUSTED_REQUEST_HEADERS = { 'X-Outliner-Request': '1' };

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function ensureAuthMode(page, mode) {
  const title = page.locator('#authTitle');
  const toggle = page.locator('#authToggleBtn');
  const titleText = await title.textContent() || '';

  if (mode === 'register' && !titleText.includes('Create')) {
    await toggle.click();
  }

  if (mode === 'login' && titleText.includes('Create')) {
    await toggle.click();
  }
}

async function registerViaUi(page, email) {
  await page.goto('/');
  await expect(page.locator('#authScreen')).toBeVisible();
  await ensureAuthMode(page, 'register');
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPassword').fill(PASSWORD);
  await page.locator('#authSubmitBtn').click();
  await expect(page.locator('#authScreen')).toBeHidden();
}

async function loginViaUi(page, email) {
  await page.goto('/');
  await expect(page.locator('#authScreen')).toBeVisible();
  await ensureAuthMode(page, 'login');
  await page.locator('#authEmail').fill(email);
  await page.locator('#authPassword').fill(PASSWORD);
  await page.locator('#authSubmitBtn').click();
  await expect(page.locator('#authScreen')).toBeHidden();
}

async function finishEditing(page) {
  await page.locator('#searchInput').click();
  await expect(page.locator('.editor')).toHaveCount(0);
}

async function editRowByText(page, currentText, nextText) {
  await page.locator('.row').filter({ hasText: currentText }).first().dblclick();
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('.editor').fill(nextText);
  await finishEditing(page);
}

async function editFirstRow(page, nextText) {
  await page.locator('.row').first().dblclick();
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('.editor').fill(nextText);
  await finishEditing(page);
}

async function createRowBelowFocused(page, text) {
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('.editor').fill(text);
  await finishEditing(page);
}

async function createFirstRowInEmptyList(page, text) {
  await page.locator('.empty-state-action').click();
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('.editor').fill(text);
  await finishEditing(page);
}

async function openTitleMenu(page) {
  await page.locator('#titleMenuBtn').click();
}

async function waitForOpsSave(page, action) {
  const save = page.waitForResponse((response) => (
    response.url().includes('/api/db/ops')
    && response.request().method() === 'POST'
    && response.ok()
  ));
  await action();
  await save;
}

async function addCollapsedChild(page, parentText, childText) {
  await page.locator('.row').filter({ hasText: parentText }).first().click();
  await waitForOpsSave(page, () => createRowBelowFocused(page, childText));
  await page.locator('.row').filter({ hasText: childText }).first().click();
  await waitForOpsSave(page, () => page.keyboard.press('Tab'));
  await waitForOpsSave(page, () => page.locator('.row').filter({ hasText: parentText }).locator('[data-action="toggle-collapse"]').click());
  await expect(page.locator('.row').filter({ hasText: childText })).toHaveCount(0);
}

test('auth, row editing, and cross-list search work in the browser', async ({ page }) => {
  const ownerEmail = uniqueEmail('owner');
  await registerViaUi(page, ownerEmail);

  await editFirstRow(page, 'Alpha root');
  await page.locator('.row').filter({ hasText: 'Alpha root' }).first().click();
  await createRowBelowFocused(page, 'Needle in list one');

  await page.locator('#listSelect').selectOption('__outliner_new_list__');
  await expect(page.locator('#title')).toHaveValue('Untitled');
  await page.locator('#title').fill('Second list');
  await page.locator('#searchInput').click();
  await expect(page.locator('#title')).toHaveValue('Second list');
  await createFirstRowInEmptyList(page, 'Needle in list two');

  await page.locator('#searchScope').selectOption('all');
  await page.locator('#searchInput').fill('Needle in list one');
  await page.locator('.search-result').filter({ hasText: 'Needle in list one' }).click();
  await expect(page.locator('#title')).toHaveValue('Untitled');
  await expect(page.locator('.row.selected')).toContainText('Needle in list one');

  await page.locator('#searchInput').fill('Needle in list two');
  await page.locator('.search-result').filter({ hasText: 'Needle in list two' }).click();
  await expect(page.locator('#title')).toHaveValue('Second list');
  await expect(page.locator('.row.selected')).toContainText('Needle in list two');
});

test('search renders markdown previews, highlights matches, and closes on outside click', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('search-markdown'));
  await editFirstRow(page, '[**Study of L-Dopa in ADHD and RLS/PLMS**](https://grantome.com/grant/NIH/R01-NS040829-03)');
  await page.locator('#searchInput').fill('L-Dopa');

  const resultTitle = page.locator('.search-result-title').first();
  await expect(page.locator('.search-result-summary')).toContainText('1 result');
  await expect(resultTitle.locator('strong')).toContainText('Study of L-Dopa in ADHD and RLS/PLMS');
  await expect(resultTitle).not.toContainText('**');
  await expect(page.locator('#searchClearBtn')).toBeVisible();
  await expect(page.locator('.row .search-hit')).toContainText('L-Dopa');

  await page.locator('#searchClearBtn').click();
  await expect(page.locator('#searchInput')).toHaveValue('');
  await expect(page.locator('#searchResults')).toBeHidden();
  await expect(page.locator('.row .search-hit')).toHaveCount(0);

  await page.locator('#searchInput').fill('L-Dopa');
  await expect(page.locator('.search-result-summary')).toContainText('1 result');

  await page.mouse.click(900, 700);
  await expect(page.locator('#searchResults')).toBeHidden();
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row .search-hit')).toContainText('L-Dopa');
});

test('search mode still allows collapsing irrelevant matched branches', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('search-collapse'));
  await editFirstRow(page, 'Parent branch');
  await page.locator('.row').filter({ hasText: 'Parent branch' }).first().click();
  await createRowBelowFocused(page, 'Needle child');
  await page.locator('.row').filter({ hasText: 'Needle child' }).first().click();
  await waitForOpsSave(page, () => page.keyboard.press('Tab'));

  await page.locator('#searchInput').fill('Needle');
  await expect(page.locator('.row').filter({ hasText: 'Needle child' })).toHaveCount(1);
  await page.locator('.row').filter({ hasText: 'Parent branch' }).first().locator('[data-action="toggle-collapse"]').click();
  await expect(page.locator('.row').filter({ hasText: 'Parent branch' })).toHaveCount(1);
  await expect(page.locator('.row').filter({ hasText: 'Needle child' })).toHaveCount(0);
});

test('row menu reports descendant count and redo restores undone edits', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('row-menu-redo'));
  await editFirstRow(page, 'Parent for count');
  await page.locator('.row').filter({ hasText: 'Parent for count' }).first().click();
  await createRowBelowFocused(page, 'Child for count');
  await page.locator('.row').filter({ hasText: 'Child for count' }).first().click();
  await waitForOpsSave(page, () => page.keyboard.press('Tab'));

  await page.locator('.row').filter({ hasText: 'Parent for count' }).first().locator('.actions-btn').click({ force: true });
  await expect(page.locator('.actions-menu-count')).toHaveText('1 child row');

  await page.locator('.row').filter({ hasText: 'Child for count' }).first().click();
  await createRowBelowFocused(page, 'Redo target');
  await page.locator('#undoBtn').click();
  await expect(page.locator('.row').filter({ hasText: 'Redo target' })).toHaveCount(0);
  await page.locator('#redoBtn').click();
  await expect(page.locator('.row').filter({ hasText: 'Redo target' })).toHaveCount(1);
});

test('mobile layout keeps navigation and row actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerViaUi(page, uniqueEmail('mobile'));

  await editFirstRow(page, 'Mobile root');
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#searchScope')).toBeVisible();
  await expect(page.locator('#listSelect')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeVisible();
  await expect(page.locator('.row').first().locator('.actions-btn')).toHaveCSS('opacity', '1');

  const overflow = await page.evaluate(() => (
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  await page.locator('#listSelect').selectOption('__outliner_new_list__');
  await expect(page.locator('#title')).toHaveValue('Untitled');
});

test('enter in the list title moves to the first row or creates it', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('title-enter'));
  await editFirstRow(page, 'Alpha');
  await page.locator('.row').filter({ hasText: 'Alpha' }).first().click();
  await createRowBelowFocused(page, 'Beta');
  await page.locator('.row').filter({ hasText: 'Beta' }).first().click();

  await page.locator('#title').fill('Title navigation');
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveValue('Title navigation');
  await expect(page.locator('.row.selected')).toContainText('Alpha');
  await expect(page.locator('.editor')).toHaveCount(0);

  await page.locator('#listSelect').selectOption('__outliner_new_list__');
  await page.locator('#title').fill('Empty list');
  await page.keyboard.press('Enter');
  await expect(page.locator('#title')).toHaveValue('Empty list');
  await expect(page.locator('.row.selected')).toHaveCount(1);
  await expect(page.locator('.editor')).toBeVisible();
});

test('active row edits are saved before reload', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('reload-draft'));
  await page.locator('.row').first().dblclick();
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('.editor').fill('Reload-safe draft');
  await page.reload();
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('.row').filter({ hasText: 'Reload-safe draft' })).toHaveCount(1);
});

test('failed saves keep the local bootstrap copy across reload', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('failed-save'));
  await page.route('**/api/db/ops', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Forced save failure' })
    });
  });

  await editFirstRow(page, 'Local row after failed save');
  await expect(page.locator('#saveStatus')).toContainText('Save failed');
  await page.unroute('**/api/db/ops');

  await page.reload();
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('.row').filter({ hasText: 'Local row after failed save' })).toHaveCount(1);
  await expect(page.locator('#saveStatus')).toBeHidden();
});

test('stale save failures do not override a newer pending save', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('stale-save'));
  await waitForOpsSave(page, () => editFirstRow(page, 'Stable root'));

  let saveRequestCount = 0;
  let firstFailureResolved;
  const firstFailure = new Promise((resolve) => {
    firstFailureResolved = resolve;
  });

  await page.route('**/api/db/ops', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    saveRequestCount += 1;
    if (saveRequestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Stale save failed' })
      });
      firstFailureResolved();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  await editRowByText(page, 'Stable root', 'First queued save');
  await page.locator('.row').filter({ hasText: 'First queued save' }).first().click();
  const newerSave = page.waitForResponse((response) => (
    response.url().includes('/api/db/ops')
    && response.request().method() === 'POST'
    && response.ok()
  ));
  await createRowBelowFocused(page, 'Newer successful save');
  await firstFailure;
  await expect(page.locator('#saveStatus')).not.toContainText('Save failed');
  await newerSave;
  await page.unroute('**/api/db/ops');

  await expect(page.locator('#saveStatus')).toBeHidden();
  await page.reload();
  await expect(page.locator('.row').filter({ hasText: 'First queued save' })).toHaveCount(1);
  await expect(page.locator('.row').filter({ hasText: 'Newer successful save' })).toHaveCount(1);
});

test('database stats modal always shows save status', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('stats-save-status'));
  await page.locator('#settingsBtn').click();
  await page.locator('#openStatsBtn').click();
  await expect(page.locator('#statsModal')).toBeVisible();
  await expect(page.locator('[data-stats-save-status]')).toContainText(/Saved|Saving|Unsaved|Save failed/);
});

test('logout clears the local bootstrap cache for the signed-in user', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('logout-cache'));
  await waitForOpsSave(page, () => editFirstRow(page, 'Sensitive local cache row'));

  const keysBeforeLogout = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('outliner-db-v1:')));
  expect(keysBeforeLogout.length).toBeGreaterThan(0);

  await page.locator('#settingsBtn').click();
  await page.locator('#menuLogoutBtn').click();
  await expect(page.locator('#authScreen')).toBeVisible();

  const keysAfterLogout = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('outliner-db-v1:')));
  expect(keysAfterLogout).toEqual([]);
});

test('missing persisted snapshots are saved with a full snapshot write', async ({ page }) => {
  let firstDbRead = true;
  let sawFullSnapshotWrite = false;

  await page.route('**/api/db', async (route) => {
    const request = route.request();

    if (request.method() === 'GET' && firstDbRead) {
      firstDbRead = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ db: null })
      });
      return;
    }

    if (request.method() === 'PUT') {
      sawFullSnapshotWrite = true;
    }

    await route.continue();
  });

  await registerViaUi(page, uniqueEmail('missing-db'));
  await expect.poll(() => sawFullSnapshotWrite).toBe(true);
  await page.unroute('**/api/db');
});

test('blank inserted rows are discarded and selection moves to the row above', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('blank-row'));

  await page.locator('#listSelect').selectOption('__outliner_new_list__');
  await waitForOpsSave(page, () => createFirstRowInEmptyList(page, 'Alpha'));
  await page.locator('.row').filter({ hasText: 'Alpha' }).first().click();
  await waitForOpsSave(page, () => createRowBelowFocused(page, 'Beta'));

  await page.locator('.row').filter({ hasText: 'Alpha' }).first().click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor')).toBeVisible();
  await finishEditing(page);

  await expect(page.locator('.row')).toHaveCount(2);
  await expect(page.locator('.row.selected')).toContainText('Alpha');
  await expect(page.locator('.row.selected .row-content')).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  await expect(page.locator('.row.selected .row-content')).toHaveCSS('border-radius', '0px');
});

test('colour keys cover 1-9 and 0 clears them', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('colour-keys'));

  await page.locator('#listSelect').selectOption('__outliner_new_list__');
  await waitForOpsSave(page, () => createFirstRowInEmptyList(page, 'Alpha'));
  await page.locator('.row').filter({ hasText: 'Alpha' }).first().click();
  await waitForOpsSave(page, () => createRowBelowFocused(page, 'Beta'));

  const alphaRow = page.locator('.row').filter({ hasText: 'Alpha' }).first();
  const betaRow = page.locator('.row').filter({ hasText: 'Beta' }).first();
  await alphaRow.dblclick();
  await expect(page.locator('.editor-shell')).toHaveCSS('border-color', 'rgb(213, 203, 185)');
  await expect(page.locator('.editor-shell')).toHaveCSS('box-shadow', 'none');
  await finishEditing(page);

  await alphaRow.click();
  await waitForOpsSave(page, () => page.keyboard.press('1'));
  await betaRow.click();
  await expect(alphaRow.locator('.text-chip')).toHaveCSS('background-color', 'rgb(255, 240, 168)');

  await alphaRow.click();
  await waitForOpsSave(page, () => page.keyboard.press('9'));
  await betaRow.click();
  await expect(alphaRow.locator('.text-chip')).toHaveCSS('color', 'rgb(13, 138, 72)');

  await alphaRow.click();
  await waitForOpsSave(page, () => page.keyboard.press('0'));
  await betaRow.click();
  await expect(alphaRow.locator('.text-chip')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(alphaRow.locator('.text-chip')).toHaveCSS('color', 'rgb(32, 36, 44)');
});

test('rapidly editing a newly inserted row does not open a false conflict', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('rapid-row'));
  await waitForOpsSave(page, () => editFirstRow(page, 'Root'));
  await page.locator('.row').filter({ hasText: 'Root' }).first().click();

  let delayedFirstSave = false;
  await page.route('**/api/db/ops', async (route) => {
    if (!delayedFirstSave && route.request().method() === 'POST') {
      delayedFirstSave = true;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await route.continue();
  });

  const rowSave = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off('response', onResponse);
      reject(new Error('Timed out waiting for row save.'));
    }, 5000);
    function onResponse(response) {
      if (!response.url().includes('/api/db/ops') || response.request().method() !== 'POST') return;
      clearTimeout(timeout);
      page.off('response', onResponse);
      resolve();
    }
    page.on('response', onResponse);
  });

  await page.keyboard.press('Enter');
  await expect(page.locator('.editor')).toBeVisible();
  await page.locator('.editor').fill('Fast local row');
  await page.locator('#searchInput').click();
  await rowSave;
  await page.unroute('**/api/db/ops');

  await expect(page.locator('#conflictModal')).toBeHidden();
  await expect(page.locator('.row').filter({ hasText: 'Fast local row' })).toBeVisible();
});

test('sharing, public links, and history restore work across browser contexts', async ({ page, browser, request }) => {
  const ownerEmail = uniqueEmail('owner');
  const collaboratorEmail = uniqueEmail('collab');

  await registerViaUi(page, ownerEmail);
  await page.locator('#title').fill('Shared list');
  await page.locator('#searchInput').click();
  await expect(page.locator('#title')).toHaveValue('Shared list');
  await editFirstRow(page, 'History root');

  const collaboratorRegister = await request.post('/api/auth/register', {
    headers: TRUSTED_REQUEST_HEADERS,
    data: { email: collaboratorEmail, password: PASSWORD }
  });
  expect(collaboratorRegister.ok()).toBeTruthy();

  await openTitleMenu(page);
  await page.locator('#historyListBtn').click();
  await expect(page.locator('#historyModal')).toBeVisible();
  await page.locator('#historyLabel').fill('Checkpoint A');
  await page.locator('#historySaveBtn').click();
  await expect(page.locator('#historyStatus')).toContainText('Checkpoint saved.');
  await page.locator('#historyCloseBtn').click();
  await expect(page.locator('#historyModal')).toBeHidden();

  await editRowByText(page, 'History root', 'Changed root');

  await openTitleMenu(page);
  await page.locator('#shareListBtn').click();
  await expect(page.locator('#shareListModal')).toBeVisible();
  await page.locator('#shareListEmail').fill(collaboratorEmail);
  await page.locator('#shareListSubmitBtn').click();
  await expect(page.locator('#shareListStatus')).toContainText(`Shared with ${collaboratorEmail} as editor.`);
  await page.locator('#shareListPublicEnableBtn').click();
  await expect(page.locator('#shareListStatus')).toContainText('Public link enabled.');
  const publicUrl = (await page.locator('#shareListPublicLink').textContent() || '').trim();
  expect(publicUrl).toContain('/public/');
  await page.locator('#shareListCloseBtn').click();

  const collaboratorContext = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
  const collaboratorPage = await collaboratorContext.newPage();
  await loginViaUi(collaboratorPage, collaboratorEmail);
  await expect(collaboratorPage.locator('#title')).toHaveValue('Shared list');
  await expect(collaboratorPage.locator('.row').filter({ hasText: 'Changed root' })).toHaveCount(1);
  await collaboratorContext.close();

  await openTitleMenu(page);
  await page.locator('#historyListBtn').click();
  await expect(page.locator('#historyModal')).toBeVisible();
  await expect(page.locator('.history-entry').filter({ hasText: 'Checkpoint A' }).locator('.history-entry-diff')).toContainText('Restore preview');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.history-entry').filter({ hasText: 'Checkpoint A' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.row').filter({ hasText: 'History root' })).toHaveCount(1);
  await expect(page.locator('.row').filter({ hasText: 'Changed root' })).toHaveCount(0);
  await addCollapsedChild(page, 'History root', 'Public child');

  await page.locator('#settingsBtn').click();
  await page.locator('#menuLogoutBtn').click();
  await expect(page.locator('#authScreen')).toBeVisible();

  await page.goto(publicUrl);
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('#listSelect')).toBeHidden();
  await expect(page.locator('#title')).toHaveValue('Shared list');
  await expect(page.locator('#title')).toBeDisabled();
  await expect(page.locator('.row').filter({ hasText: 'History root' })).toHaveCount(1);
  await expect(page.locator('.row').filter({ hasText: 'Public child' })).toHaveCount(0);
  await page.locator('.row').filter({ hasText: 'History root' }).locator('[data-action="toggle-collapse"]').click();
  await expect(page.locator('.row').filter({ hasText: 'Public child' })).toHaveCount(1);
  await expect(page.locator('.actions-btn')).toHaveCount(0);

  await page.goto(`${publicUrl}/`);
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('#title')).toHaveValue('Shared list');
});

test('history modal scrolls long revision lists in a short viewport', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('history-scroll'));
  await page.setViewportSize({ width: 900, height: 420 });
  await editFirstRow(page, 'Scrollable history root');
  await openTitleMenu(page);
  await page.locator('#historyListBtn').click();
  await expect(page.locator('#historyModal')).toBeVisible();

  for (let index = 1; index <= 12; index += 1) {
    await page.locator('#historyLabel').fill(`Checkpoint ${index}`);
    const save = page.waitForResponse((response) => (
      response.url().includes('/api/lists/')
      && response.url().endsWith('/revisions')
      && response.request().method() === 'POST'
      && response.ok()
    ));
    await page.locator('#historySaveBtn').click();
    await save;
  }

  const entries = page.locator('#historyEntries');
  await expect(entries.locator('.history-entry')).toHaveCount(13);
  const metrics = await entries.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  await entries.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(entries.locator('.history-entry').last()).toBeInViewport();
});

test('concurrent edits to different rows merge without a conflict', async ({ page, browser, request }) => {
  const ownerEmail = uniqueEmail('owner');
  const collaboratorEmail = uniqueEmail('collab');

  await registerViaUi(page, ownerEmail);
  await page.locator('#title').fill('Merge list');
  await page.locator('#searchInput').click();
  await editFirstRow(page, 'Row A');
  await page.locator('.row').filter({ hasText: 'Row A' }).first().click();
  await createRowBelowFocused(page, 'Row B');

  const collaboratorRegister = await request.post('/api/auth/register', {
    headers: TRUSTED_REQUEST_HEADERS,
    data: { email: collaboratorEmail, password: PASSWORD }
  });
  expect(collaboratorRegister.ok()).toBeTruthy();

  await openTitleMenu(page);
  await page.locator('#shareListBtn').click();
  await page.locator('#shareListEmail').fill(collaboratorEmail);
  await page.locator('#shareListSubmitBtn').click();
  await expect(page.locator('#shareListStatus')).toContainText(`Shared with ${collaboratorEmail} as editor.`);
  await page.locator('#shareListCloseBtn').click();

  const collaboratorContext = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
  const collaboratorPage = await collaboratorContext.newPage();
  await loginViaUi(collaboratorPage, collaboratorEmail);

  await editRowByText(page, 'Row A', 'Owner row A');
  await editRowByText(collaboratorPage, 'Row B', 'Collaborator row B');
  await expect(collaboratorPage.locator('#conflictModal')).toBeHidden();

  await page.reload();
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('.row').filter({ hasText: 'Owner row A' })).toHaveCount(1);
  await expect(page.locator('.row').filter({ hasText: 'Collaborator row B' })).toHaveCount(1);
  await collaboratorContext.close();
});

test('viewer collaborators are read-only until upgraded to editor', async ({ page, browser, request }) => {
  const ownerEmail = uniqueEmail('owner');
  const viewerEmail = uniqueEmail('viewer');

  await registerViaUi(page, ownerEmail);
  await page.locator('#title').fill('Permission list');
  await page.locator('#searchInput').click();
  await editFirstRow(page, 'Shared row');
  await addCollapsedChild(page, 'Shared row', 'Viewer child');

  const viewerRegister = await request.post('/api/auth/register', {
    headers: TRUSTED_REQUEST_HEADERS,
    data: { email: viewerEmail, password: PASSWORD }
  });
  expect(viewerRegister.ok()).toBeTruthy();

  await openTitleMenu(page);
  await page.locator('#shareListBtn').click();
  await page.locator('#shareListEmail').fill(viewerEmail);
  await page.locator('#shareListRole').selectOption('viewer');
  await page.locator('#shareListSubmitBtn').click();
  await expect(page.locator('#shareListStatus')).toContainText(`Shared with ${viewerEmail} as viewer.`);

  const viewerContext = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
  const viewerPage = await viewerContext.newPage();
  await loginViaUi(viewerPage, viewerEmail);
  await expect(viewerPage.locator('#title')).toBeDisabled();
  await expect(viewerPage.locator('.row').filter({ hasText: 'Viewer child' })).toHaveCount(0);
  await viewerPage.locator('.row').filter({ hasText: 'Shared row' }).locator('[data-action="toggle-collapse"]').click();
  await expect(viewerPage.locator('.row').filter({ hasText: 'Viewer child' })).toHaveCount(1);
  await viewerPage.locator('.row').filter({ hasText: 'Shared row' }).first().dblclick();
  await expect(viewerPage.locator('.editor')).toHaveCount(0);
  await expect(viewerPage.locator('.actions-btn')).toHaveCount(0);

  await page.locator('.share-role-select').selectOption('editor');
  await expect(page.locator('#shareListStatus')).toContainText('Collaborator changed to editor.');
  await page.locator('#shareListCloseBtn').click();

  await viewerPage.reload();
  await expect(viewerPage.locator('#title')).toBeEnabled();
  await editRowByText(viewerPage, 'Shared row', 'Viewer can edit now');
  await expect(viewerPage.locator('.row').filter({ hasText: 'Viewer can edit now' })).toHaveCount(1);
  await viewerContext.close();
});

test('same-row conflicts open a resolution modal and can keep both versions', async ({ page, browser, request }) => {
  const ownerEmail = uniqueEmail('owner');
  const collaboratorEmail = uniqueEmail('collab');

  await registerViaUi(page, ownerEmail);
  await page.locator('#title').fill('Conflict list');
  await page.locator('#searchInput').click();
  await editFirstRow(page, 'Original row');

  const collaboratorRegister = await request.post('/api/auth/register', {
    headers: TRUSTED_REQUEST_HEADERS,
    data: { email: collaboratorEmail, password: PASSWORD }
  });
  expect(collaboratorRegister.ok()).toBeTruthy();

  await openTitleMenu(page);
  await page.locator('#shareListBtn').click();
  await expect(page.locator('#shareListModal')).toBeVisible();
  await page.locator('#shareListEmail').fill(collaboratorEmail);
  await page.locator('#shareListSubmitBtn').click();
  await expect(page.locator('#shareListStatus')).toContainText(`Shared with ${collaboratorEmail} as editor.`);
  await page.locator('#shareListCloseBtn').click();

  const collaboratorContext = await browser.newContext({ storageState: EMPTY_STORAGE_STATE });
  const collaboratorPage = await collaboratorContext.newPage();
  await loginViaUi(collaboratorPage, collaboratorEmail);
  await expect(collaboratorPage.locator('#title')).toHaveValue('Conflict list');
  await expect(collaboratorPage.locator('.row').filter({ hasText: 'Original row' })).toHaveCount(1);

  await editRowByText(page, 'Original row', 'Owner edit');
  await expect(page.locator('.row').filter({ hasText: 'Owner edit' })).toHaveCount(1);

  await editRowByText(collaboratorPage, 'Original row', 'Collaborator edit');
  await expect(collaboratorPage.locator('#conflictModal')).toBeVisible();
  await expect(collaboratorPage.locator('#conflictLocalText')).toContainText('Collaborator edit');
  await expect(collaboratorPage.locator('#conflictServerText')).toContainText('Owner edit');

  await collaboratorPage.locator('#conflictCopyLocalBtn').click();
  await expect(collaboratorPage.locator('#conflictModal')).toBeHidden();
  await expect(collaboratorPage.locator('.row').filter({ hasText: 'Owner edit' })).toHaveCount(1);
  await expect(collaboratorPage.locator('.row').filter({ hasText: 'Collaborator edit' })).toHaveCount(1);

  await collaboratorContext.close();
});
