import { test, expect } from '@playwright/test';

const PASSWORD = 'password123';
const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };

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

test('auth, row editing, and cross-list search work in the browser', async ({ page }) => {
  const ownerEmail = uniqueEmail('owner');
  await registerViaUi(page, ownerEmail);

  await editFirstRow(page, 'Alpha root');
  await page.locator('.row').filter({ hasText: 'Alpha root' }).first().click();
  await createRowBelowFocused(page, 'Needle in list one');

  await page.locator('#newListBtn').click();
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

test('sharing, public links, and history restore work across browser contexts', async ({ page, browser, request }) => {
  const ownerEmail = uniqueEmail('owner');
  const collaboratorEmail = uniqueEmail('collab');

  await registerViaUi(page, ownerEmail);
  await page.locator('#title').fill('Shared list');
  await page.locator('#searchInput').click();
  await expect(page.locator('#title')).toHaveValue('Shared list');
  await editFirstRow(page, 'History root');

  const collaboratorRegister = await request.post('/api/auth/register', {
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
  await expect(page.locator('#shareListStatus')).toContainText(`Shared with ${collaboratorEmail}.`);
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
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.history-entry').filter({ hasText: 'Checkpoint A' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.row').filter({ hasText: 'History root' })).toHaveCount(1);
  await expect(page.locator('.row').filter({ hasText: 'Changed root' })).toHaveCount(0);

  await page.locator('#settingsBtn').click();
  await page.locator('#menuLogoutBtn').click();
  await expect(page.locator('#authScreen')).toBeVisible();

  await page.goto(publicUrl);
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('#listSelect')).toBeHidden();
  await expect(page.locator('#title')).toHaveValue('Shared list');
  await expect(page.locator('#title')).toBeDisabled();
  await expect(page.locator('.row').filter({ hasText: 'History root' })).toHaveCount(1);
  await expect(page.locator('.actions-btn')).toHaveCount(0);
});

test('same-row conflicts open a resolution modal and can keep both versions', async ({ page, browser, request }) => {
  const ownerEmail = uniqueEmail('owner');
  const collaboratorEmail = uniqueEmail('collab');

  await registerViaUi(page, ownerEmail);
  await page.locator('#title').fill('Conflict list');
  await page.locator('#searchInput').click();
  await editFirstRow(page, 'Original row');

  const collaboratorRegister = await request.post('/api/auth/register', {
    data: { email: collaboratorEmail, password: PASSWORD }
  });
  expect(collaboratorRegister.ok()).toBeTruthy();

  await openTitleMenu(page);
  await page.locator('#shareListBtn').click();
  await expect(page.locator('#shareListModal')).toBeVisible();
  await page.locator('#shareListEmail').fill(collaboratorEmail);
  await page.locator('#shareListSubmitBtn').click();
  await expect(page.locator('#shareListStatus')).toContainText(`Shared with ${collaboratorEmail}.`);
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
