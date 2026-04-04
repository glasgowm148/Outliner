const DB_KEY = 'tabrows-db-v1';
const STORAGE_API_PATH = '/api/db';
const STORAGE_STATS_API_PATH = '/api/stats';
const DEFAULT_LIST_NAME = 'Untitled';
const EDIT_SHORTCUT = 'ee';
const KEY_CHAIN_RESET_MS = 500;
const HISTORY_LIMIT = 200;
const TITLE_PERSIST_DELAY_MS = 300;

const COLORS = {
  '1': 'color-1',
  '2': 'color-2',
  '3': 'color-3',
  '4': 'color-4',
  '5': 'color-5',
  '6': 'color-6'
};

const dom = {
  searchInput: document.getElementById('searchInput'),
  titleInput: document.getElementById('title'),
  titleMenuBtn: document.getElementById('titleMenuBtn'),
  titleMenu: document.getElementById('titleMenu'),
  undoBtn: document.getElementById('undoBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsMenu: document.getElementById('settingsMenu'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  openStatsBtn: document.getElementById('openStatsBtn'),
  listSelect: document.getElementById('listSelect'),
  newListBtn: document.getElementById('newListBtn'),
  deleteListBtn: document.getElementById('deleteListBtn'),
  breadcrumbs: document.getElementById('breadcrumbs'),
  list: document.getElementById('list'),
  pastePrompt: document.getElementById('pastePrompt'),
  pastePromptPreview: document.getElementById('pastePromptPreview'),
  pastePromptPlainBtn: document.getElementById('pastePromptPlainBtn'),
  pastePromptSplitBtn: document.getElementById('pastePromptSplitBtn'),
  statsModal: document.getElementById('statsModal'),
  statsModalContent: document.getElementById('statsModalContent'),
  statsCloseBtn: document.getElementById('statsCloseBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  deleteListModal: document.getElementById('deleteListModal'),
  deleteListName: document.getElementById('deleteListName'),
  deleteListCancelBtn: document.getElementById('deleteListCancelBtn'),
  deleteListConfirmBtn: document.getElementById('deleteListConfirmBtn')
};

const state = {
  db: normalizeDbObject(loadBootstrapDb()),
  selected: new Set(),
  anchor: null,
  focused: null,
  editing: null,
  editOriginalText: '',
  draft: '',
  keyChain: '',
  searchQuery: '',
  menuRow: null,
  settingsMenuOpen: false,
  titleMenuOpen: false,
  viewRoot: null,
  pastePrompt: null,
  statsModal: {
    open: false,
    loading: false,
    error: '',
    data: null
  },
  settingsModalOpen: false,
  deleteListModalOpen: false
};

let keyChainTimer = null;
let persistQueue = Promise.resolve();
let titlePersistTimer = null;
let localChangeVersion = 0;

const historyState = {
  undoStack: [],
  redoStack: []
};

ensureSelection();
wireUi();
renderAll();
resetHistory();
initializeStorage();

// Storage

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
}

function createRow(text = '', level = 0, color = '', collapsed = false) {
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

function createDefaultDb() {
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

function loadBootstrapDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : createDefaultDb();
  } catch {
    return createDefaultDb();
  }
}

function writeBootstrapDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // ignore bootstrap cache failures
  }
}

function normalizeDbObject(db) {
  if (!db || !Array.isArray(db.lists) || !db.lists.length) {
    return createDefaultDb();
  }

  const normalized = {
    currentId: typeof db.currentId === 'string' ? db.currentId : '',
    lists: db.lists.map((list) => normalizeList(list))
  };

  if (!normalized.lists.some((list) => list.id === normalized.currentId)) {
    normalized.currentId = normalized.lists[0].id;
  }

  return normalized;
}

function cloneDb(db) {
  if (globalThis.structuredClone) return globalThis.structuredClone(db);
  return JSON.parse(JSON.stringify(db));
}

async function readStoredDb() {
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

async function readStorageStats() {
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

async function writeStoredDb(db) {
  const response = await fetch(STORAGE_API_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db })
  });

  if (!response.ok) {
    throw new Error(`Storage write failed: ${response.status}`);
  }
}

function persistDb() {
  const snapshot = cloneDb(state.db);
  writeBootstrapDb(snapshot);

  persistQueue = persistQueue
    .catch(() => {})
    .then(() => writeStoredDb(snapshot))
    .catch((error) => {
      console.warn('SQLite backend persist failed, using bootstrap cache only.', error);
    });

  return persistQueue;
}

function markDbChanged() {
  localChangeVersion += 1;
}

function clearTitlePersistTimer() {
  if (titlePersistTimer === null) return;
  clearTimeout(titlePersistTimer);
  titlePersistTimer = null;
}

function scheduleTitlePersist() {
  clearTitlePersistTimer();
  titlePersistTimer = setTimeout(() => {
    titlePersistTimer = null;
    saveDb({ recordHistory: false });
  }, TITLE_PERSIST_DELAY_MS);
}

function saveDb(options = {}) {
  const { recordHistory = true } = options;
  clearTitlePersistTimer();
  if (recordHistory) pushHistorySnapshot();
  markDbChanged();
  persistDb();
  renderUndoButton();
}

function createHistorySnapshot() {
  return {
    db: cloneDb(state.db),
    selected: [...state.selected],
    anchor: state.anchor,
    focused: state.focused,
    viewRoot: state.viewRoot
  };
}

function historySnapshotKey(snapshot) {
  return JSON.stringify(snapshot);
}

function resetHistory() {
  historyState.undoStack = [createHistorySnapshot()];
  historyState.redoStack = [];
  renderUndoButton();
}

function pushHistorySnapshot() {
  const snapshot = createHistorySnapshot();
  const previous = historyState.undoStack[historyState.undoStack.length - 1];

  if (previous && historySnapshotKey(previous) === historySnapshotKey(snapshot)) {
    return;
  }

  historyState.undoStack.push(snapshot);
  if (historyState.undoStack.length > HISTORY_LIMIT) {
    historyState.undoStack.shift();
  }
  historyState.redoStack = [];
}

function applyHistorySnapshot(snapshot, options = {}) {
  const { persist = true } = options;

  state.db = normalizeDbObject(snapshot.db);
  state.selected = new Set(Array.isArray(snapshot.selected) ? snapshot.selected : []);
  state.anchor = snapshot.anchor || null;
  state.focused = snapshot.focused || null;
  state.viewRoot = snapshot.viewRoot || null;
  clearEditState();
  state.menuRow = null;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  ensureSelection();

  if (persist) persistDb();
  renderAll();
}

function undoChange() {
  if (historyState.undoStack.length < 2) return;

  const current = historyState.undoStack.pop();
  historyState.redoStack.push(current);
  applyHistorySnapshot(historyState.undoStack[historyState.undoStack.length - 1]);
}

function redoChange() {
  if (!historyState.redoStack.length) return;

  const snapshot = historyState.redoStack.pop();
  historyState.undoStack.push(snapshot);
  applyHistorySnapshot(snapshot);
}

async function initializeStorage() {
  const startVersion = localChangeVersion;

  try {
    const storedDb = await readStoredDb();
    if (!storedDb) {
      await persistDb();
      return;
    }

    if (localChangeVersion !== startVersion) {
      writeBootstrapDb(state.db);
      return;
    }

    const normalizedStoredDb = normalizeDbObject(storedDb);
    if (JSON.stringify(normalizedStoredDb) !== JSON.stringify(state.db)) {
      state.db = normalizedStoredDb;
      clearEditState();
      state.menuRow = null;
      ensureSelection();
      renderAll();
    }

    writeBootstrapDb(normalizedStoredDb);
    resetHistory();
  } catch (error) {
    console.warn('SQLite backend unavailable, continuing with bootstrap cache.', error);
  }
}

function normalizeList(list) {
  return {
    id: typeof list?.id === 'string' && list.id ? list.id : createId(),
    name: normalizeListName(list?.name),
    rows: Array.isArray(list?.rows) ? list.rows.map((row) => normalizeRow(row)) : []
  };
}

