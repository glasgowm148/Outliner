import {
  DEFAULT_LIST_NAME,
  buildDbOperations,
  cloneDb,
  createListCheckpoint,
  createDefaultDb,
  createId,
  createRow,
  disablePublicListShare,
  enablePublicListShare,
  loadBootstrapDb,
  loginUser,
  leaveSharedList,
  logoutUser,
  migrateLegacyBootstrapDb,
  parseDbBackupText,
  normalizeDbObject,
  normalizeListName,
  normalizeText,
  readAuthSession,
  readListRevisions,
  readPublicList,
  readStorageStats,
  readStoredDb,
  revokeListShare,
  restoreListRevision,
  registerUser,
  serializeDbBackup,
  shareListWithEmail,
  updateListShareRole,
  writeBootstrapDb,
  writeStoredDbOps
} from './storage.js';
import { comparableRowLabel, renderMarkdown, rowLabel, slugify } from './markdown.js';
import { matchOutlineLine, mergeParsedRowsIntoContext, parsePastedRows } from './outline.js';

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
  menuAccountEmail: document.getElementById('menuAccountEmail'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  openStatsBtn: document.getElementById('openStatsBtn'),
  menuLogoutBtn: document.getElementById('menuLogoutBtn'),
  exportBackupBtn: document.getElementById('exportBackupBtn'),
  importBackupBtn: document.getElementById('importBackupBtn'),
  repairDbBtn: document.getElementById('repairDbBtn'),
  importDbInput: document.getElementById('importDbInput'),
  settingsDataStatus: document.getElementById('settingsDataStatus'),
  searchScope: document.getElementById('searchScope'),
  searchResults: document.getElementById('searchResults'),
  listSelect: document.getElementById('listSelect'),
  newListBtn: document.getElementById('newListBtn'),
  deleteListBtn: document.getElementById('deleteListBtn'),
  historyListBtn: document.getElementById('historyListBtn'),
  shareListBtn: document.getElementById('shareListBtn'),
  breadcrumbs: document.getElementById('breadcrumbs'),
  list: document.getElementById('list'),
  pastePrompt: document.getElementById('pastePrompt'),
  pastePromptPreview: document.getElementById('pastePromptPreview'),
  pastePromptPlainBtn: document.getElementById('pastePromptPlainBtn'),
  pastePromptSplitBtn: document.getElementById('pastePromptSplitBtn'),
  exportModal: document.getElementById('exportModal'),
  exportModalPreview: document.getElementById('exportModalPreview'),
  exportModalStatus: document.getElementById('exportModalStatus'),
  exportCloseBtn: document.getElementById('exportCloseBtn'),
  exportCopyBtn: document.getElementById('exportCopyBtn'),
  exportDownloadBtn: document.getElementById('exportDownloadBtn'),
  statsModal: document.getElementById('statsModal'),
  statsModalContent: document.getElementById('statsModalContent'),
  statsCloseBtn: document.getElementById('statsCloseBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  deleteListModal: document.getElementById('deleteListModal'),
  deleteListName: document.getElementById('deleteListName'),
  deleteListBody: document.getElementById('deleteListModalBody'),
  deleteListCancelBtn: document.getElementById('deleteListCancelBtn'),
  deleteListConfirmBtn: document.getElementById('deleteListConfirmBtn'),
  shareListModal: document.getElementById('shareListModal'),
  shareListTitle: document.getElementById('shareListTitle'),
  shareListOwner: document.getElementById('shareListOwner'),
  shareListHint: document.getElementById('shareListHint'),
  shareListStatus: document.getElementById('shareListStatus'),
  shareListPublicSection: document.getElementById('shareListPublicSection'),
  shareListPublicLink: document.getElementById('shareListPublicLink'),
  shareListPublicHint: document.getElementById('shareListPublicHint'),
  shareListPublicEnableBtn: document.getElementById('shareListPublicEnableBtn'),
  shareListPublicCopyBtn: document.getElementById('shareListPublicCopyBtn'),
  shareListPublicDisableBtn: document.getElementById('shareListPublicDisableBtn'),
  shareListCollaborators: document.getElementById('shareListCollaborators'),
  shareListForm: document.getElementById('shareListForm'),
  shareListEmail: document.getElementById('shareListEmail'),
  shareListRole: document.getElementById('shareListRole'),
  shareListSubmitBtn: document.getElementById('shareListSubmitBtn'),
  shareListLeaveBtn: document.getElementById('shareListLeaveBtn'),
  shareListCloseBtn: document.getElementById('shareListCloseBtn'),
  historyModal: document.getElementById('historyModal'),
  historyListTitle: document.getElementById('historyListTitle'),
  historyStatus: document.getElementById('historyStatus'),
  historyLabel: document.getElementById('historyLabel'),
  historySaveBtn: document.getElementById('historySaveBtn'),
  historyEntries: document.getElementById('historyEntries'),
  historyCloseBtn: document.getElementById('historyCloseBtn'),
  conflictModal: document.getElementById('conflictModal'),
  conflictTitle: document.getElementById('conflictModalTitle'),
  conflictLocalText: document.getElementById('conflictLocalText'),
  conflictServerText: document.getElementById('conflictServerText'),
  conflictStatus: document.getElementById('conflictStatus'),
  conflictCloseBtn: document.getElementById('conflictCloseBtn'),
  conflictKeepRemoteBtn: document.getElementById('conflictKeepRemoteBtn'),
  conflictCopyLocalBtn: document.getElementById('conflictCopyLocalBtn'),
  conflictOverwriteBtn: document.getElementById('conflictOverwriteBtn'),
  authScreen: document.getElementById('authScreen'),
  authTitle: document.getElementById('authTitle'),
  authBody: document.getElementById('authBody'),
  authStatusMessage: document.getElementById('authStatusMessage'),
  authForm: document.getElementById('authForm'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  authSubmitBtn: document.getElementById('authSubmitBtn'),
  authToggleBtn: document.getElementById('authToggleBtn')
};

const state = {
  db: createDefaultDb(),
  selected: new Set(),
  anchor: null,
  focused: null,
  editing: null,
  editOriginalText: '',
  draft: '',
  keyChain: '',
  searchQuery: '',
  searchScope: 'current',
  searchResultIndex: 0,
  menuRow: null,
  settingsMenuOpen: false,
  titleMenuOpen: false,
  viewRoot: null,
  pastePrompt: null,
  exportModal: {
    open: false,
    markdown: '',
    filename: 'row.md',
    status: '',
    statusKind: ''
  },
  statsModal: {
    open: false,
    loading: false,
    error: '',
    data: null
  },
  settingsDataStatus: {
    busy: false,
    kind: '',
    message: ''
  },
  auth: {
    status: 'loading',
    mode: 'login',
    pending: false,
    error: '',
    user: null
  },
  settingsModalOpen: false,
  deleteListModalOpen: false,
  shareListModal: {
    open: false,
    busy: false,
    error: '',
    success: ''
  },
  historyModal: {
    open: false,
    loading: false,
    saving: false,
    restoringId: '',
    error: '',
    success: '',
    revisions: []
  },
  conflictModal: {
    open: false,
    busy: false,
    error: '',
    conflict: null
  },
  publicView: {
    active: false,
    token: '',
    error: ''
  }
};

let keyChainTimer = null;
let persistQueue = Promise.resolve();
let titlePersistTimer = null;
let localChangeVersion = 0;
let authSessionVersion = 0;
let persistedDb = null;

const historyState = {
  undoStack: [],
  redoStack: []
};

ensureSelection();
wireUi();
renderAll();
resetHistory();
initializeApp();

// Storage

function currentUserId() {
  return state.auth.user?.id || 'guest';
}

function currentUserEmail() {
  return state.auth.user?.email || '';
}

function captureAsyncUiContext(options = {}) {
  const { listId = '', modal = '' } = options;
  return {
    sessionVersion: authSessionVersion,
    userId: currentUserId(),
    listId,
    modal
  };
}

function isAsyncUiContextActive(context) {
  if (!context) return false;
  if (context.sessionVersion !== authSessionVersion) return false;
  if (context.userId !== currentUserId()) return false;
  if (context.userId !== 'guest' && !isAuthenticated()) return false;
  if (context.listId && currentList()?.id !== context.listId) return false;
  if (context.modal === 'share' && !state.shareListModal.open) return false;
  if (context.modal === 'history' && !state.historyModal.open) return false;
  if (context.modal === 'stats' && !state.statsModal.open) return false;
  return true;
}

function setAuthState(nextState) {
  state.auth = {
    ...state.auth,
    ...nextState
  };
}

function isAuthenticated() {
  return state.auth.status === 'authenticated' && Boolean(state.auth.user);
}

function isPublicMode() {
  return state.publicView.active;
}

function hasPublicViewError() {
  return isPublicMode() && Boolean(state.publicView.error);
}

function publicTokenFromLocation() {
  const match = window.location.pathname.match(/^\/public\/([^/]+)$/);
  if (!match) {
    return { token: '', invalid: false };
  }

  try {
    return { token: decodeURIComponent(match[1]), invalid: false };
  } catch {
    return { token: '', invalid: true };
  }
}

function resetPersistQueue() {
  persistQueue = Promise.resolve();
}

function setPersistedDb(nextDb) {
  persistedDb = nextDb ? normalizeDbObject(cloneDb(nextDb)) : null;
}

// Writes stay local-first: update the bootstrap cache immediately and serialize
// diff-based server writes so older local snapshots cannot race ahead of newer edits.
function persistDb(options = {}) {
  if (!isAuthenticated()) return Promise.resolve();
  const { keepalive = false, throwOnError = false } = options;
  const snapshot = cloneDb(state.db);
  const baseline = persistedDb ? cloneDb(persistedDb) : cloneDb(snapshot);
  const changeSet = buildDbOperations(baseline, snapshot);
  const userId = currentUserId();
  const sessionVersion = authSessionVersion;
  writeBootstrapDb(snapshot, userId);

  // Serialize writes and bind them to the session that scheduled them so a
  // delayed save cannot land in the next account after logout/login.
  const operation = persistQueue
    .catch(() => {})
    .then(() => {
      if (
        sessionVersion !== authSessionVersion
        || !isAuthenticated()
        || currentUserId() !== userId
      ) {
        return;
      }

      return writeStoredDbOps(baseline, snapshot, { keepalive }).then((result) => {
        setPersistedDb(result);
        writeBootstrapDb(result, userId);
        return result;
      });
    });

  persistQueue = operation.catch((error) => {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (error?.code === 'ROW_CONFLICT') {
      openConflictModal(error, { baseline, snapshot, changeSet });
      return;
    }
    console.warn('SQLite backend persist failed, using bootstrap cache only.', error);
  });

  return throwOnError ? operation : persistQueue;
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

function flushPendingTitlePersist(options = {}) {
  if (titlePersistTimer === null) return;
  const { keepalive = false } = options;
  clearTitlePersistTimer();
  saveDb({ recordHistory: false, keepalive });
}

function saveDb(options = {}) {
  if (!isAuthenticated()) return Promise.resolve();
  const { recordHistory = true, keepalive = false, throwOnError = false } = options;
  clearTitlePersistTimer();
  if (recordHistory) pushHistorySnapshot();
  markDbChanged();
  const persist = persistDb({ keepalive, throwOnError });
  renderUndoButton();
  return persist;
}

function createHistorySnapshot() {
  const snapshot = {
    db: cloneDb(state.db),
    selected: [...state.selected],
    anchor: state.anchor,
    focused: state.focused,
    viewRoot: state.viewRoot
  };

  snapshot.key = JSON.stringify(snapshot);
  return snapshot;
}

function historySnapshotKey(snapshot) {
  return snapshot?.key || '';
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

  if (persist) {
    markDbChanged();
    persistDb();
  }
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

// Boot from localStorage immediately, then hydrate from SQLite unless something
// changed locally while that async read was in flight.
async function initializeStorage() {
  const startVersion = localChangeVersion;
  const startAuthVersion = authSessionVersion;
  const startUserId = currentUserId();

  try {
    const storedDb = await readStoredDb();
    if (
      startAuthVersion !== authSessionVersion
      || !isAuthenticated()
      || currentUserId() !== startUserId
    ) {
      return;
    }

    if (!storedDb) {
      await persistDb();
      return;
    }

    if (localChangeVersion !== startVersion) {
      writeBootstrapDb(state.db, currentUserId());
      return;
    }

    // Only replace the optimistic bootstrap snapshot if nothing local changed
    // while the authenticated read was in flight.
    const normalizedStoredDb = normalizeDbObject(storedDb);
    if (JSON.stringify(normalizedStoredDb) !== JSON.stringify(state.db)) {
      state.db = normalizedStoredDb;
      setPersistedDb(normalizedStoredDb);
      clearEditState();
      state.menuRow = null;
      ensureSelection();
      renderAll();
    }

    writeBootstrapDb(normalizedStoredDb, currentUserId());
    setPersistedDb(normalizedStoredDb);
    resetHistory();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    console.warn('SQLite backend unavailable, continuing with bootstrap cache.', error);
  }
}

function resetUiStateForSession() {
  clearTitlePersistTimer();
  clearEditState();
  state.exportModal = {
    open: false,
    markdown: '',
    filename: 'row.md',
    status: '',
    statusKind: ''
  };
  state.selected = new Set();
  state.anchor = null;
  state.focused = null;
  state.menuRow = null;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.viewRoot = null;
  state.searchQuery = '';
  state.searchScope = 'current';
  state.searchResultIndex = 0;
  state.statsModal = { open: false, loading: false, error: '', data: null };
  state.settingsModalOpen = false;
  state.deleteListModalOpen = false;
  state.shareListModal = { open: false, busy: false, error: '', success: '' };
  state.historyModal = { open: false, loading: false, saving: false, restoringId: '', error: '', success: '', revisions: [] };
  state.conflictModal = { open: false, busy: false, error: '', conflict: null };
}

function activatePublicView(list, token) {
  setPersistedDb(null);
  state.publicView = {
    active: true,
    token,
    error: ''
  };
  state.db = normalizeDbObject({
    currentId: list.id,
    lists: [
      {
        id: list.id,
        name: list.name,
        isOwner: false,
        ownerUserId: '',
        ownerEmail: '',
        accessRole: 'public',
        canEdit: false,
        canShare: false,
        canLeave: false,
        publicShareToken: token,
        collaborators: [],
        rows: list.rows || []
      }
    ]
  });
  resetUiStateForSession();
  ensureSelection();
  resetHistory();
  renderAll();
}

function loadBootstrapForCurrentUser() {
  state.publicView = { active: false, token: '', error: '' };
  migrateLegacyBootstrapDb(currentUserId());
  state.db = normalizeDbObject(loadBootstrapDb(currentUserId()));
  setPersistedDb(state.db);
  writeBootstrapDb(state.db, currentUserId());
  resetUiStateForSession();
  ensureSelection();
  resetHistory();
  renderAll();
}

function handleAuthLoss() {
  authSessionVersion += 1;
  resetPersistQueue();
  setPersistedDb(null);
  state.publicView = { active: false, token: '', error: '' };
  setAuthState({
    status: 'unauthenticated',
    pending: false,
    mode: 'login',
    error: 'Your session ended. Sign in again.',
    user: null
  });
  dom.authPassword.value = '';
  state.db = createDefaultDb();
  resetUiStateForSession();
  resetHistory();
  renderAll();
}

async function initializeAuthenticatedSession(user) {
  authSessionVersion += 1;
  resetPersistQueue();
  state.publicView = { active: false, token: '', error: '' };
  setAuthState({
    status: 'authenticated',
    pending: false,
    error: '',
    user
  });
  loadBootstrapForCurrentUser();
  await initializeStorage();
  renderAll();
}

async function initializeApp() {
  const publicLocation = publicTokenFromLocation();
  if (publicLocation.invalid) {
    setPersistedDb(null);
    state.publicView = {
      active: true,
      token: '',
      error: 'This public list URL is invalid.'
    };
    state.db = createDefaultDb();
    resetUiStateForSession();
    resetHistory();
    renderAll();
    return;
  }

  const publicToken = publicLocation.token;
  if (publicToken) {
    try {
      const list = await readPublicList(publicToken);
      if (!list) {
        throw new Error('This public list is unavailable.');
      }

      setAuthState({
        status: 'unauthenticated',
        pending: false,
        error: '',
        user: null
      });
      activatePublicView(list, publicToken);
      return;
    } catch (error) {
      setPersistedDb(null);
      state.publicView = {
        active: true,
        token: publicToken,
        error: error?.status === 404 ? 'This public list does not exist.' : (error.message || 'Failed to load public list.')
      };
      state.db = createDefaultDb();
      resetUiStateForSession();
      resetHistory();
      renderAll();
      return;
    }
  }

  try {
    const session = await readAuthSession();
    if (session?.authenticated && session.user) {
      await initializeAuthenticatedSession(session.user);
      return;
    }
  } catch (error) {
    setAuthState({
      status: 'unauthenticated',
      pending: false,
      error: error.message || 'Failed to check session.',
      user: null
    });
    renderAll();
    return;
  }

  setAuthState({
    status: 'unauthenticated',
    pending: false,
    error: '',
    user: null
  });
  renderAll();
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

function currentListCanShare() {
  return Boolean(currentList()?.canShare);
}

function currentListCanEdit() {
  return Boolean(isAuthenticated() && !isPublicMode() && currentList()?.canEdit !== false);
}

function currentListCanLeave() {
  return Boolean(currentList()?.canLeave);
}

function currentPublicShareUrl() {
  const token = currentList()?.publicShareToken;
  if (!token) return '';
  return `${window.location.origin}/public/${encodeURIComponent(token)}`;
}

function currentSearchFilterQuery() {
  if (hasPublicViewError()) return '';
  return state.searchScope === 'current' ? normalizedSearchQuery() : '';
}

function computeSearchResults(limit = 30) {
  if (hasPublicViewError()) return [];
  const query = normalizedSearchQuery();
  if (!query) return [];

  const candidateLists = state.searchScope === 'all' ? state.db.lists : [currentList()];
  const results = [];

  for (const list of candidateLists) {
    for (let index = 0; index < list.rows.length; index += 1) {
      if (results.length >= limit) return results;
      const row = list.rows[index];
      if (!rowMatchesSearch(row, query)) continue;

      const path = ancestorIndexes(index, list.rows)
        .slice(0, -1)
        .map((pathIndex) => rowLabel(list.rows[pathIndex].text));

      results.push({
        listId: list.id,
        rowId: row.id,
        listName: normalizeListName(list.name),
        rowName: rowLabel(row.text),
        path
      });
    }
  }

  return results;
}

function ensureSearchResultIndex(results) {
  if (!results.length) {
    state.searchResultIndex = 0;
    return;
  }

  if (state.searchResultIndex < 0 || state.searchResultIndex >= results.length) {
    state.searchResultIndex = 0;
  }
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
  const query = currentSearchFilterQuery();

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
  renderAuthScreen();
  renderPastePrompt();
  renderExportModal();
  renderStatsModal();
  renderSettingsModal();
  renderDeleteListModal();
  renderShareListModal();
  renderHistoryModal();
  renderConflictModal();
}

function renderHeader() {
  const list = currentList();
  const publicMode = isPublicMode();
  const publicError = hasPublicViewError();
  const canEdit = currentListCanEdit();
  dom.titleInput.value = list.name;
  dom.searchInput.value = state.searchQuery;
  dom.searchScope.value = state.searchScope;
  dom.searchInput.placeholder = state.searchScope === 'all' ? 'Find across lists' : 'Find in list';
  if (publicMode) {
    state.settingsMenuOpen = false;
    state.titleMenuOpen = false;
  }
  dom.settingsBtn.setAttribute('aria-expanded', String(state.settingsMenuOpen));
  dom.settingsMenu.hidden = !state.settingsMenuOpen;
  dom.titleMenuBtn.setAttribute('aria-expanded', String(state.titleMenuOpen));
  dom.titleMenu.hidden = !state.titleMenuOpen;
  dom.menuAccountEmail.textContent = currentUserEmail();
  dom.menuLogoutBtn.hidden = !isAuthenticated();
  dom.historyListBtn.hidden = !isAuthenticated() || !currentList()?.isOwner;
  dom.shareListBtn.hidden = publicMode || !isAuthenticated() || (!currentListCanShare() && !currentListCanLeave());
  dom.shareListBtn.querySelector('.actions-item-label').textContent = currentListCanShare() ? 'Share list' : 'Shared list';
  dom.deleteListBtn.querySelector('.actions-item-label').textContent = currentListCanLeave() ? 'Leave shared list' : 'Delete list';
  dom.searchInput.disabled = publicError || (!isAuthenticated() && !publicMode);
  dom.searchScope.disabled = publicError || (!isAuthenticated() && !publicMode);
  dom.titleInput.disabled = publicError || !isAuthenticated() || !canEdit;
  dom.titleMenuBtn.disabled = !isAuthenticated();
  dom.titleMenuBtn.hidden = publicMode;
  dom.settingsBtn.disabled = !isAuthenticated();
  dom.settingsBtn.hidden = publicMode;
  dom.listSelect.disabled = !isAuthenticated();
  dom.listSelect.hidden = publicMode;
  dom.newListBtn.disabled = !isAuthenticated();
  dom.newListBtn.hidden = publicMode;
  renderUndoButton();
  renderListOptions();
  renderBreadcrumbs();
  renderSearchResults();
}

function renderUndoButton() {
  dom.undoBtn.hidden = isPublicMode();
  dom.undoBtn.disabled = isPublicMode() || !currentListCanEdit() || historyState.undoStack.length < 2;
}

function renderSearchResults() {
  if (hasPublicViewError()) {
    dom.searchResults.hidden = true;
    dom.searchResults.replaceChildren();
    return;
  }

  const results = computeSearchResults();
  ensureSearchResultIndex(results);

  dom.searchResults.hidden = !state.searchQuery.trim();
  if (!state.searchQuery.trim()) {
    dom.searchResults.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-result-empty';
    empty.textContent = 'No matching rows.';
    fragment.appendChild(empty);
    dom.searchResults.replaceChildren(fragment);
    return;
  }

  results.forEach((result, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `search-result${index === state.searchResultIndex ? ' search-result-active' : ''}`;
    button.dataset.listId = result.listId;
    button.dataset.rowId = result.rowId;

    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.rowName;

    const meta = document.createElement('div');
    meta.className = 'search-result-meta';
    meta.textContent = [result.listName, ...result.path].join(' / ');

    button.append(title, meta);
    fragment.appendChild(button);
  });

  dom.searchResults.replaceChildren(fragment);
}

function renderAuthScreen() {
  const open = !isPublicMode() && state.auth.status !== 'authenticated';
  dom.authScreen.hidden = !open;

  if (!open) return;

  const registerMode = state.auth.mode === 'register';
  dom.authTitle.textContent = registerMode ? 'Create your TabRows account' : 'Sign in to TabRows';
  dom.authBody.textContent = registerMode
    ? 'Use an email and password. The first account will inherit any existing local lists already in this database.'
    : 'Use an email and password so each person gets their own lists.';
  dom.authSubmitBtn.textContent = state.auth.pending
    ? (registerMode ? 'Creating account…' : 'Signing in…')
    : (registerMode ? 'Create account' : 'Sign in');
  dom.authSubmitBtn.disabled = state.auth.pending;
  dom.authEmail.disabled = state.auth.pending;
  dom.authPassword.disabled = state.auth.pending;
  dom.authPassword.autocomplete = registerMode ? 'new-password' : 'current-password';
  dom.authToggleBtn.disabled = state.auth.pending || state.auth.status === 'loading';
  dom.authToggleBtn.textContent = registerMode
    ? 'Already have an account? Sign in'
    : 'Need an account? Create one';
  dom.authStatusMessage.hidden = !state.auth.error && state.auth.status !== 'loading';
  dom.authStatusMessage.className = 'auth-status-message';

  if (state.auth.status === 'loading') {
    dom.authStatusMessage.hidden = false;
    dom.authStatusMessage.textContent = 'Checking your session…';
  } else {
    dom.authStatusMessage.textContent = state.auth.error;
    if (state.auth.error) dom.authStatusMessage.classList.add('auth-status-error');
  }

  requestAnimationFrame(() => {
    if (state.auth.status === 'unauthenticated' && !dom.authScreen.hidden && !state.auth.pending && document.activeElement === document.body) {
      dom.authEmail.focus();
    }
  });
}

function previewPasteText(text) {
  const lines = normalizeText(text).trimEnd().split('\n');
  const preview = lines.slice(0, 6).join('\n');
  return lines.length > 6 ? `${preview}\n…` : preview;
}

function renderModalBodyState() {
  const open = Boolean(state.pastePrompt)
    || state.exportModal.open
    || state.statsModal.open
    || state.settingsModalOpen
    || state.deleteListModalOpen
    || state.shareListModal.open
    || state.historyModal.open
    || state.conflictModal.open;
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

function renderExportModal() {
  const modalState = state.exportModal;
  dom.exportModal.hidden = !modalState.open;
  dom.exportModal.setAttribute('aria-hidden', String(!modalState.open));
  renderModalBodyState();

  if (!modalState.open) return;

  dom.exportModalPreview.textContent = modalState.markdown;
  dom.exportModalStatus.hidden = !modalState.status;
  dom.exportModalStatus.textContent = modalState.status;
  dom.exportModalStatus.className = 'settings-status export-status';
  if (modalState.statusKind === 'success') dom.exportModalStatus.classList.add('settings-status-success');
  if (modalState.statusKind === 'error') dom.exportModalStatus.classList.add('settings-status-error');

  requestAnimationFrame(() => {
    if (state.exportModal.open) dom.exportCopyBtn.focus();
  });
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  if (!isAuthenticated()) return;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.statsModal.open = true;
  state.statsModal.loading = true;
  state.statsModal.error = '';
  state.statsModal.data = null;
  renderHeader();
  renderStatsModal();
  const requestContext = captureAsyncUiContext({ modal: 'stats' });

  try {
    const data = await readStorageStats();
    if (!isAsyncUiContextActive(requestContext)) return;
    state.statsModal.data = data;
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.statsModal.error = error.message || 'Failed to load database stats.';
  } finally {
    if (!isAsyncUiContextActive(requestContext)) return;
    state.statsModal.loading = false;
    renderStatsModal();
  }
}

function closeStatsModal() {
  state.statsModal.open = false;
  renderStatsModal();
}

function openExportModal(rowId) {
  const row = rowById(rowId);
  if (!row) return;

  state.menuRow = null;
  state.exportModal = {
    open: true,
    markdown: subtreeToMarkdown(rowId),
    filename: `${slugify(rowLabel(row.text || 'row'))}.md`,
    status: '',
    statusKind: ''
  };
  renderRows();
  renderExportModal();
}

function closeExportModal() {
  state.exportModal = {
    open: false,
    markdown: '',
    filename: 'row.md',
    status: '',
    statusKind: ''
  };
  renderExportModal();
}

function setExportModalStatus(kind, message) {
  state.exportModal.status = message;
  state.exportModal.statusKind = kind;
  renderExportModal();
}

function renderSettingsDataStatus() {
  const status = state.settingsDataStatus;
  dom.exportBackupBtn.disabled = status.busy;
  dom.importBackupBtn.disabled = status.busy;
  dom.repairDbBtn.disabled = status.busy;
  dom.settingsDataStatus.hidden = !status.message;
  dom.settingsDataStatus.textContent = status.message;
  dom.settingsDataStatus.className = 'settings-status';
  if (status.kind === 'success') dom.settingsDataStatus.classList.add('settings-status-success');
  if (status.kind === 'error') dom.settingsDataStatus.classList.add('settings-status-error');
}

function renderSettingsModal() {
  dom.settingsModal.hidden = !state.settingsModalOpen;
  dom.settingsModal.setAttribute('aria-hidden', String(!state.settingsModalOpen));
  renderSettingsDataStatus();
  renderModalBodyState();
}

function openSettingsModal() {
  if (!isAuthenticated()) return;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.settingsModalOpen = true;
  setSettingsDataStatus('', '');
  renderHeader();
  renderSettingsModal();
}

function closeSettingsModal() {
  state.settingsModalOpen = false;
  renderSettingsModal();
}

function setSettingsDataStatus(kind, message, options = {}) {
  const { busy = false } = options;
  state.settingsDataStatus = { kind, message, busy };
  renderSettingsDataStatus();
}

function renderDeleteListModal() {
  dom.deleteListModal.hidden = !state.deleteListModalOpen;
  dom.deleteListModal.setAttribute('aria-hidden', String(!state.deleteListModalOpen));
  dom.deleteListName.textContent = normalizeListName(currentList().name);
  dom.deleteListBody.textContent = currentListCanLeave()
    ? 'This removes the shared list from your account.'
    : 'This removes the current list and all of its rows.';
  dom.deleteListConfirmBtn.textContent = currentListCanLeave() ? 'Leave list' : 'Delete list';
  renderModalBodyState();
}

function renderShareListModal() {
  const modalState = state.shareListModal;
  const list = currentList();

  dom.shareListModal.hidden = !modalState.open;
  dom.shareListModal.setAttribute('aria-hidden', String(!modalState.open));
  renderModalBodyState();

  if (!modalState.open || !list) return;

  dom.shareListTitle.textContent = normalizeListName(list.name);
  dom.shareListOwner.textContent = list.ownerEmail || currentUserEmail();
  dom.shareListHint.textContent = list.isOwner
    ? 'Share as viewer for read-only access, or editor for collaboration.'
    : 'This is a shared list. You can leave it from here.';
  dom.shareListPublicSection.hidden = !list.isOwner;
  dom.shareListPublicHint.textContent = list.publicShareToken
    ? 'Anyone with this link can view the list without signing in.'
    : 'Create a read-only public link for this list.';
  dom.shareListPublicLink.textContent = currentPublicShareUrl() || 'Public link is disabled.';
  dom.shareListPublicEnableBtn.hidden = Boolean(list.publicShareToken);
  dom.shareListPublicCopyBtn.hidden = !list.publicShareToken;
  dom.shareListPublicDisableBtn.hidden = !list.publicShareToken;
  dom.shareListPublicEnableBtn.disabled = modalState.busy;
  dom.shareListPublicCopyBtn.disabled = modalState.busy || !list.publicShareToken;
  dom.shareListPublicDisableBtn.disabled = modalState.busy;
  dom.shareListStatus.hidden = !modalState.error && !modalState.success;
  dom.shareListStatus.className = 'settings-status';

  if (modalState.error) {
    dom.shareListStatus.hidden = false;
    dom.shareListStatus.classList.add('settings-status-error');
    dom.shareListStatus.textContent = modalState.error;
  } else if (modalState.success) {
    dom.shareListStatus.hidden = false;
    dom.shareListStatus.classList.add('settings-status-success');
    dom.shareListStatus.textContent = modalState.success;
  }

  const collaboratorsFragment = document.createDocumentFragment();
  if (list.isOwner) {
    if (!list.collaborators.length) {
      const empty = document.createElement('div');
      empty.className = 'share-empty';
      empty.textContent = 'No collaborators yet.';
      collaboratorsFragment.appendChild(empty);
    } else {
      list.collaborators.forEach((collaborator) => {
        const row = document.createElement('div');
        row.className = 'share-collaborator';
        const email = document.createElement('span');
        email.className = 'share-collaborator-email';
        email.textContent = collaborator.email;
        const role = document.createElement('select');
        role.className = 'auth-input share-role-select';
        role.dataset.roleUserId = collaborator.userId;
        role.disabled = modalState.busy;
        role.innerHTML = `
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        `;
        role.value = collaborator.role === 'viewer' ? 'viewer' : 'editor';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'modal-btn modal-btn-secondary share-remove-btn';
        button.dataset.userId = collaborator.userId;
        button.textContent = 'Remove';
        button.disabled = modalState.busy;
        row.append(email, role, button);
        collaboratorsFragment.appendChild(row);
      });
    }
  }

  dom.shareListCollaborators.replaceChildren(collaboratorsFragment);
  dom.shareListForm.hidden = !list.isOwner;
  dom.shareListEmail.disabled = modalState.busy || !list.isOwner;
  dom.shareListRole.disabled = modalState.busy || !list.isOwner;
  dom.shareListSubmitBtn.disabled = modalState.busy || !list.isOwner;
  dom.shareListSubmitBtn.textContent = modalState.busy && list.isOwner ? 'Sharing…' : 'Share';
  dom.shareListLeaveBtn.hidden = !currentListCanLeave();
  dom.shareListLeaveBtn.disabled = modalState.busy;
}

function historyEntryTitle(revision) {
  if (revision.kind === 'checkpoint') {
    return revision.label || 'Checkpoint';
  }
  return revision.label || 'Auto snapshot';
}

function historyDiffSummary(diff) {
  if (!diff) return 'Restore preview unavailable.';
  const parts = [];
  if (diff.nameChanged) parts.push('title changes');
  if (diff.added) parts.push(`${diff.added} row${diff.added === 1 ? '' : 's'} restored`);
  if (diff.removed) parts.push(`${diff.removed} row${diff.removed === 1 ? '' : 's'} removed`);
  if (diff.changed) parts.push(`${diff.changed} row${diff.changed === 1 ? '' : 's'} changed`);
  if (diff.moved) parts.push(`${diff.moved} row${diff.moved === 1 ? '' : 's'} moved`);
  return parts.length ? `Restore preview: ${parts.join(', ')}.` : 'Restore preview: no content changes.';
}

function renderHistoryModal() {
  const modalState = state.historyModal;
  const list = currentList();

  dom.historyModal.hidden = !modalState.open;
  dom.historyModal.setAttribute('aria-hidden', String(!modalState.open));
  renderModalBodyState();

  if (!modalState.open || !list) return;

  dom.historyListTitle.textContent = normalizeListName(list.name);
  dom.historySaveBtn.disabled = modalState.loading || modalState.saving;
  dom.historySaveBtn.textContent = modalState.saving && !modalState.restoringId ? 'Saving…' : 'Save checkpoint';
  dom.historyLabel.disabled = modalState.loading || modalState.saving;
  dom.historyStatus.hidden = !modalState.loading && !modalState.error && !modalState.success;
  dom.historyStatus.className = 'settings-status';

  if (modalState.loading) {
    dom.historyStatus.hidden = false;
    dom.historyStatus.textContent = 'Loading history…';
  } else if (modalState.error) {
    dom.historyStatus.hidden = false;
    dom.historyStatus.classList.add('settings-status-error');
    dom.historyStatus.textContent = modalState.error;
  } else if (modalState.success) {
    dom.historyStatus.hidden = false;
    dom.historyStatus.classList.add('settings-status-success');
    dom.historyStatus.textContent = modalState.success;
  }

  const fragment = document.createDocumentFragment();
  if (!modalState.revisions.length && !modalState.loading) {
    const empty = document.createElement('div');
    empty.className = 'share-empty';
    empty.textContent = 'No saved history yet.';
    fragment.appendChild(empty);
  }

  modalState.revisions.forEach((revision) => {
    const entry = document.createElement('div');
    entry.className = 'history-entry';

    const head = document.createElement('div');
    head.className = 'history-entry-head';

    const metaWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'history-entry-title';
    title.textContent = historyEntryTitle(revision);
    const meta = document.createElement('div');
    meta.className = 'history-entry-meta';
    meta.textContent = `${formatTimestamp(revision.createdAt)} · ${revision.rowCount} row${revision.rowCount === 1 ? '' : 's'}`;
    metaWrap.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'modal-actions history-entry-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'modal-btn modal-btn-secondary';
    restore.dataset.revisionId = revision.id;
    restore.textContent = modalState.restoringId === revision.id ? 'Restoring…' : 'Restore';
    restore.disabled = modalState.loading || modalState.saving;
    actions.appendChild(restore);

    head.append(metaWrap, actions);
    entry.appendChild(head);
    const diff = document.createElement('div');
    diff.className = 'history-entry-diff';
    const summary = document.createElement('div');
    summary.textContent = historyDiffSummary(revision.diff);
    diff.appendChild(summary);
    if (revision.diff?.preview?.length) {
      const preview = document.createElement('ul');
      preview.className = 'history-entry-preview';
      revision.diff.preview.forEach((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        preview.appendChild(item);
      });
      diff.appendChild(preview);
    }
    entry.appendChild(diff);
    fragment.appendChild(entry);
  });

  dom.historyEntries.replaceChildren(fragment);
}

function conflictPreviewText(row, fallback = '') {
  if (!row) return fallback;
  const text = normalizeText(row.text);
  return text || '(empty row)';
}

function renderConflictModal() {
  const modalState = state.conflictModal;
  const conflict = modalState.conflict;

  dom.conflictModal.hidden = !modalState.open;
  dom.conflictModal.setAttribute('aria-hidden', String(!modalState.open));
  renderModalBodyState();

  if (!modalState.open || !conflict) return;

  const isDeleteConflict = !conflict.localRow;
  dom.conflictTitle.textContent = isDeleteConflict
    ? 'Your delete conflicts with a newer server edit.'
    : 'This row changed remotely while you were editing it.';
  dom.conflictLocalText.textContent = conflictPreviewText(conflict.localRow, '(deleted locally)');
  dom.conflictServerText.textContent = conflictPreviewText(conflict.serverRow, '(missing on server)');
  dom.conflictStatus.hidden = !modalState.error;
  dom.conflictStatus.className = 'settings-status settings-status-error';
  dom.conflictStatus.textContent = modalState.error;
  dom.conflictKeepRemoteBtn.disabled = modalState.busy;
  dom.conflictCopyLocalBtn.hidden = isDeleteConflict;
  dom.conflictCopyLocalBtn.disabled = modalState.busy;
  dom.conflictOverwriteBtn.disabled = modalState.busy;
  dom.conflictOverwriteBtn.textContent = isDeleteConflict ? 'Apply my delete' : 'Overwrite remote';

  requestAnimationFrame(() => {
    if (state.conflictModal.open) dom.conflictKeepRemoteBtn.focus();
  });
}

function openDeleteListModal() {
  if (!isAuthenticated()) return;
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

function openShareListModal() {
  if (!isAuthenticated() || !currentListCanShare() && !currentListCanLeave()) return;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.shareListModal = { open: true, busy: false, error: '', success: '' };
  dom.shareListEmail.value = '';
  dom.shareListRole.value = 'editor';
  renderHeader();
  renderShareListModal();
}

function closeShareListModal() {
  state.shareListModal.open = false;
  state.shareListModal.busy = false;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
}

async function openHistoryModal() {
  const list = currentList();
  if (!isAuthenticated() || !list?.isOwner) return;

  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.historyModal = {
    open: true,
    loading: true,
    saving: false,
    restoringId: '',
    error: '',
    success: '',
    revisions: []
  };
  dom.historyLabel.value = '';
  renderHeader();
  renderHistoryModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'history' });

  try {
    const revisions = await readListRevisions(list.id);
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.revisions = revisions;
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.error = error.message || 'Could not load history.';
  } finally {
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.loading = false;
    renderHistoryModal();
  }
}

function closeHistoryModal() {
  state.historyModal = {
    open: false,
    loading: false,
    saving: false,
    restoringId: '',
    error: '',
    success: '',
    revisions: []
  };
  renderHistoryModal();
}

function closeConflictModal() {
  state.conflictModal = {
    open: false,
    busy: false,
    error: '',
    conflict: null
  };
  renderConflictModal();
}

function openConflictModal(error, context = {}) {
  const details = error?.details || {};
  const snapshotDb = context.snapshot ? normalizeDbObject(cloneDb(context.snapshot)) : null;
  const baselineDb = context.baseline ? normalizeDbObject(cloneDb(context.baseline)) : null;
  const conflictOperation = context.changeSet?.operations?.find((operation) => {
    if (details.listId && operation.listId !== details.listId) return false;
    if (!details.rowId) return operation.type === 'row-update' || operation.type === 'row-delete';
    return operation.row?.id === details.rowId || operation.rowId === details.rowId;
  }) || null;
  const listId = details.listId || conflictOperation?.listId || '';
  const rowId = details.rowId || conflictOperation?.row?.id || conflictOperation?.rowId || '';
  const localList = snapshotDb?.lists.find((list) => list.id === listId) || null;
  const localRow = conflictOperation?.type === 'row-delete'
    ? null
    : (conflictOperation?.row
      ? cloneDb(conflictOperation.row)
      : (localList?.rows.find((row) => row.id === rowId) || null));
  const serverList = state.db.lists.find((list) => list.id === listId)
    || baselineDb?.lists.find((list) => list.id === listId)
    || null;
  const serverRow = details.serverRow
    ? cloneDb(details.serverRow)
    : (serverList?.rows.find((row) => row.id === rowId) || null);

  state.conflictModal = {
    open: true,
    busy: false,
    error: '',
    conflict: {
      ...details,
      listId,
      rowId,
      serverRow,
      localRow: localRow ? cloneDb(localRow) : null,
      localCurrentId: snapshotDb?.currentId || state.db.currentId,
      localDb: snapshotDb,
      baseDb: baselineDb
    }
  };
  renderConflictModal();
}

function findListInDb(db, listId) {
  return db.lists.find((list) => list.id === listId) || null;
}

function moveOwnedListToPosition(db, listId, position) {
  const target = findListInDb(db, listId);
  if (!target || target.isOwner === false) return;

  const owned = db.lists.filter((list) => list.isOwner !== false && list.id !== listId);
  const shared = db.lists.filter((list) => list.isOwner === false);
  const insertAt = Math.max(0, Math.min(position, owned.length));
  owned.splice(insertAt, 0, target);
  db.lists = [...owned, ...shared];
}

function upsertRowAtPosition(list, row, position) {
  if (!list) return;
  const existingIndex = list.rows.findIndex((entry) => entry.id === row.id);
  if (existingIndex !== -1) list.rows.splice(existingIndex, 1);
  const insertAt = Math.max(0, Math.min(position, list.rows.length));
  list.rows.splice(insertAt, 0, cloneDb(row));
}

function rebaseLocalChangesOntoRemote(remoteDb, conflict, strategy) {
  const nextDb = normalizeDbObject(cloneDb(remoteDb));
  const baseDb = conflict.baseDb ? normalizeDbObject(cloneDb(conflict.baseDb)) : (persistedDb ? normalizeDbObject(cloneDb(persistedDb)) : remoteDb);
  const localDb = conflict.localDb ? normalizeDbObject(cloneDb(conflict.localDb)) : state.db;
  const localChanges = buildDbOperations(baseDb, localDb);
  const operations = localChanges.operations;

  operations.forEach((operation) => {
    if (operation.type === 'list-create') {
      const localList = findListInDb(localDb, operation.list.id);
      if (localList && !findListInDb(nextDb, operation.list.id)) {
        nextDb.lists.push(cloneDb(localList));
        moveOwnedListToPosition(nextDb, operation.list.id, operation.list.position);
      }
      return;
    }

    if (operation.type === 'list-update') {
      const list = findListInDb(nextDb, operation.listId);
      if (!list) return;
      list.name = operation.name;
      if (Number.isInteger(operation.position)) {
        moveOwnedListToPosition(nextDb, operation.listId, operation.position);
      }
      return;
    }

    if (operation.type === 'list-delete') {
      nextDb.lists = nextDb.lists.filter((list) => list.id !== operation.listId);
      if (nextDb.currentId === operation.listId && nextDb.lists.length) {
        nextDb.currentId = nextDb.lists[0].id;
      }
      return;
    }

    const list = findListInDb(nextDb, operation.listId);
    const localList = findListInDb(localDb, operation.listId);
    if (!list || !localList) return;
    const isConflictRow = operation.listId === conflict.listId
      && (operation.row?.id === conflict.rowId || operation.rowId === conflict.rowId);

    if (operation.type === 'row-create') {
      const localRow = localList.rows.find((row) => row.id === operation.row.id) || operation.row;
      upsertRowAtPosition(list, localRow, operation.position);
      return;
    }

    if (operation.type === 'row-delete') {
      if (isConflictRow && strategy !== 'overwrite') return;
      list.rows = list.rows.filter((row) => row.id !== operation.rowId);
      return;
    }

    if (operation.type === 'row-update') {
      if (isConflictRow) {
        if (strategy === 'keep-remote') return;
        if (strategy === 'copy-local') {
          const localRow = localList.rows.find((row) => row.id === conflict.rowId);
          if (!localRow) return;
          const remoteIndex = list.rows.findIndex((row) => row.id === conflict.rowId);
          const insertAt = remoteIndex === -1 ? list.rows.length : subtreeEnd(remoteIndex, list.rows);
          const copiedRow = { ...cloneDb(localRow), id: createId(), revision: 0 };
          list.rows.splice(insertAt, 0, copiedRow);
          return;
        }
      }

      const localRow = localList.rows.find((row) => row.id === operation.row.id) || operation.row;
      upsertRowAtPosition(list, localRow, operation.position);
    }
  });

  if (nextDb.lists.some((list) => list.id === localChanges.currentId)) {
    nextDb.currentId = localChanges.currentId;
  } else if (!nextDb.lists.some((list) => list.id === nextDb.currentId) && nextDb.lists.length) {
    nextDb.currentId = nextDb.lists[0].id;
  }

  return nextDb;
}

async function resolveConflict(strategy) {
  const conflict = state.conflictModal.conflict;
  if (!conflict || state.conflictModal.busy) return;

  state.conflictModal.busy = true;
  state.conflictModal.error = '';
  renderConflictModal();

  try {
    const remoteDb = normalizeDbObject(await readStoredDb());
    const rebasedDb = rebaseLocalChangesOntoRemote(remoteDb, conflict, strategy);
    setPersistedDb(remoteDb);
    replaceCurrentDb(rebasedDb, { resetHistoryState: false, syncPersistedSnapshot: false });
    await saveDb({ recordHistory: false, throwOnError: true });
    closeConflictModal();
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (error?.code === 'ROW_CONFLICT') {
      openConflictModal(error, {
        baseline: conflict.baseDb,
        snapshot: conflict.localDb,
        changeSet: buildDbOperations(conflict.baseDb || remoteDb, conflict.localDb || state.db)
      });
      return;
    }
    state.conflictModal.busy = false;
    state.conflictModal.error = error.message || 'Could not resolve this conflict.';
    renderConflictModal();
  }
}

function renderListOptions() {
  if (!isAuthenticated() || isPublicMode()) {
    dom.listSelect.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();

  state.db.lists.forEach((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = `${normalizeListName(list.name)}${list.isOwner ? '' : ' · shared'}`;
    option.selected = list.id === state.db.currentId;
    fragment.appendChild(option);
  });

  dom.listSelect.replaceChildren(fragment);
}

function renderBreadcrumbs() {
  if (!isAuthenticated() && !isPublicMode()) {
    dom.breadcrumbs.replaceChildren();
    return;
  }

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
  if (!isAuthenticated() && !isPublicMode()) {
    dom.list.replaceChildren();
    return;
  }

  if (isPublicMode() && state.publicView.error) {
    dom.list.replaceChildren(createStatusState(state.publicView.error));
    return;
  }

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
  if (normalizedSearchQuery()) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = 'No matching rows.';
    return el;
  }

  if (!isAuthenticated() || !currentListCanEdit()) {
    return createStatusState('No rows.');
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'empty-state empty-state-action';
  button.textContent = 'No rows yet. Click to create one.';
  button.addEventListener('click', createFirstRow);
  return button;
}

function createStatusState(message) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.textContent = message;
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

  if (state.editing !== row.id && currentListCanEdit()) {
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
    menu.appendChild(createMenuItem('Delete', 'delete-row', { danger: true }));
    wrap.appendChild(menu);
  }

  return wrap;
}

function createMenuItem(label, action, options = {}) {
  const { danger = false } = options;
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'actions-item';
  if (danger) item.classList.add('actions-item-danger');
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
    case 'delete-row':
      return `
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="M6.5 6.5v8M10 6.5v8M13.5 6.5v8M5 4.75h10M7.5 4.75V3.5h5v1.25M6 16.25h8a1 1 0 0 0 1-1V4.75H5v10.5a1 1 0 0 0 1 1Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"></path>
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

function toggleAuthMode() {
  setAuthState({
    mode: state.auth.mode === 'login' ? 'register' : 'login',
    error: ''
  });
  renderAuthScreen();
}

async function submitAuthForm(event) {
  event.preventDefault();

  const email = dom.authEmail.value.trim();
  const password = dom.authPassword.value;
  setAuthState({ pending: true, error: '' });
  renderAuthScreen();

  try {
    const payload = state.auth.mode === 'register'
      ? await registerUser(email, password)
      : await loginUser(email, password);
    dom.authPassword.value = '';
    await initializeAuthenticatedSession(payload.user);
  } catch (error) {
    setAuthState({
      status: 'unauthenticated',
      pending: false,
      error: error.message || 'Authentication failed.',
      user: null
    });
    renderAuthScreen();
  }
}

async function handleLogout() {
  authSessionVersion += 1;
  resetPersistQueue();
  try {
    await logoutUser();
  } catch (error) {
    console.warn('Logout failed.', error);
  }

  setAuthState({
    status: 'unauthenticated',
    pending: false,
    mode: 'login',
    error: '',
    user: null
  });
  dom.authPassword.value = '';
  state.publicView = { active: false, token: '', error: '' };
  state.db = createDefaultDb();
  resetUiStateForSession();
  resetHistory();
  renderAll();
}

// UI actions

function updateListName(value, options = {}) {
  if (!currentListCanEdit()) {
    renderHeader();
    return;
  }
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
  if (!currentListCanEdit()) return;
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
  if (!currentListCanEdit()) {
    clearEditState();
    renderRows();
    return;
  }

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
  if (!currentListCanEdit()) return;
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

function createFirstRow() {
  if (!currentListCanEdit()) return;
  if (rows().length) return;

  const row = createRow('', 0);
  currentList().rows = [row];
  state.menuRow = null;
  setSingleSelection(row.id, { render: false });
  saveDb();
  beginEdit(row.id);
}

function deleteRows(ids) {
  if (!currentListCanEdit()) return;
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
  if (!currentListCanEdit()) return;
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
  if (!currentListCanEdit()) return;
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
  if (!isAuthenticated() && !isPublicMode()) return;
  if (hasPublicViewError()) return;
  const allRows = rows();
  const index = rowIndex(rowId, allRows);
  if (index === -1 || !hasChildren(index, allRows)) return;
  const canPersist = currentListCanEdit();

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
  if (canPersist) saveDb({ recordHistory: false });
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
  if (!currentListCanEdit()) return;
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
  if (!currentListCanEdit()) return;
  if (!state.selected.size) return;

  rows().forEach((row) => {
    if (state.selected.has(row.id)) row.color = color;
  });

  saveDb();
  renderRows();
}

function activateSearchResult(listId, rowId) {
  if (!rowId) return;

  if (state.db.currentId !== listId) {
    switchList(listId);
  }

  state.viewRoot = null;
  state.menuRow = null;
  const allRows = rows();
  const index = rowIndex(rowId, allRows);
  if (index === -1) return;

  const expanded = expandAncestorChain(index, allRows);
  setSingleSelection(rowId, { render: false });
  if (expanded) {
    saveDb({ recordHistory: false });
  }
  renderAll();
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
    isOwner: true,
    ownerUserId: currentUserId(),
    ownerEmail: currentUserEmail(),
    accessRole: 'owner',
    canEdit: true,
    canShare: true,
    canLeave: false,
    publicShareToken: '',
    collaborators: [],
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

async function deleteCurrentList() {
  if (currentListCanLeave()) {
    await leaveCurrentSharedList();
    return;
  }

  if (state.db.lists.length === 1) {
    const listId = createId();
    state.db = {
      currentId: listId,
      lists: [
        {
          id: listId,
          name: DEFAULT_LIST_NAME,
          isOwner: true,
          ownerUserId: currentUserId(),
          ownerEmail: currentUserEmail(),
          accessRole: 'owner',
          canEdit: true,
          canShare: true,
          canLeave: false,
          publicShareToken: '',
          collaborators: [],
          rows: [createRow('', 0)]
        }
      ]
    };
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

function escapeMarkdownContinuationLine(line) {
  return String(line || '').replace(
    /^(\s*)(?=(?:[-*+]|\d+[.)])\s+)/,
    '$1\\'
  );
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
      lines.push(`${childIndent}${escapeMarkdownContinuationLine(line)}`);
    });
  });

  return lines.join('\n');
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

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();

  const copied = document.execCommand('copy');
  input.remove();

  if (!copied) {
    throw new Error('Clipboard copy is not available here.');
  }
}

async function copyExportMarkdown() {
  try {
    await copyTextToClipboard(state.exportModal.markdown);
    setExportModalStatus('success', 'Markdown copied to clipboard.');
  } catch (error) {
    setExportModalStatus('error', error.message || 'Failed to copy markdown.');
  }
}

function downloadExportMarkdown() {
  downloadTextFile(state.exportModal.filename, state.exportModal.markdown, 'text/markdown;charset=utf-8');
  setExportModalStatus('success', 'Markdown downloaded.');
}

function backupFilename() {
  return `tabrows-backup-${new Date().toISOString().replace(/[:]/g, '-')}.json`;
}

function replaceCurrentDb(nextDb, options = {}) {
  const { resetHistoryState = true, syncPersistedSnapshot = true } = options;
  state.db = normalizeDbObject(nextDb);
  if (syncPersistedSnapshot) {
    setPersistedDb(state.db);
  }
  if (isAuthenticated() && !isPublicMode()) {
    writeBootstrapDb(state.db, currentUserId());
  }
  clearEditState();
  state.menuRow = null;
  state.settingsMenuOpen = false;
  state.titleMenuOpen = false;
  state.viewRoot = null;
  state.deleteListModalOpen = false;
  state.shareListModal = { open: false, busy: false, error: '', success: '' };
  state.historyModal = { open: false, loading: false, saving: false, restoringId: '', error: '', success: '', revisions: [] };
  state.conflictModal = { open: false, busy: false, error: '', conflict: null };
  ensureSelection();
  if (resetHistoryState) resetHistory();
}

function applyImportedDb(nextDb) {
  replaceCurrentDb(nextDb, { resetHistoryState: false, syncPersistedSnapshot: false });
  const persist = saveDb({ throwOnError: true });
  renderAll();
  return persist;
}

function exportBackup() {
  try {
    const contents = serializeDbBackup(state.db);
    downloadTextFile(backupFilename(), contents, 'application/json;charset=utf-8');
    setSettingsDataStatus('success', 'Backup downloaded.');
  } catch (error) {
    setSettingsDataStatus('error', error.message || 'Backup export failed.');
  }
}

async function importBackupFile(file) {
  if (!file) return;

  setSettingsDataStatus('', `Importing ${file.name}…`, { busy: true });
  const previousDb = cloneDb(state.db);

  try {
    const text = await file.text();
    const importedDb = parseDbBackupText(text);
    await applyImportedDb(importedDb);
    setSettingsDataStatus('success', `Imported ${importedDb.lists.length} list${importedDb.lists.length === 1 ? '' : 's'} from ${file.name}.`);
  } catch (error) {
    replaceCurrentDb(previousDb, { resetHistoryState: false });
    renderAll();
    resetHistory();
    setSettingsDataStatus('error', error.message || 'Backup import failed.');
  }
}

async function shareCurrentListWithEmail(event) {
  event.preventDefault();
  const list = currentList();
  if (!list?.isOwner) return;

  const email = dom.shareListEmail.value.trim();
  state.shareListModal.busy = true;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'share' });

  try {
    const role = dom.shareListRole.value === 'viewer' ? 'viewer' : 'editor';
    const payload = await shareListWithEmail(list.id, email, role);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    state.shareListModal.open = true;
    state.shareListModal.success = `Shared with ${email} as ${role}.`;
    dom.shareListEmail.value = '';
    dom.shareListRole.value = 'editor';
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.shareListModal.busy = false;
    state.shareListModal.error = error.message || 'Share failed.';
    renderShareListModal();
  }
}

async function removeCollaborator(userId) {
  const list = currentList();
  if (!list?.isOwner || !userId) return;

  state.shareListModal.busy = true;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'share' });

  try {
    const payload = await revokeListShare(list.id, userId);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    state.shareListModal.open = true;
    state.shareListModal.success = 'Collaborator removed.';
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.shareListModal.busy = false;
    state.shareListModal.error = error.message || 'Could not remove collaborator.';
    renderShareListModal();
  }
}

async function updateCollaboratorRole(userId, role) {
  const list = currentList();
  if (!list?.isOwner || !userId) return;

  state.shareListModal.busy = true;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'share' });

  try {
    const normalizedRole = role === 'viewer' ? 'viewer' : 'editor';
    const payload = await updateListShareRole(list.id, userId, normalizedRole);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    state.shareListModal.open = true;
    state.shareListModal.success = `Collaborator changed to ${normalizedRole}.`;
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.shareListModal.busy = false;
    state.shareListModal.error = error.message || 'Could not update collaborator.';
    renderShareListModal();
  }
}

async function enableCurrentListPublicShare() {
  const list = currentList();
  if (!list?.isOwner) return;

  state.shareListModal.busy = true;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'share' });

  try {
    const payload = await enablePublicListShare(list.id);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    state.shareListModal.open = true;
    state.shareListModal.success = 'Public link enabled.';
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.shareListModal.busy = false;
    state.shareListModal.error = error.message || 'Could not enable public link.';
    renderShareListModal();
  }
}

async function disableCurrentListPublicShare() {
  const list = currentList();
  if (!list?.isOwner || !list.publicShareToken) return;

  state.shareListModal.busy = true;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'share' });

  try {
    const payload = await disablePublicListShare(list.id);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    state.shareListModal.open = true;
    state.shareListModal.success = 'Public link disabled.';
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.shareListModal.busy = false;
    state.shareListModal.error = error.message || 'Could not disable public link.';
    renderShareListModal();
  }
}

async function copyCurrentListPublicShare() {
  const url = currentPublicShareUrl();
  if (!url) return;

  try {
    await copyTextToClipboard(url);
    state.shareListModal.error = '';
    state.shareListModal.success = 'Public link copied.';
    renderShareListModal();
  } catch (error) {
    state.shareListModal.success = '';
    state.shareListModal.error = error.message || 'Could not copy public link.';
    renderShareListModal();
  }
}

async function saveHistoryCheckpoint() {
  const list = currentList();
  if (!list?.isOwner) return;

  state.historyModal.saving = true;
  state.historyModal.restoringId = '';
  state.historyModal.error = '';
  state.historyModal.success = '';
  renderHistoryModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'history' });

  try {
    const revisions = await createListCheckpoint(list.id, dom.historyLabel.value.trim());
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.revisions = revisions;
    dom.historyLabel.value = '';
    state.historyModal.success = 'Checkpoint saved.';
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.error = error.message || 'Could not save checkpoint.';
  } finally {
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.saving = false;
    renderHistoryModal();
  }
}

async function restoreHistoryRevisionById(revisionId) {
  const list = currentList();
  if (!list?.isOwner || !revisionId) return;
  const revision = state.historyModal.revisions.find((entry) => entry.id === revisionId);
  const preview = revision ? historyDiffSummary(revision.diff) : 'The current list contents will be replaced.';
  if (!window.confirm(`Restore this revision?\n\n${preview}`)) return;

  state.historyModal.saving = true;
  state.historyModal.restoringId = revisionId;
  state.historyModal.error = '';
  state.historyModal.success = '';
  renderHistoryModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'history' });

  try {
    const payload = await restoreListRevision(list.id, revisionId);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    closeHistoryModal();
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.historyModal.saving = false;
    state.historyModal.restoringId = '';
    state.historyModal.error = error.message || 'Could not restore revision.';
    renderHistoryModal();
  }
}

async function leaveCurrentSharedList() {
  const list = currentList();
  if (!list?.canLeave) return;

  state.shareListModal.busy = true;
  state.shareListModal.error = '';
  state.shareListModal.success = '';
  renderShareListModal();
  const requestContext = captureAsyncUiContext({ listId: list.id, modal: 'share' });

  try {
    const payload = await leaveSharedList(list.id);
    if (!isAsyncUiContextActive(requestContext)) return;
    replaceCurrentDb(payload.db);
    renderAll();
  } catch (error) {
    if (error?.status === 401) {
      handleAuthLoss();
      return;
    }
    if (!isAsyncUiContextActive(requestContext)) return;
    state.shareListModal.busy = false;
    state.shareListModal.error = error.message || 'Could not leave shared list.';
    renderShareListModal();
  }
}

async function repairStructure() {
  setSettingsDataStatus('', 'Checking and rewriting the current snapshot…', { busy: true });
  const previousDb = cloneDb(state.db);

  try {
    const before = JSON.stringify(state.db);
    state.db = normalizeDbObject(cloneDb(state.db));
    ensureSelection();
    await saveDb({ throwOnError: true });
    renderAll();
    const changed = before !== JSON.stringify(state.db);
    setSettingsDataStatus('success', changed ? 'Structure repaired and saved.' : 'Structure checked and saved.');
  } catch (error) {
    replaceCurrentDb(previousDb, { resetHistoryState: false });
    renderAll();
    resetHistory();
    setSettingsDataStatus('error', error.message || 'Repair failed.');
  }
}

function pasteRowsFromText(editingId, text) {
  if (!currentListCanEdit()) return;
  const allRows = rows();
  const index = rowIndex(editingId, allRows);
  if (index === -1) return;

  const firstNonEmptyLine = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .find((line) => line.trim()) || '';
  const firstOutlineMatch = matchOutlineLine(firstNonEmptyLine);
  const firstPastedLabel = comparableRowLabel(firstOutlineMatch ? firstOutlineMatch[3] : firstNonEmptyLine.trim());
  const currentLabel = comparableRowLabel(allRows[index].text);
  const canReplaceCurrent = !state.draft.trim() && !hasChildren(index, allRows);
  const matchesCurrentRow = canReplaceCurrent && firstPastedLabel && firstPastedLabel === currentLabel;
  const mergeContextIndex = state.draft.trim()
    ? index
    : (canReplaceCurrent ? (matchesCurrentRow ? index : parentIndex(index, allRows)) : -1);
  const parsedRows = parsePastedRows(text, allRows[index].level);
  if (!parsedRows.length) return;
  const mergedRows = mergeContextIndex === -1
    ? null
    : mergeParsedRowsIntoContext(mergeContextIndex, parsedRows, allRows, {
      ancestorIndexes,
      comparableRowLabel
    });
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

// Events

function wireUi() {
  dom.list.addEventListener('click', onListClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingTitlePersist({ keepalive: true });
    }
  });
  window.addEventListener('pagehide', () => {
    flushPendingTitlePersist({ keepalive: true });
  });

  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value;
    state.searchResultIndex = 0;
    renderHeader();
    renderRows();
  });
  dom.searchScope.addEventListener('change', () => {
    state.searchScope = dom.searchScope.value === 'all' ? 'all' : 'current';
    state.searchResultIndex = 0;
    renderHeader();
    renderRows();
  });
  dom.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-row-id][data-list-id]');
    if (!button) return;
    activateSearchResult(button.dataset.listId, button.dataset.rowId);
  });

  dom.titleInput.addEventListener('input', () => {
    updateListName(dom.titleInput.value);
  });

  dom.titleInput.addEventListener('blur', () => {
    updateListName(dom.titleInput.value, { trim: true });
  });

  dom.authForm.addEventListener('submit', submitAuthForm);
  dom.authToggleBtn.addEventListener('click', toggleAuthMode);
  dom.menuLogoutBtn.addEventListener('click', handleLogout);
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
  dom.exportBackupBtn.addEventListener('click', exportBackup);
  dom.importBackupBtn.addEventListener('click', () => {
    dom.importDbInput.value = '';
    dom.importDbInput.click();
  });
  dom.repairDbBtn.addEventListener('click', repairStructure);
  dom.importDbInput.addEventListener('change', () => {
    const [file] = dom.importDbInput.files || [];
    if (file) importBackupFile(file);
  });
  dom.pastePromptPlainBtn.addEventListener('click', pasteNormallyFromPrompt);
  dom.pastePromptSplitBtn.addEventListener('click', confirmSplitPaste);
  dom.exportCloseBtn.addEventListener('click', closeExportModal);
  dom.exportCopyBtn.addEventListener('click', copyExportMarkdown);
  dom.exportDownloadBtn.addEventListener('click', downloadExportMarkdown);
  dom.exportModal.addEventListener('click', (event) => {
    if (event.target === dom.exportModal || event.target.closest('.modal-backdrop')) {
      closeExportModal();
    }
  });
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
  dom.historyListBtn.addEventListener('click', openHistoryModal);
  dom.shareListBtn.addEventListener('click', openShareListModal);
  dom.deleteListCancelBtn.addEventListener('click', closeDeleteListModal);
  dom.deleteListConfirmBtn.addEventListener('click', deleteCurrentList);
  dom.deleteListModal.addEventListener('click', (event) => {
    if (event.target === dom.deleteListModal || event.target.closest('.modal-backdrop')) {
      closeDeleteListModal();
    }
  });
  dom.shareListCloseBtn.addEventListener('click', closeShareListModal);
  dom.shareListForm.addEventListener('submit', shareCurrentListWithEmail);
  dom.shareListPublicEnableBtn.addEventListener('click', enableCurrentListPublicShare);
  dom.shareListPublicCopyBtn.addEventListener('click', copyCurrentListPublicShare);
  dom.shareListPublicDisableBtn.addEventListener('click', disableCurrentListPublicShare);
  dom.shareListCollaborators.addEventListener('click', (event) => {
    const button = event.target.closest('[data-user-id]');
    if (!button) return;
    removeCollaborator(button.dataset.userId);
  });
  dom.shareListCollaborators.addEventListener('change', (event) => {
    const select = event.target.closest('[data-role-user-id]');
    if (!select) return;
    updateCollaboratorRole(select.dataset.roleUserId, select.value);
  });
  dom.shareListLeaveBtn.addEventListener('click', leaveCurrentSharedList);
  dom.shareListModal.addEventListener('click', (event) => {
    if (event.target === dom.shareListModal || event.target.closest('.modal-backdrop')) {
      closeShareListModal();
    }
  });
  dom.historyCloseBtn.addEventListener('click', closeHistoryModal);
  dom.historySaveBtn.addEventListener('click', saveHistoryCheckpoint);
  dom.historyEntries.addEventListener('click', (event) => {
    const button = event.target.closest('[data-revision-id]');
    if (!button) return;
    restoreHistoryRevisionById(button.dataset.revisionId);
  });
  dom.historyModal.addEventListener('click', (event) => {
    if (event.target === dom.historyModal || event.target.closest('.modal-backdrop')) {
      closeHistoryModal();
    }
  });
  dom.conflictCloseBtn.addEventListener('click', closeConflictModal);
  dom.conflictKeepRemoteBtn.addEventListener('click', () => resolveConflict('keep-remote'));
  dom.conflictCopyLocalBtn.addEventListener('click', () => resolveConflict('copy-local'));
  dom.conflictOverwriteBtn.addEventListener('click', () => resolveConflict('overwrite'));
  dom.conflictModal.addEventListener('click', (event) => {
    if (event.target === dom.conflictModal || event.target.closest('.modal-backdrop')) {
      closeConflictModal();
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
  if (!isAuthenticated() && !isPublicMode()) return;
  if (hasPublicViewError()) return;
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
      openExportModal(rowId);
      break;
    case 'delete-row':
      deleteRows(new Set([rowId]));
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
  if (!isAuthenticated() && !isPublicMode()) return;
  if (hasPublicViewError()) return;

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

  if (state.shareListModal.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShareListModal();
    }
    return;
  }

  if (state.historyModal.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHistoryModal();
    }
    return;
  }

  if (state.conflictModal.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConflictModal();
    }
    return;
  }

  if (state.exportModal.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeExportModal();
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
  if (!typingInEditor && document.activeElement === dom.searchInput) {
    const results = computeSearchResults();

    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      state.searchResultIndex = Math.min(results.length - 1, state.searchResultIndex + 1);
      renderSearchResults();
      return;
    }

    if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      state.searchResultIndex = Math.max(0, state.searchResultIndex - 1);
      renderSearchResults();
      return;
    }

    if (event.key === 'Enter' && results.length) {
      event.preventDefault();
      const result = results[state.searchResultIndex] || results[0];
      activateSearchResult(result.listId, result.rowId);
      return;
    }

    if (event.key === 'Escape' && state.searchQuery) {
      event.preventDefault();
      state.searchQuery = '';
      state.searchResultIndex = 0;
      renderHeader();
      renderRows();
      return;
    }
  }

  if (!typingInEditor && isInteractiveTarget(event.target)) return;

  const canEditList = currentListCanEdit();

  if (!typingInEditor && canEditList && isUndoShortcut(event)) {
    event.preventDefault();
    undoChange();
    return;
  }

  if (!typingInEditor && canEditList && isRedoShortcut(event)) {
    event.preventDefault();
    redoChange();
    return;
  }

  if (typingInEditor) {
    if (!canEditList) {
      event.preventDefault();
      cancelEdit();
      return;
    }
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

  if (canEditList && isBranchMoveShortcut(event, 'ArrowUp')) {
    event.preventDefault();
    moveSelection(-1);
    return;
  }

  if (canEditList && isBranchMoveShortcut(event, 'ArrowDown')) {
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

  if (canEditList && event.key === 'Enter') {
    event.preventDefault();
    insertBelow();
    return;
  }

  if (canEditList && event.key === 'Tab') {
    event.preventDefault();
    indentSelection(event.shiftKey ? -1 : 1);
    return;
  }

  if (canEditList && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    deleteSelection();
    return;
  }

  if (canEditList && /^[1-6]$/.test(event.key)) {
    event.preventDefault();
    applyColor(event.key);
    return;
  }

  if (canEditList && event.key === '0') {
    event.preventDefault();
    applyColor('');
    return;
  }

  if (canEditList && !event.metaKey && !event.ctrlKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
    updateKeyChain(event.key.toLowerCase());

    if (state.keyChain === EDIT_SHORTCUT && state.focused) {
      event.preventDefault();
      state.keyChain = '';
      beginEdit(state.focused);
    }
  }
}
