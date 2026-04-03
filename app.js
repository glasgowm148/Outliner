const DB_KEY = 'tabrows-db-v1';

const COLORS = {
  '1': 'color-1',
  '2': 'color-2',
  '3': 'color-3',
  '4': 'color-4',
  '5': 'color-5',
  '6': 'color-6'
};

const titleInput = document.getElementById('title');
const listSelect = document.getElementById('listSelect');
const newListBtn = document.getElementById('newListBtn');
const deleteListBtn = document.getElementById('deleteListBtn');
const breadcrumbsEl = document.getElementById('breadcrumbs');
const listEl = document.getElementById('list');

const state = {
  db: loadDb(),
  selected: new Set(),
  anchor: null,
  focused: null,
  editing: null,
  draft: '',
  keyChain: '',
  menuRow: null,
  viewRoot: null
};

let keyChainTimer = null;

normalizeDb();
ensureSelection();
wireUi();
renderAll();

function id() {
  return Math.random().toString(36).slice(2, 10);
}

function makeRow(text = '', level = 0, color = '', collapsed = false) {
  return { id: id(), text, level, color, collapsed };
}

function defaultRows() {
  return [
    makeRow('TabRows', 0),
    makeRow('simple nested rows', 1),
    makeRow('select multiple, then Tab', 1, '2'),
    makeRow('colour with 1 to 6', 1, '5')
  ];
}

function defaultDb() {
  const listId = id();
  return {
    currentId: listId,
    lists: [
      {
        id: listId,
        name: 'TabRows',
        rows: defaultRows()
      }
    ]
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : defaultDb();
  } catch {
    return defaultDb();
  }
}

function saveDb() {
  localStorage.setItem(DB_KEY, JSON.stringify(state.db));
}

function normalizeDb() {
  if (!state.db || !Array.isArray(state.db.lists) || !state.db.lists.length) {
    state.db = defaultDb();
    saveDb();
    return;
  }

  state.db.lists.forEach((list) => {
    list.name = list.name || 'Untitled';
    if (!Array.isArray(list.rows)) list.rows = [];
    list.rows = list.rows.map((row) => ({
      id: row.id || id(),
      text: typeof row.text === 'string' ? row.text : '',
      level: Number.isInteger(row.level) ? Math.max(0, row.level) : 0,
      color: typeof row.color === 'string' ? row.color : '',
      collapsed: Boolean(row.collapsed)
    }));
  });

  if (!state.db.lists.some((list) => list.id === state.db.currentId)) {
    state.db.currentId = state.db.lists[0].id;
  }

  saveDb();
}

function currentList() {
  return state.db.lists.find((list) => list.id === state.db.currentId) || state.db.lists[0];
}

function rows() {
  return currentList().rows;
}

function rowIndex(rowId) {
  return rows().findIndex((row) => row.id === rowId);
}

function rowById(rowId) {
  const index = rowIndex(rowId);
  return index === -1 ? null : rows()[index];
}

function subtreeEnd(startIndex, array = rows()) {
  const base = array[startIndex].level;
  let end = startIndex + 1;
  while (end < array.length && array[end].level > base) end += 1;
  return end;
}

function hasChildren(index) {
  const allRows = rows();
  return Boolean(allRows[index + 1] && allRows[index + 1].level > allRows[index].level);
}

function getParentIndex(index, array = rows()) {
  if (index <= 0) return -1;
  const level = array[index].level;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (array[i].level < level) return i;
  }
  return -1;
}

function ancestorIds(rowId) {
  const index = rowIndex(rowId);
  if (index === -1) return [];
  const ids = [];
  let current = index;
  while (current !== -1) {
    ids.unshift(rows()[current].id);
    current = getParentIndex(current);
  }
  return ids;
}

function expandAncestorChain(index, array = rows()) {
  let changed = false;
  let parent = getParentIndex(index, array);
  while (parent !== -1) {
    if (array[parent].collapsed) {
      array[parent].collapsed = false;
      changed = true;
    }
    parent = getParentIndex(parent, array);
  }
  return changed;
}