function normalizeRow(row) {
  return {
    id: typeof row?.id === 'string' && row.id ? row.id : createId(),
    text: typeof row?.text === 'string' ? normalizeText(row.text) : '',
    level: Number.isInteger(row?.level) ? Math.max(0, row.level) : 0,
    color: typeof row?.color === 'string' ? row.color : '',
    collapsed: Boolean(row?.collapsed)
  };
}

function normalizeListName(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || DEFAULT_LIST_NAME;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function normalizedSearchQuery() {
  return state.searchQuery.trim().toLowerCase();
}

function rowMatchesSearch(row, query = normalizedSearchQuery()) {
  return normalizeText(row?.text).toLowerCase().includes(query);
}

function currentList() {
  return state.db.lists.find((list) => list.id === state.db.currentId) || state.db.lists[0];
}

function rows() {
  return currentList().rows;
}

// Tree helpers

function rowIndex(rowId, array = rows()) {
  return array.findIndex((row) => row.id === rowId);
}

function rowById(rowId, array = rows()) {
  const index = rowIndex(rowId, array);
  return index === -1 ? null : array[index];
}

function subtreeEnd(startIndex, array = rows()) {
  if (startIndex < 0 || startIndex >= array.length) return startIndex;
  const baseLevel = array[startIndex].level;
  let end = startIndex + 1;
  while (end < array.length && array[end].level > baseLevel) end += 1;
  return end;
}

function hasChildren(index, array = rows()) {
  return Boolean(array[index] && array[index + 1] && array[index + 1].level > array[index].level);
}

function parentIndex(index, array = rows()) {
  if (index <= 0) return -1;
  const level = array[index].level;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (array[i].level < level) return i;
  }
  return -1;
}

function ancestorIds(rowId, array = rows()) {
  const index = rowIndex(rowId, array);
  if (index === -1) return [];

  return ancestorIndexes(index, array).map((value) => array[value].id);
}

function ancestorIndexes(index, array = rows()) {
  if (index === -1) return [];

  const ids = [];
  let currentIndex = index;

  while (currentIndex !== -1) {
    ids.unshift(currentIndex);
    currentIndex = parentIndex(currentIndex, array);
  }

  return ids;
}

function expandAncestorChain(index, array = rows()) {
  let changed = false;
  let current = parentIndex(index, array);

  while (current !== -1) {
    if (array[current].collapsed) {
      array[current].collapsed = false;
      changed = true;
    }
    current = parentIndex(current, array);
  }

  return changed;
}

function currentViewRange(array = rows()) {
  if (!state.viewRoot) {
    return { start: 0, end: array.length, baseLevel: 0 };
  }

  const rootIndex = rowIndex(state.viewRoot, array);
  if (rootIndex === -1) {
    return { start: 0, end: array.length, baseLevel: 0 };
  }

  return {
    start: rootIndex,
    end: subtreeEnd(rootIndex, array),
    baseLevel: array[rootIndex].level
  };
}

function isInCurrentView(rowId, array = rows()) {
  if (!state.viewRoot) return rowIndex(rowId, array) !== -1;

  const rootIndex = rowIndex(state.viewRoot, array);
  const index = rowIndex(rowId, array);
  if (rootIndex === -1 || index === -1) return false;

  return index >= rootIndex && index < subtreeEnd(rootIndex, array);
}

function visibleMeta(array = rows()) {
  const { start, end, baseLevel } = currentViewRange(array);
  const query = normalizedSearchQuery();

  if (query) {
    return visibleSearchMeta(array, start, end, baseLevel, query);
  }

  return visibleCollapsedMeta(array, start, end, baseLevel);
}

function visibleCollapsedMeta(array, start, end, baseLevel) {
  const subset = array.slice(start, end);
  const hiddenLevels = [];
  const visible = [];

  subset.forEach((row, offset) => {
    const displayLevel = row.level - baseLevel;

    while (hiddenLevels.length && displayLevel <= hiddenLevels[hiddenLevels.length - 1]) {
      hiddenLevels.pop();
    }

    if (!hiddenLevels.length) {
      visible.push({ row, index: start + offset, displayLevel });
    }

    if (row.collapsed) {
      hiddenLevels.push(displayLevel);
    }
  });

  return visible;
}

function visibleSearchMeta(array, start, end, baseLevel, query) {
  const included = new Set();

  for (let i = start; i < end; i += 1) {
    if (!rowMatchesSearch(array[i], query)) continue;

    let current = i;
    while (current !== -1 && current >= start && current < end) {
      included.add(current);
      current = parentIndex(current, array);
    }
  }

  if (state.editing) {
    let editingIndex = rowIndex(state.editing, array);
    while (editingIndex !== -1 && editingIndex >= start && editingIndex < end) {
      included.add(editingIndex);
      editingIndex = parentIndex(editingIndex, array);
    }
  }

  const visible = [];
  for (let i = start; i < end; i += 1) {
    if (!included.has(i)) continue;
    visible.push({ row: array[i], index: i, displayLevel: array[i].level - baseLevel });
  }

  return visible;
}

function visibleRows(array = rows()) {
  return visibleMeta(array).map(({ row }) => row);
}

function selectedIndexes(array = rows()) {
  return array
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => state.selected.has(row.id))
    .map(({ index }) => index)
    .sort((a, b) => a - b);
}

function selectedRootIds(array = rows()) {
  const indexes = selectedIndexes(array);
  const ids = [];
  let coveredUntil = -1;

  indexes.forEach((index) => {
    if (index < coveredUntil) return;
    ids.push(array[index].id);
    coveredUntil = subtreeEnd(index, array);
  });

  return ids;
}

function expandRowIdsToSubtrees(ids, array = rows()) {
  const expanded = new Set();

  ids.forEach((id) => {
    const start = rowIndex(id, array);
    if (start === -1) return;

    const end = subtreeEnd(start, array);
    for (let i = start; i < end; i += 1) {
      expanded.add(array[i].id);
    }
  });

  return expanded;
}

// State helpers

function clearEditState() {
  state.editing = null;
  state.editOriginalText = '';
  state.draft = '';
  state.pastePrompt = null;
}

function ensureSelection() {
  const allRows = rows();

  if (!allRows.length) {
    state.selected.clear();
    state.anchor = null;
    state.focused = null;
    state.viewRoot = null;
    return;
  }

  if (state.viewRoot && rowIndex(state.viewRoot, allRows) === -1) {
    state.viewRoot = null;
  }

  if (!state.focused || rowIndex(state.focused, allRows) === -1 || !isInCurrentView(state.focused, allRows)) {
    state.focused = state.viewRoot || allRows[0].id;
  }

  if (!state.anchor || rowIndex(state.anchor, allRows) === -1 || !isInCurrentView(state.anchor, allRows)) {
    state.anchor = state.focused;
  }

  const visible = visibleRows(allRows);
  if (!visible.length) {
    state.selected.clear();
    return;
  }

  const visibleIds = new Set(visible.map((row) => row.id));

  if (!visibleIds.has(state.focused)) {
    state.focused = visible[0].id;
  }

  if (!visibleIds.has(state.anchor)) {
    state.anchor = state.focused;
  }

  const validSelected = [...state.selected].filter((id) => visibleIds.has(id));
  state.selected = validSelected.length ? new Set(validSelected) : new Set([state.focused]);
}

function setSelection(ids, anchor = ids[ids.length - 1] || null, options = {}) {
  const { render = true } = options;
  state.selected = new Set(ids);
  state.anchor = anchor;
  state.focused = ids[ids.length - 1] || null;
  state.menuRow = null;

  if (render) renderRows();
}

function setSingleSelection(rowId, options = {}) {
  setSelection(rowId ? [rowId] : [], rowId, options);
}

// Rendering

function renderAll() {
  renderHeader();
  renderRows();
  renderPastePrompt();
  renderStatsModal();
  renderSettingsModal();
  renderDeleteListModal();
}

function renderHeader() {
  dom.titleInput.value = currentList().name;
  dom.searchInput.value = state.searchQuery;
  dom.settingsBtn.setAttribute('aria-expanded', String(state.settingsMenuOpen));
  dom.settingsMenu.hidden = !state.settingsMenuOpen;
  dom.titleMenuBtn.setAttribute('aria-expanded', String(state.titleMenuOpen));
  dom.titleMenu.hidden = !state.titleMenuOpen;
  renderUndoButton();
  renderListOptions();
  renderBreadcrumbs();
}

