import { test, expect } from '@playwright/test';

const PASSWORD = 'password123';
const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };
const TRUSTED_REQUEST_HEADERS = { 'X-TabRows-Request': '1' };

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

  await page.locator('#listSelect').selectOption('__tabrows_new_list__');
  await expect(page.locator('#title')).toHaveValue('Untitled');
  await page.locator('#title').fill('Second list');
  await page.locator('#searchInput').click();
  await expect(page.locator('#title')).toHaveValue('Second list');
  await editFirstRow(page, 'Needle in list two');

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

  await page.locator('#listSelect').selectOption('__tabrows_new_list__');
  await expect(page.locator('#title')).toHaveValue('Untitled');
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

  const queuedSaves = new Promise((resolve, reject) => {
    let saveCount = 0;
    const timeout = setTimeout(() => {
      page.off('response', onResponse);
      reject(new Error('Timed out waiting for queued row saves.'));
    }, 5000);
    function onResponse(response) {
      if (!response.url().includes('/api/db/ops') || response.request().method() !== 'POST') return;
      saveCount += 1;
      if (saveCount < 2) return;
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
  await queuedSaves;
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