function isInCurrentView(rowId) {
  if (!state.viewRoot) return rowIndex(rowId) !== -1;
  const rootIndex = rowIndex(state.viewRoot);
  const index = rowIndex(rowId);
  if (rootIndex === -1 || index === -1) return false;
  return index >= rootIndex && index < subtreeEnd(rootIndex);
}

function visibleMeta() {
  const allRows = rows();
  let start = 0;
  let end = allRows.length;
  let baseLevel = 0;

  if (state.viewRoot) {
    const rootIndex = rowIndex(state.viewRoot);
    if (rootIndex !== -1) {
      start = rootIndex;
      end = subtreeEnd(rootIndex);
      baseLevel = allRows[rootIndex].level;
    }
  }

  const subset = allRows.slice(start, end);
  const hiddenLevels = [];
  const out = [];

  subset.forEach((row, offset) => {
    const displayLevel = row.level - baseLevel;
    while (hiddenLevels.length && displayLevel <= hiddenLevels[hiddenLevels.length - 1]) {
      hiddenLevels.pop();
    }
    const hidden = hiddenLevels.length > 0;
    if (!hidden) out.push({ row, index: start + offset, displayLevel });
    if (row.collapsed) hiddenLevels.push(displayLevel);
  });

  return out;
}

function visibleRows() {
  return visibleMeta().map(({ row }) => row);
}

function selectedIndexes() {
  return rows()
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => state.selected.has(row.id))
    .map(({ index }) => index)
    .sort((a, b) => a - b);
}

function selectedRootIds() {
  const indexes = selectedIndexes();
  const ids = [];
  let coveredUntil = -1;
  indexes.forEach((index) => {
    if (index < coveredUntil) return;
    ids.push(rows()[index].id);
    coveredUntil = subtreeEnd(index);
  });
  return ids;
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

  if (state.viewRoot && rowIndex(state.viewRoot) === -1) {
    state.viewRoot = null;
  }

  if (state.focused && !isInCurrentView(state.focused)) {
    state.focused = state.viewRoot || allRows[0].id;
  }

  if (!state.focused || rowIndex(state.focused) === -1) {
    state.focused = state.viewRoot || allRows[0].id;
  }

  if (!state.anchor || rowIndex(state.anchor) === -1 || !isInCurrentView(state.anchor)) {
    state.anchor = state.focused;
  }

  const validSelected = [...state.selected].filter((id) => rowIndex(id) !== -1 && isInCurrentView(id));
  state.selected = validSelected.length ? new Set(validSelected) : new Set([state.focused]);
}

function setSelection(ids, anchor = ids[ids.length - 1] || null) {
  state.selected = new Set(ids);
  state.anchor = anchor;
  state.focused = ids[ids.length - 1] || null;
  state.menuRow = null;
  renderRows();
}

function wireUi() {
  listEl.addEventListener('click', onListClick);
  listEl.addEventListener('dblclick', onListDoubleClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);

  titleInput.addEventListener('input', () => {
    currentList().name = titleInput.value || 'Untitled';
    saveDb();
    renderHeader();
  });

  titleInput.addEventListener('blur', () => {
    currentList().name = titleInput.value.trim() || 'Untitled';
    saveDb();
    renderHeader();
  });

  listSelect.addEventListener('change', () => switchList(listSelect.value));
  newListBtn.addEventListener('click', createList);
  deleteListBtn.addEventListener('click', deleteCurrentList);
}

function onDocumentClick(event) {
  if (!event.target.closest('.actions-wrap')) {
    if (state.menuRow) {
      state.menuRow = null;
      renderRows();
    }
  }
}

function renderAll() {
  renderHeader();
  renderRows();
}