function renderUndoButton() {
  dom.undoBtn.disabled = historyState.undoStack.length < 2;
}

function previewPasteText(text) {
  const lines = normalizeText(text).trimEnd().split('\n');
  const preview = lines.slice(0, 6).join('\n');
  return lines.length > 6 ? `${preview}\n…` : preview;
}

function renderModalBodyState() {
  const open = Boolean(state.pastePrompt) || state.statsModal.open || state.settingsModalOpen || state.deleteListModalOpen;
  document.body.classList.toggle('modal-open', open);
}

function renderPastePrompt() {
  const open = Boolean(state.pastePrompt);
  dom.pastePrompt.hidden = !open;
  dom.pastePrompt.setAttribute('aria-hidden', String(!open));
  renderModalBodyState();

  if (!open) return;

  dom.pastePromptPreview.textContent = previewPasteText(state.pastePrompt.text);
  requestAnimationFrame(() => {
    if (state.pastePrompt) dom.pastePromptSplitBtn.focus();
  });
}

function formatByteSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function createStatsCard(label, value) {
  return `
    <div class="stats-item">
      <div class="stats-label">${label}</div>
      <div class="stats-value">${value}</div>
    </div>
  `;
}

function renderStatsModal() {
  const modalState = state.statsModal;
  dom.statsModal.hidden = !modalState.open;
  dom.statsModal.setAttribute('aria-hidden', String(!modalState.open));
  renderModalBodyState();

  if (!modalState.open) return;

  if (modalState.loading) {
    dom.statsModalContent.innerHTML = '<div class="stats-status">Loading database stats…</div>';
    return;
  }

  if (modalState.error) {
    dom.statsModalContent.innerHTML = `<div class="stats-status stats-status-error">${escapeHtml(modalState.error)}</div>`;
    return;
  }

  const stats = modalState.data;
  if (!stats) {
    dom.statsModalContent.innerHTML = '<div class="stats-status">No database stats available.</div>';
    return;
  }

  dom.statsModalContent.innerHTML = `
    <div class="stats-grid">
      ${createStatsCard('Lists', String(stats.listCount))}
      ${createStatsCard('Rows', String(stats.rowCount))}
      ${createStatsCard('Colored rows', String(stats.coloredRowCount))}
      ${createStatsCard('Collapsed rows', String(stats.collapsedRowCount))}
      ${createStatsCard('Deepest level', String(stats.maxDepth))}
      ${createStatsCard('Current list rows', String(stats.currentListRowCount))}
    </div>
    <div class="stats-meta">
      <div class="stats-meta-row"><span class="stats-meta-label">Current list</span><span class="stats-meta-value">${escapeHtml(stats.currentListName || 'None')}</span></div>
      <div class="stats-meta-row"><span class="stats-meta-label">Database file</span><span class="stats-meta-value">${escapeHtml(stats.dbPath || 'Unknown')}</span></div>
      <div class="stats-meta-row"><span class="stats-meta-label">File size</span><span class="stats-meta-value">${escapeHtml(formatByteSize(stats.fileSizeBytes))}</span></div>
      <div class="stats-meta-row"><span class="stats-meta-label">Updated</span><span class="stats-meta-value">${escapeHtml(formatTimestamp(stats.updatedAt))}</span></div>
    </div>
  `;
}

async function openStatsModal() {
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.statsModal.open = true;
  state.statsModal.loading = true;
  state.statsModal.error = '';
  renderHeader();
  renderStatsModal();

  try {
    state.statsModal.data = await readStorageStats();
  } catch (error) {
    state.statsModal.error = error.message || 'Failed to load database stats.';
  } finally {
    state.statsModal.loading = false;
    renderStatsModal();
  }
}

function closeStatsModal() {
  state.statsModal.open = false;
  renderStatsModal();
}

function renderSettingsModal() {
  dom.settingsModal.hidden = !state.settingsModalOpen;
  dom.settingsModal.setAttribute('aria-hidden', String(!state.settingsModalOpen));
  renderModalBodyState();
}

function openSettingsModal() {
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.settingsModalOpen = true;
  renderHeader();
  renderSettingsModal();
}

function closeSettingsModal() {
  state.settingsModalOpen = false;
  renderSettingsModal();
}

function renderDeleteListModal() {
  dom.deleteListModal.hidden = !state.deleteListModalOpen;
  dom.deleteListModal.setAttribute('aria-hidden', String(!state.deleteListModalOpen));
  dom.deleteListName.textContent = normalizeListName(currentList().name);
  renderModalBodyState();
}

function openDeleteListModal() {
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.deleteListModalOpen = true;
  renderHeader();
  renderDeleteListModal();
}

function closeDeleteListModal() {
  state.deleteListModalOpen = false;
  renderDeleteListModal();
}

function renderListOptions() {
  const fragment = document.createDocumentFragment();

  state.db.lists.forEach((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = normalizeListName(list.name);
    option.selected = list.id === state.db.currentId;
    fragment.appendChild(option);
  });

  dom.listSelect.replaceChildren(fragment);
}

function rowLabel(text) {
  return String(text || '').split('\n')[0] || DEFAULT_LIST_NAME;
}

