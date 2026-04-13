import { createRow, normalizeText } from './storage.js';

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

function countIndentation(value) {
  return String(value || '').replace(/\t/g, '  ').length;
}

function countTabOutlineIndent(prefix) {
  let depth = 0;
  let pendingSpaces = 0;

  for (const char of String(prefix || '')) {
    if (char === '\t') {
      depth += 1;
      pendingSpaces = 0;
      continue;
    }

    if (char === ' ') {
      pendingSpaces += 1;
      if (pendingSpaces === 2) {
        depth += 1;
        pendingSpaces = 0;
      }
      continue;
    }

    pendingSpaces = 0;
  }

  return depth;
}

function strictOutlineLines(text) {
  return normalizeText(text)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.match(/^([ \t]*)(.*)$/);
      return {
        indent: countTabOutlineIndent(match?.[1] || ''),
        text: (match?.[2] || '').trim()
      };
    })
    .filter((line) => line.text);
}

function looksLikeTabIndentedOutline(text) {
  const lines = normalizeText(text).split('\n').filter((line) => line.trim());
  if (lines.length < 2) return false;
  return lines.some((line) => /^\t+/.test(line));
}

function hasPlainTabIndentedLine(text) {
  return normalizeText(text)
    .split('\n')
    .filter((line) => /^\t+/.test(line) && line.trim())
    .some((line) => !matchOutlineLine(line));
}

function hasStructuralMarkdownList(text) {
  const lines = normalizeText(text).split('\n').filter((line) => line.trim());
  const markers = lines
    .map((line) => matchOutlineLine(line)?.[2] || '')
    .filter(Boolean);

  if (!markers.length) return false;
  if (markers.some((marker) => /^[-*+]$/.test(marker))) return true;
  return markers.filter((marker) => /^\d+[.)]$/.test(marker)).length >= 2;
}

function buildStrictOutlineRows(text, baseLevel) {
  const lines = strictOutlineLines(text);
  if (!lines.length) return [];

  const rows = [];
  // Preserve whatever indentation widths the export used, but translate each
  // deeper indent transition into exactly one tree level.
  const indentStack = [{ indent: lines[0].indent, level: baseLevel }];

  lines.forEach((line, index) => {
    if (index === 0) {
      rows.push(createRow(line.text, baseLevel));
      return;
    }

    while (indentStack.length && line.indent < indentStack[indentStack.length - 1].indent) {
      indentStack.pop();
    }

    if (!indentStack.length) {
      indentStack.push({ indent: line.indent, level: baseLevel });
      rows.push(createRow(line.text, baseLevel));
      return;
    }

    const top = indentStack[indentStack.length - 1];
    if (line.indent === top.indent) {
      rows.push(createRow(line.text, top.level));
      return;
    }

    const nextLevel = top.level + 1;
    indentStack.push({ indent: line.indent, level: nextLevel });
    rows.push(createRow(line.text, nextLevel));
  });

  return rows;
}

export function matchOutlineLine(line) {
  return String(line || '').match(/^(\s*)((?:[-*+]|\d+[.)]))\s+(.*)$/);
}

function buildMarkdownOutlineRows(text, baseLevel) {
  const lines = normalizeText(text).split('\n');
  const firstListIndex = lines.findIndex((line) => matchOutlineLine(line));
  if (firstListIndex === -1) return null;

  const rows = [];
  const preludeText = lines.slice(0, firstListIndex).join('\n');
  const preludeBlocks = splitIntoParagraphBlocks(preludeText);
  preludeBlocks.forEach((block) => {
    rows.push(createRow(block.join('\n'), baseLevel));
  });

  const listBaseLevel = preludeBlocks.length === 1 ? baseLevel + 1 : baseLevel;
  const indentStack = [];
  let currentRow = null;
  let pendingBlankLine = false;

  function resolveLevel(indent) {
    while (indentStack.length && indent < indentStack[indentStack.length - 1].indent) {
      indentStack.pop();
    }

    if (!indentStack.length) {
      indentStack.push({ indent, level: listBaseLevel });
      return listBaseLevel;
    }

    const top = indentStack[indentStack.length - 1];
    if (indent === top.indent) {
      return top.level;
    }

    const level = top.level + 1;
    indentStack.push({ indent, level });
    return level;
  }

  for (let index = firstListIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      if (currentRow) pendingBlankLine = true;
      continue;
    }

    const outlineMatch = matchOutlineLine(line);
    if (outlineMatch) {
      const level = resolveLevel(countIndentation(outlineMatch[1]));
      currentRow = createRow(outlineMatch[3].trimEnd(), level);
      rows.push(currentRow);
      pendingBlankLine = false;
      continue;
    }

    if (!currentRow) {
      rows.push(createRow(line.trimEnd(), baseLevel));
      pendingBlankLine = false;
      continue;
    }

    const continuation = line
      .replace(/^\s+/, '')
      .trimEnd()
      .replace(/^\\(?=(?:[-*+]|\d+[.)])\s+)/, '');
    currentRow.text += `${pendingBlankLine ? '\n\n' : '\n'}${continuation}`;
    pendingBlankLine = false;
  }

  return rows;
}

export function parsePastedRows(text, baseLevel) {
  const normalized = normalizeText(text);
  if (!normalized.trim()) return [];

  // Prefer the tab-outline path whenever the paste has explicit indentation
  // structure that would be weakened by treating it as markdown.
  if (looksLikeTabIndentedOutline(normalized) && (
    hasPlainTabIndentedLine(normalized)
    || !hasStructuralMarkdownList(normalized)
  )) {
    return buildStrictOutlineRows(normalized, baseLevel);
  }

  const markdownRows = buildMarkdownOutlineRows(normalized, baseLevel);
  if (markdownRows?.length) return markdownRows;

  if (looksLikeTabIndentedOutline(normalized)) {
    return buildStrictOutlineRows(normalized, baseLevel);
  }

  return splitIntoParagraphBlocks(normalized).map((block) => createRow(block.join('\n'), baseLevel));
}

function pathMatchesSuffix(fullPath, suffixPath) {
  if (suffixPath.length > fullPath.length) return false;
  const offset = fullPath.length - suffixPath.length;
  return suffixPath.every((label, index) => label === fullPath[offset + index]);
}

export function mergeParsedRowsIntoContext(editingIndex, parsedRows, allRows, helpers) {
  const { ancestorIndexes, comparableRowLabel } = helpers;
  if (editingIndex === -1 || !parsedRows.length) return null;

  // When the pasted block repeats the current ancestor chain, drop that shared
  // prefix so importing an exported subtree back into the same context does not
  // duplicate container rows.
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
  const rootOnlyMatch = bestMatch.pathIndexes.length === 1 && bestMatch.pathIndexes[0] === 0;
  const hasPeerLevelRows = rootOnlyMatch && parsedRows.some((row, index) => (
    !hiddenIndexes.has(index)
    && row.level === bestMatch.rowLevel
  ));

  const mergedRows = parsedRows
    .filter((_, index) => !hiddenIndexes.has(index))
    .map((row) => {
      let level = row.level + levelDelta;

      if (rootOnlyMatch) {
        level = hasPeerLevelRows
          ? level + 1
          : Math.max(allRows[editingIndex].level + 1, level);
      }

      return {
        ...row,
        level: Math.max(0, level)
      };
    });

  return mergedRows.length ? mergedRows : null;
}