function renderHeader() {
  titleInput.value = currentList().name;

  listSelect.innerHTML = '';
  state.db.lists.forEach((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.name;
    option.selected = list.id === state.db.currentId;
    listSelect.appendChild(option);
  });

  renderBreadcrumbs();
}

function rowLabel(text) {
  return String(text || '').split('\n')[0] || 'Untitled';
}

function renderBreadcrumbs() {
  breadcrumbsEl.innerHTML = '';
  if (!state.viewRoot) return;

  const listCrumb = document.createElement('button');
  listCrumb.type = 'button';
  listCrumb.className = 'crumb';
  listCrumb.textContent = currentList().name;
  listCrumb.addEventListener('click', () => {
    state.viewRoot = null;
    ensureSelection();
    renderAll();
  });
  breadcrumbsEl.appendChild(listCrumb);

  ancestorIds(state.viewRoot).forEach((idValue, index, ids) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '›';
    breadcrumbsEl.appendChild(sep);

    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'crumb' + (index === ids.length - 1 ? ' current' : '');
    crumb.textContent = rowLabel(rowById(idValue)?.text);
    crumb.addEventListener('click', () => {
      state.viewRoot = idValue;
      state.menuRow = null;
      ensureSelection();
      setSelection([idValue], idValue);
      renderAll();
    });
    breadcrumbsEl.appendChild(crumb);
  });
}

function renderRows() {
  ensureSelection();

  if (state.editing) {
    const editIndex = rowIndex(state.editing);
    if (editIndex !== -1) expandAncestorChain(editIndex);
  }

  listEl.innerHTML = '';

  visibleMeta().forEach(({ row, index, displayLevel }) => {
    const el = document.createElement('div');
    el.className = 'row';
    el.dataset.id = row.id;
    if (state.selected.has(row.id)) el.classList.add('selected');
    if (state.focused === row.id) el.classList.add('focused');
    if (row.color && COLORS[row.color]) el.classList.add(COLORS[row.color]);

    const main = document.createElement('div');
    main.className = 'row-main';
    main.style.setProperty('--level', displayLevel);

    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    if (hasChildren(index)) {
      gutter.classList.add('caret');
      gutter.textContent = row.collapsed ? '▸' : '▾';
      gutter.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCollapse(row.id);
      });
    } else {
      gutter.classList.add('empty');
      gutter.textContent = '•';
    }

    if (state.editing === row.id) {
      const input = document.createElement('textarea');
      input.className = 'editor';
      input.value = state.draft;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.rows = 1;
      input.addEventListener('input', () => {
        state.draft = input.value;
        autosize(input);
      });
      input.addEventListener('blur', commitEdit);
      main.append(gutter, input);
      el.appendChild(main);
      listEl.appendChild(el);
      requestAnimationFrame(() => {
        input.focus();
        autosize(input);
        input.selectionStart = input.selectionEnd = input.value.length;
      });
      return;
    }

    const text = document.createElement('div');
    text.className = 'text';
    text.innerHTML = renderMarkdown(row.text);
    main.append(gutter, text);
    el.appendChild(main);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'actions-wrap';

    const actionsBtn = document.createElement('button');
    actionsBtn.type = 'button';
    actionsBtn.className = 'actions-btn';
    actionsBtn.textContent = '⋮';
    actionsBtn.setAttribute('aria-expanded', String(state.menuRow === row.id));
    actionsBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.menuRow = state.menuRow === row.id ? null : row.id;
      renderRows();
    });
    actionsWrap.appendChild(actionsBtn);

    if (state.menuRow === row.id) {
      const menu = document.createElement('div');
      menu.className = 'actions-menu';

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'actions-item';
      focusBtn.textContent = 'Focus';
      focusBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        focusRow(row.id);
      });

      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'actions-item';
      exportBtn.textContent = 'Export Markdown';
      exportBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        exportSubtreeMarkdown(row.id);
      });

      menu.append(focusBtn, exportBtn);
      actionsWrap.appendChild(menu);
    }

    el.appendChild(actionsWrap);
    listEl.appendChild(el);
  });
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function onListClick(event) {
  if (state.editing) return;
  const rowEl = event.target.closest('.row');
  if (!rowEl) return;
  if (event.target.closest('.actions-wrap')) return;
  if (event.detail >= 2) {
    beginEdit(rowEl.dataset.id);
    return;
  }
  applyClickSelection(event, rowEl.dataset.id);
}