function comparableRowLabel(text) {
  return rowLabel(normalizeText(text))
    .replace(/^#{1,6}\s+/u, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\*\*(.*)\*\*$/u, '$1')
    .replace(/^\*(.*)\*$/u, '$1')
    .replace(/[:：]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function renderBreadcrumbs() {
  if (!state.viewRoot) {
    dom.breadcrumbs.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();

  fragment.appendChild(createBreadcrumb(currentList().name, () => {
    state.viewRoot = null;
    ensureSelection();
    renderAll();
  }));

  ancestorIds(state.viewRoot).forEach((idValue, index, ids) => {
    fragment.appendChild(createBreadcrumbSeparator());
    fragment.appendChild(createBreadcrumb(rowLabel(rowById(idValue)?.text), () => {
      state.viewRoot = idValue;
      state.menuRow = null;
      ensureSelection();
      setSingleSelection(idValue, { render: false });
      renderAll();
    }, index === ids.length - 1));
  });

  dom.breadcrumbs.replaceChildren(fragment);
}

function createBreadcrumb(label, onClick, isCurrent = false) {
  const crumb = document.createElement('button');
  crumb.type = 'button';
  crumb.className = `crumb${isCurrent ? ' current' : ''}`;
  crumb.textContent = label;
  crumb.addEventListener('click', onClick);
  return crumb;
}

function createBreadcrumbSeparator() {
  const separator = document.createElement('span');
  separator.className = 'crumb-sep';
  separator.textContent = '›';
  return separator;
}

function renderRows() {
  ensureSelection();

  const visible = visibleMeta();
  if (!visible.length) {
    dom.list.replaceChildren(createEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((meta) => {
    fragment.appendChild(createRowElement(meta));
  });

  dom.list.replaceChildren(fragment);
}

function createEmptyState() {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.textContent = normalizedSearchQuery() ? 'No matching rows.' : 'No rows yet.';
  return el;
}

function createRowElement({ row, index, displayLevel }) {
  const rowEl = document.createElement('div');
  rowEl.className = 'row';
  rowEl.dataset.id = row.id;

  if (state.selected.has(row.id)) rowEl.classList.add('selected');
  if (state.focused === row.id) rowEl.classList.add('focused');
  if (state.editing === row.id) rowEl.classList.add('editing');
  if (row.color && COLORS[row.color]) rowEl.classList.add(COLORS[row.color]);

  const main = document.createElement('div');
  main.className = 'row-main';
  main.style.setProperty('--level', displayLevel);
  const content = document.createElement('div');
  content.className = 'row-content';
  content.append(state.editing === row.id ? createEditor(row) : createText(row.text));
  main.append(createGutter(row, index), content);

  rowEl.appendChild(main);

  if (state.editing !== row.id) {
    rowEl.appendChild(createActionsWrap(row));
  }

  return rowEl;
}

function createGutter(row, index) {
  const gutter = document.createElement('div');
  gutter.className = 'gutter';

  if (hasChildren(index)) {
    gutter.classList.add('caret');
    gutter.dataset.action = 'toggle-collapse';
    gutter.textContent = row.collapsed ? '▸' : '▾';
  } else {
    gutter.classList.add('empty');
    gutter.textContent = '•';
  }

  return gutter;
}

function createEditor(row) {
  const shell = document.createElement('div');
  shell.className = 'editor-shell';

  const input = document.createElement('textarea');
  input.className = 'editor';
  input.value = state.draft;
  input.rows = 1;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.addEventListener('input', onEditorInput);
  input.addEventListener('paste', onEditorPaste);
  input.addEventListener('blur', onEditorBlur);
  shell.appendChild(input);

  requestAnimationFrame(() => {
    if (!input.isConnected || state.editing !== row.id) return;
    input.focus();
    autosize(input);
    input.selectionStart = input.selectionEnd = input.value.length;
  });

  return shell;
}

function createText(value) {
  const text = document.createElement('div');
  text.className = 'text';
  const chip = document.createElement('div');
  chip.className = 'text-chip';
  chip.innerHTML = renderMarkdown(value);
  text.appendChild(chip);
  return text;
}

function createActionsWrap(row) {
  const wrap = document.createElement('div');
  wrap.className = 'actions-wrap';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'actions-btn';
  button.innerHTML = iconMarkup('menu');
  button.dataset.action = 'toggle-menu';
  button.setAttribute('aria-expanded', String(state.menuRow === row.id));
  button.setAttribute('aria-label', 'Row options');
  wrap.appendChild(button);

  if (state.menuRow === row.id) {
    const menu = document.createElement('div');
    menu.className = 'actions-menu';
    menu.appendChild(createMenuItem('Focus', 'focus-row'));
    menu.appendChild(createMenuItem('Export Markdown', 'export-markdown'));
    wrap.appendChild(menu);
  }

  return wrap;
}

function createMenuItem(label, action) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'actions-item';
  item.dataset.action = action;
  item.innerHTML = `
    <span class="actions-item-icon" aria-hidden="true">${iconMarkup(action)}</span>
    <span class="actions-item-label">${label}</span>
  `;
  return item;
}

function iconMarkup(name) {
  switch (name) {
    case 'menu':
      return `
        <svg viewBox="0 0 20 20" focusable="false">
          <circle cx="4" cy="10" r="1.5" fill="currentColor"></circle>
          <circle cx="10" cy="10" r="1.5" fill="currentColor"></circle>
          <circle cx="16" cy="10" r="1.5" fill="currentColor"></circle>
        </svg>
      `;
    case 'focus-row':
      return `
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="M6 4.5H4.5V8M14 4.5h1.5V8M6 15.5H4.5V12M14 15.5h1.5V12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"></path>
          <rect x="7" y="7" width="6" height="6" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5"></rect>
        </svg>
      `;
    case 'export-markdown':
      return `
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="M6 3.75h6.25L15.75 7v8.25A1.5 1.5 0 0 1 14.25 16.75h-8.5a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 5.75 3.75Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"></path>
          <path d="M12.25 3.9V7h3.1M7 10.25h6M7 13h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"></path>
        </svg>
      `;
    default:
      return '';
  }
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function focusEditor() {
  const input = dom.list.querySelector('.editor');
  if (!input) return;
  input.focus();
  autosize(input);
}

function updateDraftText(nextText, caretPosition = null) {
  state.draft = nextText;
  const input = dom.list.querySelector('.editor');
  if (!input) return;
  input.value = nextText;
  autosize(input);
  input.focus();
  if (caretPosition !== null) {
    input.selectionStart = caretPosition;
    input.selectionEnd = caretPosition;
  }
}

function openPastePrompt(rowId, text, selectionStart, selectionEnd) {
  state.pastePrompt = {
    rowId,
    text,
    selectionStart,
    selectionEnd
  };
  renderPastePrompt();
}

function closePastePrompt(options = {}) {
  const { refocusEditor = true } = options;
  state.pastePrompt = null;
  renderPastePrompt();
  if (refocusEditor) focusEditor();
}

function pasteNormallyFromPrompt() {
  const pending = state.pastePrompt;
  if (!pending) return;

  closePastePrompt({ refocusEditor: false });

  if (state.editing !== pending.rowId) return;

  const start = Math.max(0, pending.selectionStart);
  const end = Math.max(start, pending.selectionEnd);
  const nextDraft = `${state.draft.slice(0, start)}${pending.text}${state.draft.slice(end)}`;
  updateDraftText(nextDraft, start + pending.text.length);
}

function confirmSplitPaste() {
  const pending = state.pastePrompt;
  if (!pending) return;

  closePastePrompt({ refocusEditor: false });
  if (state.editing !== pending.rowId) return;
  pasteRowsFromText(pending.rowId, pending.text);
}

// UI actions

function updateListName(value, options = {}) {
  const { trim = false } = options;
  const nextName = trim ? normalizeListName(value) : String(value ?? '');
  const list = currentList();
  const previousName = list.name;

  if (nextName === previousName) {
    if (trim) renderHeader();
    return;
  }

  list.name = nextName;
  markDbChanged();

  if (trim) {
    saveDb({ recordHistory: true });
    renderHeader();
    return;
  }

  scheduleTitlePersist();
  renderListOptions();
  renderBreadcrumbs();
}

function applyClickSelection(event, rowId) {
  const visible = visibleRows();
  const current = visible.findIndex((row) => row.id === rowId);
  if (current === -1) return;

  if (event.shiftKey && state.anchor) {
    const anchorIndex = visible.findIndex((row) => row.id === state.anchor);
    const safeAnchor = anchorIndex === -1 ? current : anchorIndex;
    const [start, end] = [safeAnchor, current].sort((a, b) => a - b);
    setSelection(visible.slice(start, end + 1).map((row) => row.id), visible[safeAnchor].id);
    return;
  }

  if (event.metaKey || event.ctrlKey) {
    const next = new Set(state.selected);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);

    state.selected = next.size ? next : new Set([rowId]);
    state.anchor = rowId;
    state.focused = rowId;
    state.menuRow = null;
    renderRows();
    return;
  }

  setSingleSelection(rowId);
}

function beginEdit(rowId) {
  const allRows = rows();
  const index = rowIndex(rowId, allRows);
  if (index === -1) return;

  if (expandAncestorChain(index, allRows)) {
    saveDb({ recordHistory: false });
  }

  state.editing = rowId;
  state.editOriginalText = allRows[index].text;
  state.draft = allRows[index].text;
  setSingleSelection(rowId, { render: false });
  renderRows();
}

function commitEdit() {
  if (!state.editing) return;

  const editingId = state.editing;
  const nextText = normalizeText(state.draft);
  const allRows = rows();
  const index = rowIndex(editingId, allRows);

  clearEditState();

  if (index === -1) {
    renderRows();
    return;
  }

  if (!nextText.trim()) {
    deleteRows(new Set([editingId]));
    return;
  }

  if (allRows[index].text === nextText) {
    renderRows();
    return;
  }

  allRows[index].text = nextText;
  saveDb();
  renderRows();
}

function cancelEdit() {
  if (!state.editing) return;

  const editingId = state.editing;
  const existingRow = rowById(editingId);
  const shouldDeleteBlankRow = !state.editOriginalText.trim() && !existingRow?.text?.trim();

  clearEditState();

  if (shouldDeleteBlankRow) {
    deleteRows(new Set([editingId]));
    return;
  }

  renderRows();
}

function insertBelow() {
  const allRows = rows();
  const fallbackId = allRows[allRows.length - 1]?.id || null;
  const baseId = state.focused || fallbackId;
  const index = baseId ? rowIndex(baseId, allRows) : -1;
  const level = index >= 0 ? allRows[index].level : 0;
  const insertAt = index >= 0 ? subtreeEnd(index, allRows) : allRows.length;
  const row = createRow('', level);

  allRows.splice(insertAt, 0, row);
  saveDb();
  beginEdit(row.id);
}

function deleteRows(ids) {
  if (!ids?.size) return;

  const allRows = rows();
  const expandedIds = expandRowIdsToSubtrees(ids, allRows);
  const deletedIndexes = allRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => expandedIds.has(row.id))
    .map(({ index }) => index)
    .sort((a, b) => a - b);

  if (!deletedIndexes.length) return;

  if (state.viewRoot && expandedIds.has(state.viewRoot)) {
    const viewRootIndex = rowIndex(state.viewRoot, allRows);
    const nextViewParent = viewRootIndex === -1 ? -1 : parentIndex(viewRootIndex, allRows);
    state.viewRoot = nextViewParent === -1 ? null : allRows[nextViewParent].id;
  }

  const firstDeleted = deletedIndexes[0];
  let fallbackId = null;
  const nextRow = allRows.find((row, index) => index > firstDeleted && !expandedIds.has(row.id));

  if (nextRow) {
    fallbackId = nextRow.id;
  } else if (firstDeleted > 0 && !expandedIds.has(allRows[firstDeleted - 1].id)) {
    fallbackId = allRows[firstDeleted - 1].id;
  } else {
    const directParent = parentIndex(firstDeleted, allRows);
    fallbackId = directParent !== -1 && !expandedIds.has(allRows[directParent].id) ? allRows[directParent].id : null;
  }

  currentList().rows = allRows.filter((row) => !expandedIds.has(row.id));
  clearEditState();
  state.menuRow = null;
  state.selected = fallbackId ? new Set([fallbackId]) : new Set();
  state.focused = fallbackId;
  state.anchor = fallbackId;
  ensureSelection();
  saveDb();
  renderAll();
}

function deleteSelection() {
  if (!state.selected.size) return;
  deleteRows(new Set(state.selected));
}

function indentSelection(step) {
  if (step > 0) indentRight();
  else outdentLeft();
}

function indentRight() {
  const allRows = rows();
  const rootIds = selectedRootIds(allRows);
  if (!rootIds.length) return;

  rootIds.forEach((rootId) => {
    const index = rowIndex(rootId, allRows);
    if (index <= 0) return;

    const previous = allRows[index - 1];
    if (!previous) return;

    const delta = Math.min(1, previous.level + 1 - allRows[index].level);
    if (delta <= 0) return;

    const end = subtreeEnd(index, allRows);
    for (let i = index; i < end; i += 1) {
      allRows[i].level += delta;
    }

    expandAncestorChain(index, allRows);
  });

  saveDb();
  renderRows();
}

function outdentLeft() {
  const allRows = rows();
  const rootIds = selectedRootIds(allRows);
  if (!rootIds.length) return;

  [...rootIds].reverse().forEach((rootId) => {
    const start = rowIndex(rootId, allRows);
    if (start <= 0) return;

    const oldParentIndex = parentIndex(start, allRows);
    if (oldParentIndex === -1) return;

    const oldParentId = allRows[oldParentIndex].id;
    const end = subtreeEnd(start, allRows);
    const branch = allRows.splice(start, end - start);

    branch.forEach((row) => {
      row.level = Math.max(0, row.level - 1);
    });

    const newParentIndex = rowIndex(oldParentId, allRows);
    const insertAt = newParentIndex === -1 ? allRows.length : subtreeEnd(newParentIndex, allRows);
    allRows.splice(insertAt, 0, ...branch);
  });

  saveDb();
  renderRows();
}

function toggleCollapse(rowId, force = null) {
  const allRows = rows();
  const index = rowIndex(rowId, allRows);
  if (index === -1 || !hasChildren(index, allRows)) return;

  const nextCollapsed = force === null ? !allRows[index].collapsed : Boolean(force);

  if (nextCollapsed) {
    const end = subtreeEnd(index, allRows);
    const hidesFocusedDescendant = state.focused && rowIndex(state.focused, allRows) > index && rowIndex(state.focused, allRows) < end;
    const hidesSelectedDescendant = [...state.selected].some((id) => {
      const selectedIndex = rowIndex(id, allRows);
      return selectedIndex > index && selectedIndex < end;
    });

    if (hidesFocusedDescendant || hidesSelectedDescendant) {
      state.selected = new Set([rowId]);
      state.focused = rowId;
      state.anchor = rowId;
    }
  }

  allRows[index].collapsed = nextCollapsed;
  saveDb({ recordHistory: false });
  renderRows();
}

function collapseFocused() {
  if (!state.focused) return;

  const allRows = rows();
  const index = rowIndex(state.focused, allRows);
  if (index === -1) return;

  if (hasChildren(index, allRows) && !allRows[index].collapsed) {
    toggleCollapse(state.focused, true);
    return;
  }

  const parent = parentIndex(index, allRows);
  if (parent !== -1 && isInCurrentView(allRows[parent].id, allRows)) {
    setSingleSelection(allRows[parent].id);
  }
}

function expandFocused() {
  if (!state.focused) return;

  const allRows = rows();
  const index = rowIndex(state.focused, allRows);
  if (index === -1) return;

  if (hasChildren(index, allRows) && allRows[index].collapsed) {
    toggleCollapse(state.focused, false);
    return;
  }

  if (hasChildren(index, allRows)) {
    const child = allRows[index + 1];
    if (child && isInCurrentView(child.id, allRows)) {
      setSingleSelection(child.id);
    }
  }
}

function moveFocus(step, extend = false) {
  const visible = visibleRows();
  if (!visible.length) return;

  const current = Math.max(0, visible.findIndex((row) => row.id === state.focused));
  const next = Math.max(0, Math.min(visible.length - 1, current + step));
  const nextId = visible[next].id;

  if (extend && state.anchor) {
    const anchorIndex = visible.findIndex((row) => row.id === state.anchor);
    const safeAnchor = anchorIndex === -1 ? current : anchorIndex;
    const [start, end] = [safeAnchor, next].sort((a, b) => a - b);
    setSelection(visible.slice(start, end + 1).map((row) => row.id), visible[safeAnchor].id);
    return;
  }

  setSingleSelection(nextId);
}

function moveSelection(direction) {
  const allRows = rows();
  const rootIds = selectedRootIds(allRows);
  if (!rootIds.length) return;

  const starts = rootIds
    .map((rootId) => rowIndex(rootId, allRows))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b);

  if (!starts.length) return;

  const movingLevel = allRows[starts[0]].level;
  const movingParent = parentIndex(starts[0], allRows);

  for (let i = 0; i < starts.length; i += 1) {
    if (allRows[starts[i]].level !== movingLevel) return;
    if (parentIndex(starts[i], allRows) !== movingParent) return;
    if (i > 0 && starts[i] !== subtreeEnd(starts[i - 1], allRows)) return;
  }

  const movingStart = starts[0];
  const movingEnd = subtreeEnd(starts[starts.length - 1], allRows);

  if (direction < 0) {
    let previousStart = -1;

    for (let i = movingStart - 1; i >= 0; i -= 1) {
      if (allRows[i].level === movingLevel && parentIndex(i, allRows) === movingParent) {
        previousStart = i;
        break;
      }
      if (allRows[i].level < movingLevel) break;
    }

    if (previousStart === -1) return;

    const movingBlock = allRows.slice(movingStart, movingEnd);
    const previousBlock = allRows.slice(previousStart, movingStart);
    allRows.splice(previousStart, movingEnd - previousStart, ...movingBlock, ...previousBlock);
  } else {
    let nextStart = -1;

    for (let i = movingEnd; i < allRows.length; i += 1) {
      if (allRows[i].level === movingLevel && parentIndex(i, allRows) === movingParent) {
        nextStart = i;
        break;
      }
      if (allRows[i].level < movingLevel) break;
    }

    if (nextStart === -1) return;

    const nextEnd = subtreeEnd(nextStart, allRows);
    const movingBlock = allRows.slice(movingStart, movingEnd);
    const nextBlock = allRows.slice(nextStart, nextEnd);
    allRows.splice(movingStart, nextEnd - movingStart, ...nextBlock, ...movingBlock);
  }

  saveDb();
  renderRows();
}

function applyColor(color) {
  if (!state.selected.size) return;

  rows().forEach((row) => {
    if (state.selected.has(row.id)) row.color = color;
  });

  saveDb();
  renderRows();
}

function switchList(listId) {
  if (!state.db.lists.some((list) => list.id === listId)) return;

  state.db.currentId = listId;
  clearEditState();
  state.menuRow = null;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.viewRoot = null;
  ensureSelection();
  saveDb({ recordHistory: false });
  renderAll();
}

function createList() {
  const list = {
    id: createId(),
    name: DEFAULT_LIST_NAME,
    rows: [createRow('', 0)]
  };

  state.db.lists.unshift(list);
  state.db.currentId = list.id;
  clearEditState();
  state.menuRow = null;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.viewRoot = null;
  setSingleSelection(list.rows[0].id, { render: false });
  saveDb();
  renderAll();
  dom.titleInput.focus();
  dom.titleInput.select();
}

function deleteCurrentList() {
  if (state.db.lists.length === 1) {
    state.db = createDefaultDb();
  } else {
    state.db.lists = state.db.lists.filter((list) => list.id !== state.db.currentId);
    state.db.currentId = state.db.lists[0].id;
  }

  clearEditState();
  state.menuRow = null;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.viewRoot = null;
  state.deleteListModalOpen = false;
  ensureSelection();
  saveDb();
  renderAll();
}

function focusRow(rowId) {
  state.viewRoot = rowId;
  state.menuRow = null;
  ensureSelection();
  setSingleSelection(rowId, { render: false });
  renderAll();
}

function subtreeToMarkdown(rowId) {
  const allRows = rows();
  const start = rowIndex(rowId, allRows);
  if (start === -1) return '';

  const end = subtreeEnd(start, allRows);
  const baseLevel = allRows[start].level;
  const lines = [];

  allRows.slice(start, end).forEach((row) => {
    const level = row.level - baseLevel;
    const rowLines = normalizeText(row.text).split('\n');
    const indent = '  '.repeat(level);
    const childIndent = `${indent}  `;

    lines.push(`${indent}- ${rowLines[0] || ''}`);

    rowLines.slice(1).forEach((line) => {
      lines.push(`${childIndent}${line}`);
    });
  });

  return lines.join('\n');
}

function exportSubtreeMarkdown(rowId) {
  const markdown = subtreeToMarkdown(rowId);
  const filename = `${slugify(rowLabel(rowById(rowId)?.text || 'row'))}.md`;
  downloadTextFile(filename, markdown, 'text/markdown;charset=utf-8');
  state.menuRow = null;
  renderRows();
}

function downloadTextFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function countIndentation(value) {
  return String(value || '').replace(/\t/g, '  ').length;
}

function splitIntoParagraphBlocks(text) {
  const blocks = [];
  let current = [];

  normalizeText(text).split('\n').forEach((line) => {
    if (!line.trim()) {
      if (current.length) blocks.push(current);
      current = [];
      return;
    }

    current.push(line);
  });

  if (current.length) blocks.push(current);
  return blocks;
}

function matchOutlineLine(line) {
  return String(line || '').match(/^(\s*)(?:[-*]|\d+[.)]|[A-Za-z][.)])\s+(.*)$/);
}

function parseBulletEntries(lines) {
  const entries = [];
  let current = null;
  let sawBullet = false;
  let invalid = false;
  let pendingBlankLine = false;

  lines.forEach((line) => {
    if (!line.trim()) {
      if (sawBullet && current) pendingBlankLine = true;
      return;
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch) {
      sawBullet = true;
      current = {
        indent: countIndentation(bulletMatch[1]),
        text: bulletMatch[2]
      };
      entries.push(current);
      pendingBlankLine = false;
      return;
    }

    if (!sawBullet || !current) {
      invalid = true;
      return;
    }

    current.text += `${pendingBlankLine ? '\n\n' : '\n'}${line.trim()}`;
    pendingBlankLine = false;
  });

  if (!sawBullet || invalid) return [];

  return entries.map((entry) => ({ ...entry, text: entry.text.trimEnd() }));
}

function indentationLevels(entries) {
  return [...new Set(entries.map((entry) => entry.indent))].sort((a, b) => a - b);
}

function tokenizePastedOutline(text) {
  const tokens = [];
  let current = null;
  let pendingBlankLine = false;

  normalizeText(text).split('\n').forEach((line) => {
    const outlineMatch = matchOutlineLine(line);

    if (outlineMatch) {
      if (current) tokens.push(current);
      current = {
        kind: 'list',
        indent: countIndentation(outlineMatch[1]),
        text: outlineMatch[2].trimEnd()
      };
      pendingBlankLine = false;
      return;
    }

    if (!line.trim()) {
      pendingBlankLine = Boolean(current);
      return;
    }

    const plainMatch = line.match(/^(\s*)(.*)$/);
    const indent = countIndentation(plainMatch[1]);
    const textValue = plainMatch[2].trimEnd();

    if (!current || pendingBlankLine) {
      if (current) tokens.push(current);
      current = {
        kind: 'plain',
        indent,
        text: textValue
      };
      pendingBlankLine = false;
      return;
    }

    current.text += `${pendingBlankLine ? '\n\n' : '\n'}${textValue.trim()}`;
    pendingBlankLine = false;
  });

  if (current) tokens.push(current);
  return tokens.filter((token) => token.text.trim());
}

function previousSameIndentMeta(metas, indent, kind) {
  for (let index = metas.length - 1; index >= 0; index -= 1) {
    const meta = metas[index];
    if (meta.indent !== indent) continue;
    if (kind && meta.kind !== kind) continue;
    return meta;
  }

  return null;
}

function previousSameIndentHeadingMeta(metas, indent) {
  for (let index = metas.length - 1; index >= 0; index -= 1) {
    const meta = metas[index];
    if (meta.indent !== indent || meta.kind !== 'plain') continue;
    if (isHeadingLikeText(meta.text)) return meta;
  }

  return null;
}

function shallowestSameIndentMeta(metas, indent) {
  let match = null;

  metas.forEach((meta) => {
    if (meta.indent !== indent) return;
    if (!match || meta.level < match.level) match = meta;
  });

  return match;
}

function isStandaloneStrongText(text) {
  return /^\*\*[^*][\s\S]*\*\*$/.test(String(text || '').trim());
}

function markdownHeadingMatch(text) {
  return String(text || '').trim().match(/^(#{1,6})\s+(.+)$/u);
}

function isHeadingLikeText(text) {
  return isStandaloneStrongText(text) || Boolean(markdownHeadingMatch(text));
}

function buildPastedRowsFromTokens(tokens, baseLevel) {
  const metas = [];

  tokens.forEach((token) => {
    const previous = metas[metas.length - 1];
    let level = baseLevel;
    let sectionLevel = null;

    if (!previous) {
      level = baseLevel;
    } else if (token.kind === 'plain') {
      const plainSibling = previousSameIndentMeta(metas, token.indent, 'plain');
      const isHeadingLike = isHeadingLikeText(token.text);
      const headingSibling = isHeadingLike ? previousSameIndentHeadingMeta(metas, token.indent) : null;

      if (headingSibling) {
        level = headingSibling.level;
        sectionLevel = headingSibling.sectionLevel;
      } else if (previous.kind === 'list') {
        if (previous.sectionLevel != null && token.indent <= previous.indent) {
          level = previous.sectionLevel;
          sectionLevel = previous.sectionLevel;
        } else {
          level = previous.level + 1;
          sectionLevel = previous.level;
        }
      } else if (plainSibling) {
        level = plainSibling.level;
        sectionLevel = plainSibling.sectionLevel;
      } else if (previous.sectionLevel != null && token.indent <= previous.indent) {
        level = previous.sectionLevel;
        sectionLevel = previous.sectionLevel;
      } else if (previous.sectionLevel != null) {
        level = previous.sectionLevel;
        sectionLevel = previous.sectionLevel;
      } else {
        level = baseLevel;
      }
    } else if (
      (previous.kind === 'plain' || previous.text.trimEnd().endsWith(':'))
      && token.indent <= previous.indent
    ) {
      level = previous.level + 1;
      sectionLevel = previous.text.trimEnd().endsWith(':') ? previous.level : previous.sectionLevel;
    } else if (previous.indent < token.indent) {
      level = previous.level + 1;
      sectionLevel = previous.text.trimEnd().endsWith(':') ? previous.level : previous.sectionLevel;
    } else {
      const sibling = previousSameIndentMeta(metas, token.indent, 'list');
      if (sibling) {
        level = sibling.level;
        sectionLevel = sibling.sectionLevel;
      } else {
        const outlineRoot = shallowestSameIndentMeta(metas, token.indent);
        level = outlineRoot ? outlineRoot.level + 1 : baseLevel;
        sectionLevel = outlineRoot ? outlineRoot.level : null;
      }
    }

    metas.push({ ...token, level, sectionLevel });
  });

  return metas.map((meta) => createRow(meta.text, meta.level));
}

function parsePastedRows(text, baseLevel) {
  const normalized = normalizeText(text);
  const tokens = tokenizePastedOutline(normalized);
  const hasOutline = tokens.some((token) => token.kind === 'list');

  if (!hasOutline) {
    return splitIntoParagraphBlocks(normalized).map((blockLines) => createRow(blockLines.join('\n'), baseLevel));
  }

  return buildPastedRowsFromTokens(tokens, baseLevel);
}

function pathMatchesSuffix(fullPath, suffixPath) {
  if (suffixPath.length > fullPath.length) return false;
  const offset = fullPath.length - suffixPath.length;
  return suffixPath.every((label, index) => label === fullPath[offset + index]);
}

function mergeParsedRowsIntoContext(editingIndex, parsedRows, allRows) {
  if (editingIndex === -1 || !parsedRows.length) return null;

  const currentPath = ancestorIndexes(editingIndex, allRows).map((index) => comparableRowLabel(allRows[index].text));
  let bestMatch = null;

  parsedRows.forEach((row, parsedIndex) => {
    const parsedPathIndexes = ancestorIndexes(parsedIndex, parsedRows);
    if (parsedPathIndexes.length !== parsedIndex + 1) return;

    const parsedPath = parsedPathIndexes.map((index) => comparableRowLabel(parsedRows[index].text));
    if (!pathMatchesSuffix(currentPath, parsedPath)) return;

    if (!bestMatch || parsedPath.length > bestMatch.path.length) {
      bestMatch = {
        path: parsedPath,
        pathIndexes: parsedPathIndexes,
        rowLevel: parsedRows[parsedIndex].level
      };
    }
  });

  if (!bestMatch) return null;

  const hiddenIndexes = new Set(bestMatch.pathIndexes);
  const levelDelta = allRows[editingIndex].level - bestMatch.rowLevel;
  const mergedRows = parsedRows
    .filter((_, index) => !hiddenIndexes.has(index))
    .map((row) => ({ ...row, level: Math.max(0, row.level + levelDelta) }));

  return mergedRows.length ? mergedRows : null;
}

function pasteRowsFromText(editingId, text) {
  const allRows = rows();
  const index = rowIndex(editingId, allRows);
  if (index === -1) return;

  const parsedRows = parsePastedRows(text, allRows[index].level);
  if (!parsedRows.length) return;
  const canReplaceCurrent = !state.draft.trim() && !hasChildren(index, allRows);
  const mergeContextIndex = state.draft.trim()
    ? index
    : (canReplaceCurrent ? parentIndex(index, allRows) : -1);
  const mergedRows = mergeContextIndex === -1
    ? null
    : mergeParsedRowsIntoContext(mergeContextIndex, parsedRows, allRows);
  const nextRows = mergedRows || parsedRows;

  if (canReplaceCurrent) {
    allRows.splice(index, 1, ...nextRows);
  } else {
    allRows.splice(subtreeEnd(index, allRows), 0, ...nextRows);
  }

  clearEditState();
  state.menuRow = null;
  setSingleSelection(nextRows[0].id, { render: false });
  saveDb();
  renderRows();
}

// Markdown

function slugify(value) {
  return String(value || 'row')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'row';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  const trimmed = String(url || '').trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : '#';
}

function normalizeAutolinkUrl(url) {
  const trimmed = String(url || '').trim();
  return /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function stripAutolinkTrailingPunctuation(url) {
  const clean = String(url || '').replace(/[),.;:!?]+$/g, '');
  return {
    clean,
    trailing: String(url || '').slice(clean.length)
  };
}

function renderInlineMarkdown(raw) {
  const links = [];
  const withMarkdownTokens = String(raw).replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, url) => {
    const token = `@@LINK${links.length}@@`;
    links.push({ label, url });
    return token;
  });

  const withTokens = withMarkdownTokens.replace(/(^|[\s(])((?:https?:\/\/|mailto:|www\.)[^\s<]+)/g, (_, prefix, rawUrl) => {
    const { clean, trailing } = stripAutolinkTrailingPunctuation(rawUrl);
    if (!clean) return `${prefix}${rawUrl}`;

    const token = `@@LINK${links.length}@@`;
    links.push({ label: clean, url: normalizeAutolinkUrl(clean) });
    return `${prefix}${token}${trailing}`;
  });

  let html = escapeHtml(withTokens);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/@@LINK(\d+)@@/g, (_, index) => {
    const link = links[Number(index)];
    if (!link) return '';

    return `<a href="${escapeHtml(sanitizeUrl(link.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`;
  });

  return html;
}

function renderHeadingLine(line) {
  const match = markdownHeadingMatch(line);
  if (!match) return renderInlineMarkdown(line);

  const level = Math.min(6, match[1].length);
  return `<div class="md-heading md-heading-${level}">${renderInlineMarkdown(match[2])}</div>`;
}

function renderListBlock(lines) {
  const entries = parseBulletEntries(lines);
  if (!entries.length) {
    return lines.map((line) => renderHeadingLine(line)).join('<br>');
  }

  const levels = indentationLevels(entries);
  const items = entries.map((entry) => ({
    level: levels.indexOf(entry.indent),
    text: entry.text
  }));

  let html = '';
  let previousLevel = -1;

  items.forEach((item, index) => {
    const text = renderInlineMarkdown(item.text).replace(/\n/g, '<br>');

    if (index === 0) {
      for (let depth = 0; depth <= item.level; depth += 1) {
        html += '<ul>';
      }
      html += `<li>${text}`;
      previousLevel = item.level;
      return;
    }

    if (item.level > previousLevel) {
      for (let depth = previousLevel; depth < item.level; depth += 1) {
        html += '<ul>';
      }
      html += `<li>${text}`;
      previousLevel = item.level;
      return;
    }

    if (item.level === previousLevel) {
      html += `</li><li>${text}`;
      return;
    }

    for (let depth = previousLevel; depth > item.level; depth -= 1) {
      html += '</li></ul>';
    }
    html += `</li><li>${text}`;
    previousLevel = item.level;
  });

  for (let depth = previousLevel; depth >= 0; depth -= 1) {
    html += '</li></ul>';
  }

  return html;
}

function renderMarkdown(text) {
  const normalized = normalizeText(text);
  if (!normalized.trim()) return '';

  const lines = normalized.split('\n');
  const parts = [];
  let paragraphLines = [];
  let quoteLines = [];
  let listLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    parts.push(paragraphLines.map((line) => renderHeadingLine(line)).join('<br>'));
    paragraphLines = [];
  }

  function flushQuote() {
    if (!quoteLines.length) return;

    const html = quoteLines
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .map((line) => renderInlineMarkdown(line))
      .join('<br>');

    parts.push(`<blockquote>${html}</blockquote>`);
    quoteLines = [];
  }

  function flushList() {
    if (!listLines.length) return;
    parts.push(renderListBlock(listLines));
    listLines = [];
  }

  lines.forEach((line) => {
    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      flushList();
      parts.push('<br>');
      return;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      flushList();
      quoteLines.push(line);
      return;
    }

    if (markdownHeadingMatch(line)) {
      flushParagraph();
      flushQuote();
      flushList();
      parts.push(renderHeadingLine(line));
      return;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      flushQuote();
      listLines.push(line);
      return;
    }

    if (listLines.length && /^\s+/.test(line)) {
      listLines.push(line);
      return;
    }

    flushQuote();
    flushList();
    paragraphLines.push(line);
  });

  flushParagraph();
  flushQuote();
  flushList();
  return parts.join('');
}

// Events

function wireUi() {
  dom.list.addEventListener('click', onListClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value;
    renderRows();
  });

  dom.titleInput.addEventListener('input', () => {
    updateListName(dom.titleInput.value);
  });

  dom.titleInput.addEventListener('blur', () => {
    updateListName(dom.titleInput.value, { trim: true });
  });

  dom.listSelect.addEventListener('change', () => {
    switchList(dom.listSelect.value);
  });

  dom.settingsBtn.addEventListener('click', () => {
    state.settingsMenuOpen = !state.settingsMenuOpen;
    state.titleMenuOpen = false;
    renderHeader();
  });
  dom.titleMenuBtn.addEventListener('click', () => {
    state.titleMenuOpen = !state.titleMenuOpen;
    state.settingsMenuOpen = false;
    renderHeader();
  });
  dom.undoBtn.addEventListener('click', undoChange);
  dom.openSettingsBtn.addEventListener('click', openSettingsModal);
  dom.openStatsBtn.addEventListener('click', openStatsModal);
  dom.pastePromptPlainBtn.addEventListener('click', pasteNormallyFromPrompt);
  dom.pastePromptSplitBtn.addEventListener('click', confirmSplitPaste);
  dom.statsCloseBtn.addEventListener('click', closeStatsModal);
  dom.statsModal.addEventListener('click', (event) => {
    if (event.target === dom.statsModal || event.target.closest('.modal-backdrop')) {
      closeStatsModal();
    }
  });
  dom.settingsCloseBtn.addEventListener('click', closeSettingsModal);
  dom.settingsModal.addEventListener('click', (event) => {
    if (event.target === dom.settingsModal || event.target.closest('.modal-backdrop')) {
      closeSettingsModal();
    }
  });
  dom.newListBtn.addEventListener('click', createList);
  dom.deleteListBtn.addEventListener('click', openDeleteListModal);
  dom.deleteListCancelBtn.addEventListener('click', closeDeleteListModal);
  dom.deleteListConfirmBtn.addEventListener('click', deleteCurrentList);
  dom.deleteListModal.addEventListener('click', (event) => {
    if (event.target === dom.deleteListModal || event.target.closest('.modal-backdrop')) {
      closeDeleteListModal();
    }
  });
}