function onListDoubleClick(event) {
  if (state.editing) return;
  const rowEl = event.target.closest('.row');
  if (!rowEl) return;
  if (event.target.closest('.actions-wrap')) return;
  beginEdit(rowEl.dataset.id);
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

  setSelection([rowId], rowId);
}

function beginEdit(rowId) {
  const row = rowById(rowId);
  if (!row) return;
  state.editing = rowId;
  state.focused = rowId;
  state.anchor = rowId;
  state.selected = new Set([rowId]);
  state.draft = row.text;
  state.menuRow = null;
  renderRows();
}

function commitEdit() {
  if (!state.editing) return;
  const editingId = state.editing;
  const index = rowIndex(editingId);
  if (index === -1) {
    state.editing = null;
    state.draft = '';
    renderRows();
    return;
  }

  const value = state.draft.trim();
  state.editing = null;
  state.draft = '';

  if (value === '') {
    deleteRows(new Set([editingId]));
    return;
  }

  rows()[index].text = value;
  saveDb();
  renderRows();
}

function cancelEdit() {
  const editingId = state.editing;
  const value = state.draft.trim();
  state.editing = null;
  state.draft = '';
  if (editingId && value === '') {
    deleteRows(new Set([editingId]));
    return;
  }
  renderRows();
}

function insertBelow() {
  const allRows = rows();
  const baseId = state.focused || allRows[allRows.length - 1]?.id || null;
  const index = baseId ? rowIndex(baseId) : allRows.length - 1;
  const level = index >= 0 ? allRows[index].level : 0;
  const insertAt = index >= 0 ? subtreeEnd(index) : allRows.length;
  const row = makeRow('', level);
  allRows.splice(insertAt, 0, row);
  saveDb();
  beginEdit(row.id);
}

function deleteRows(ids) {
  if (!ids || !ids.size) return;
  const allRows = rows();
  const deletedIndexes = allRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => ids.has(row.id))
    .map(({ index }) => index)
    .sort((a, b) => a - b);

  if (!deletedIndexes.length) return;

  if (state.viewRoot && ids.has(state.viewRoot)) {
    const viewRootIndex = rowIndex(state.viewRoot);
    const parentIndex = viewRootIndex === -1 ? -1 : getParentIndex(viewRootIndex);
    state.viewRoot = parentIndex === -1 ? null : allRows[parentIndex].id;
  }

  const firstDeleted = deletedIndexes[0];
  const parentIndex = getParentIndex(firstDeleted);
  let fallbackId = null;

  if (parentIndex !== -1 && !ids.has(allRows[parentIndex].id)) {
    fallbackId = allRows[parentIndex].id;
  } else if (firstDeleted > 0 && !ids.has(allRows[firstDeleted - 1].id)) {
    fallbackId = allRows[firstDeleted - 1].id;
  } else {
    const next = allRows.find((row, index) => index > firstDeleted && !ids.has(row.id));
    fallbackId = next?.id || null;
  }

  currentList().rows = allRows.filter((row) => !ids.has(row.id));
  state.selected = fallbackId ? new Set([fallbackId]) : new Set();
  state.focused = fallbackId;
  state.anchor = fallbackId;
  state.editing = null;
  state.draft = '';
  state.menuRow = null;
  ensureSelection();
  saveDb();
  renderAll();
}

function deleteSelection() {
  if (!state.selected.size) return;
  deleteRows(new Set(state.selected));
}

function indentSelection(step) {
  if (step > 0) return indentRight();
  return outdentLeft();
}

function indentRight() {
  const rootIds = selectedRootIds();
  if (!rootIds.length) return;
  const allRows = rows();

  rootIds.forEach((rootId) => {
    const index = rowIndex(rootId);
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
  const rootIds = selectedRootIds();
  if (!rootIds.length) return;
  const allRows = rows();

  [...rootIds].reverse().forEach((rootId) => {
    const start = rowIndex(rootId);
    if (start <= 0) return;
    const parentIndex = getParentIndex(start, allRows);
    if (parentIndex === -1) return;
    const parentId = allRows[parentIndex].id;
    const end = subtreeEnd(start, allRows);
    const branch = allRows.splice(start, end - start);
    branch.forEach((row) => {
      row.level = Math.max(0, row.level - 1);
    });
    const newParentIndex = allRows.findIndex((row) => row.id === parentId);
    const insertAt = newParentIndex === -1 ? allRows.length : subtreeEnd(newParentIndex, allRows);
    allRows.splice(insertAt, 0, ...branch);
  });

  saveDb();
  renderRows();
}

function toggleCollapse(rowId, force = null) {
  const index = rowIndex(rowId);
  if (index === -1 || !hasChildren(index)) return;
  const row = rows()[index];
  row.collapsed = force === null ? !row.collapsed : Boolean(force);
  saveDb();
  renderRows();
}

function collapseFocused() {
  if (!state.focused) return;
  const index = rowIndex(state.focused);
  if (index === -1) return;

  if (hasChildren(index) && !rows()[index].collapsed) {
    toggleCollapse(state.focused, true);
    return;
  }

  const parentIndex = getParentIndex(index);
  if (parentIndex !== -1 && isInCurrentView(rows()[parentIndex].id)) {
    setSelection([rows()[parentIndex].id], rows()[parentIndex].id);
  }
}

function expandFocused() {
  if (!state.focused) return;
  const index = rowIndex(state.focused);
  if (index === -1) return;

  if (hasChildren(index) && rows()[index].collapsed) {
    toggleCollapse(state.focused, false);
    return;
  }

  if (hasChildren(index)) {
    const child = rows()[index + 1];
    if (child && isInCurrentView(child.id)) setSelection([child.id], child.id);
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

  setSelection([nextId], nextId);
}

function moveSelection(direction) {
  const rootIds = selectedRootIds();
  if (!rootIds.length) return;
  const allRows = rows();
  const starts = rootIds.map((rootId) => rowIndex(rootId)).filter((index) => index !== -1).sort((a, b) => a - b);
  if (!starts.length) return;

  const movingLevel = allRows[starts[0]].level;
  const movingParent = getParentIndex(starts[0], allRows);
  for (let i = 0; i < starts.length; i += 1) {
    if (allRows[starts[i]].level !== movingLevel) return;
    if (getParentIndex(starts[i], allRows) !== movingParent) return;
    if (i > 0 && starts[i] !== subtreeEnd(starts[i - 1], allRows)) return;
  }

  const movingStart = starts[0];
  const movingEnd = subtreeEnd(starts[starts.length - 1], allRows);

  if (direction < 0) {
    let prevStart = -1;
    for (let i = movingStart - 1; i >= 0; i -= 1) {
      if (allRows[i].level === movingLevel && getParentIndex(i, allRows) === movingParent) {
        prevStart = i;
        break;
      }
      if (allRows[i].level < movingLevel) break;
    }
    if (prevStart === -1) return;
    const movingBlock = allRows.slice(movingStart, movingEnd);
    const prevBlock = allRows.slice(prevStart, movingStart);
    allRows.splice(prevStart, movingEnd - prevStart, ...movingBlock, ...prevBlock);
  } else {
    let nextStart = -1;
    for (let i = movingEnd; i < allRows.length; i += 1) {
      if (allRows[i].level === movingLevel && getParentIndex(i, allRows) === movingParent) {
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

function updateKeyChain(key) {
  state.keyChain = (state.keyChain + key).slice(-2);
  clearTimeout(keyChainTimer);
  keyChainTimer = setTimeout(() => {
    state.keyChain = '';
  }, 500);
}

function switchList(listId) {
  state.db.currentId = listId;
  state.editing = null;
  state.draft = '';
  state.menuRow = null;
  state.viewRoot = null;
  ensureSelection();
  saveDb();
  renderAll();
}

function createList() {
  const list = {
    id: id(),
    name: 'Untitled',
    rows: [makeRow('', 0)]
  };
  state.db.lists.unshift(list);
  state.db.currentId = list.id;
  state.selected = new Set([list.rows[0].id]);
  state.focused = list.rows[0].id;
  state.anchor = list.rows[0].id;
  state.editing = null;
  state.draft = '';
  state.menuRow = null;
  state.viewRoot = null;
  saveDb();
  renderAll();
  titleInput.focus();
  titleInput.select();
}

function deleteCurrentList() {
  if (state.db.lists.length === 1) {
    state.db = defaultDb();
  } else {
    state.db.lists = state.db.lists.filter((list) => list.id !== state.db.currentId);
    state.db.currentId = state.db.lists[0].id;
  }
  state.editing = null;
  state.draft = '';
  state.menuRow = null;
  state.viewRoot = null;
  ensureSelection();
  saveDb();
  renderAll();
}

function focusRow(rowId) {
  state.viewRoot = rowId;
  state.menuRow = null;
  ensureSelection();
  setSelection([rowId], rowId);
  renderAll();
}

function subtreeToMarkdown(rowId) {
  const start = rowIndex(rowId);
  if (start === -1) return '';
  const end = subtreeEnd(start);
  const baseLevel = rows()[start].level;
  const lines = [];

  rows().slice(start, end).forEach((row) => {
    const level = row.level - baseLevel;
    const rowLines = String(row.text || '').split('\n');
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
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  state.menuRow = null;
  renderRows();
}

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
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return '#';
}

function renderInlineMarkdown(raw) {
  const tokens = [];
  const withLinkTokens = String(raw).replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, url) => {
    const token = `@@LINK${tokens.length}@@`;
    tokens.push({ label, url });
    return token;
  });

  let text = escapeHtml(withLinkTokens);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/@@LINK(\d+)@@/g, (_, index) => {
    const item = tokens[Number(index)];
    if (!item) return '';
    return `<a href="${escapeHtml(sanitizeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`;
  });
  return text;
}

function renderMarkdown(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return '';

  const lines = normalized.split('\n');
  const parts = [];
  let quoted = [];

  function flushQuote() {
    if (!quoted.length) return;
    const html = quoted
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .map((line) => renderInlineMarkdown(line))
      .join('<br>');
    parts.push(`<blockquote>${html}</blockquote>`);
    quoted = [];
  }

  lines.forEach((line) => {
    if (/^\s*>/.test(line)) {
      quoted.push(line);
      return;
    }
    flushQuote();
    parts.push(renderInlineMarkdown(line));
  });

  flushQuote();
  return parts.join('<br>');
}

function isBranchMoveShortcut(event, key) {
  return event.altKey && (event.key === key || event.code === key);
}

function moveFromEdit(step, extend = false) {
  const editingId = state.editing;
  const value = state.draft.trim();
  if (!editingId) return;
  if (value === '') deleteRows(new Set([editingId]));
  else commitEdit();
  moveFocus(step, extend);
}

function onKeyDown(event) {
  const typing = state.editing !== null;

  if (typing) {
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
    if (event.key === 'Enter' && event.shiftKey) {
      return;
    }
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
    if (state.keyChain === 'ee' && state.focused) {
      event.preventDefault();
      state.keyChain = '';
      beginEdit(state.focused);
    }
  }
}