function onEditorInput(event) {
  state.draft = event.target.value;
  autosize(event.target);
}

function onEditorBlur() {
  if (state.pastePrompt) return;
  commitEdit();
}

function onEditorPaste(event) {
  const pastedText = event.clipboardData?.getData('text/plain');
  if (!pastedText || !normalizeText(pastedText).includes('\n')) return;

  event.preventDefault();
  openPastePrompt(
    state.editing,
    pastedText,
    event.target.selectionStart ?? state.draft.length,
    event.target.selectionEnd ?? event.target.selectionStart ?? state.draft.length
  );
}

function onDocumentClick(event) {
  if (state.menuRow && !event.target.closest('.actions-wrap')) {
    state.menuRow = null;
    renderRows();
  }

  if (state.settingsMenuOpen && !event.target.closest('.toolbar-menu-wrap')) {
    state.settingsMenuOpen = false;
    renderHeader();
  }

  if (state.titleMenuOpen && !event.target.closest('.title-actions')) {
    state.titleMenuOpen = false;
    renderHeader();
  }
}

function onListClick(event) {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) {
    const rowEl = actionTarget.closest('.row');
    if (!rowEl) return;
    handleRowAction(actionTarget.dataset.action, rowEl.dataset.id);
    return;
  }

  if (state.editing || event.target.closest('a')) return;

  const rowEl = event.target.closest('.row');
  if (!rowEl) return;

  if (event.detail >= 2) {
    beginEdit(rowEl.dataset.id);
    return;
  }

  applyClickSelection(event, rowEl.dataset.id);
}

function handleRowAction(action, rowId) {
  switch (action) {
    case 'toggle-collapse':
      toggleCollapse(rowId);
      break;
    case 'toggle-menu':
      state.menuRow = state.menuRow === rowId ? null : rowId;
      renderRows();
      break;
    case 'focus-row':
      focusRow(rowId);
      break;
    case 'export-markdown':
      exportSubtreeMarkdown(rowId);
      break;
    default:
      break;
  }
}

// Keyboard

function updateKeyChain(key) {
  state.keyChain = (state.keyChain + key).slice(-EDIT_SHORTCUT.length);
  clearTimeout(keyChainTimer);
  keyChainTimer = setTimeout(() => {
    state.keyChain = '';
  }, KEY_CHAIN_RESET_MS);
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, button'));
}

function isBranchMoveShortcut(event, key) {
  return event.altKey && !event.ctrlKey && !event.metaKey && (event.key === key || event.code === key);
}

function hasPrimaryModifier(event) {
  return event.metaKey || event.ctrlKey;
}

function isUndoShortcut(event) {
  return hasPrimaryModifier(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
}

function isRedoShortcut(event) {
  return (
    hasPrimaryModifier(event)
    && !event.altKey
    && (
      (event.shiftKey && event.key.toLowerCase() === 'z')
      || (!event.shiftKey && event.key.toLowerCase() === 'y')
    )
  );
}

function moveFromEdit(step, extend = false) {
  const editingId = state.editing;
  if (!editingId) return;

  if (!state.draft.trim()) deleteRows(new Set([editingId]));
  else commitEdit();

  moveFocus(step, extend);
}

function onKeyDown(event) {
  if (event.defaultPrevented) return;

  if (state.settingsMenuOpen && event.key === 'Escape') {
    event.preventDefault();
    state.settingsMenuOpen = false;
    renderHeader();
    return;
  }

  if (state.titleMenuOpen && event.key === 'Escape') {
    event.preventDefault();
    state.titleMenuOpen = false;
    renderHeader();
    return;
  }

  if (state.settingsModalOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettingsModal();
    }
    return;
  }

  if (state.deleteListModalOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDeleteListModal();
    }
    return;
  }

  if (state.statsModal.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeStatsModal();
    }
    return;
  }

  if (state.pastePrompt) {
    if (event.key === 'Escape') {
      event.preventDefault();
      pasteNormallyFromPrompt();
    }
    return;
  }

  const typingInEditor = state.editing !== null;
  if (!typingInEditor && isInteractiveTarget(event.target)) return;

  if (!typingInEditor && isUndoShortcut(event)) {
    event.preventDefault();
    undoChange();
    return;
  }

  if (!typingInEditor && isRedoShortcut(event)) {
    event.preventDefault();
    redoChange();
    return;
  }

  if (typingInEditor) {
    if (isBranchMoveShortcut(event, 'ArrowUp')) {
      event.preventDefault();
      const editingId = state.editing;
      commitEdit();
      moveSelection(-1);
      if (editingId && rowById(editingId)) beginEdit(editingId);
      return;
    }

    if (isBranchMoveShortcut(event, 'ArrowDown')) {
      event.preventDefault();
      const editingId = state.editing;
      commitEdit();
      moveSelection(1);
      if (editingId && rowById(editingId)) beginEdit(editingId);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
      return;
    }

    if (event.key === 'Enter' && event.shiftKey) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit();
      insertBelow();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFromEdit(-1, event.shiftKey);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFromEdit(1, event.shiftKey);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      indentSelection(event.shiftKey ? -1 : 1);
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && state.draft === '') {
      event.preventDefault();
      deleteRows(new Set([state.editing]));
      return;
    }

    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    const ids = visibleRows().map((row) => row.id);
    setSelection(ids, ids[0] || null);
    return;
  }

  if (isBranchMoveShortcut(event, 'ArrowUp')) {
    event.preventDefault();
    moveSelection(-1);
    return;
  }

  if (isBranchMoveShortcut(event, 'ArrowDown')) {
    event.preventDefault();
    moveSelection(1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(-1, event.shiftKey);
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveFocus(1, event.shiftKey);
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    collapseFocused();
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    expandFocused();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    insertBelow();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    indentSelection(event.shiftKey ? -1 : 1);
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelection();
    return;
  }

  if (/^[1-6]$/.test(event.key)) {
    event.preventDefault();
    applyColor(event.key);
    return;
  }

  if (event.key === '0') {
    event.preventDefault();
    applyColor('');
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
    updateKeyChain(event.key.toLowerCase());

    if (state.keyChain === EDIT_SHORTCUT && state.focused) {
      event.preventDefault();
      state.keyChain = '';
      beginEdit(state.focused);
    }
  }
}
