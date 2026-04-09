import { createRow, normalizeText } from './storage.js';

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

export function matchOutlineLine(line) {
  return String(line || '').match(/^(\s*)((?:[-*]|\d+[.)]|[A-Za-z][.)]))\s+(.*)$/);
}

function markerKind(marker) {
  return /^[-*]$/.test(String(marker || '')) ? 'bullet' : 'ordered';
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
        markerKind: markerKind(outlineMatch[2]),
        text: outlineMatch[3].trimEnd()
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

function previousSameIndentMeta(metas, indent, kind, markerKind = null) {
  for (let index = metas.length - 1; index >= 0; index -= 1) {
    const meta = metas[index];
    if (meta.indent !== indent) continue;
    if (kind && meta.kind !== kind) continue;
    if (markerKind && meta.markerKind !== markerKind) continue;
    return meta;
  }

  return null;
}

function markdownHeadingMatch(text) {
  return String(text || '').trim().match(/^(#{1,6})\s+(.+)$/u);
}

function isStandaloneStrongText(text) {
  return /^\*\*[^*][\s\S]*\*\*$/.test(String(text || '').trim());
}

function isHeadingLikeText(text) {
  return isStandaloneStrongText(text) || Boolean(markdownHeadingMatch(text));
}

function isEmojiDecoratedStrongText(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^(.*?)(\*\*[\s\S]+\*\*)$/u);
  if (!match) return false;

  return /\p{Extended_Pictographic}/u.test(match[1]);
}

function isTopLevelBreakoutText(text) {
  const trimmed = String(text || '').trim();
  return Boolean(markdownHeadingMatch(trimmed)) || isEmojiDecoratedStrongText(trimmed);
}

function isStandaloneMarkdownLink(text) {
  return /^\[[^\]]+\]\([^)]+\)$/.test(String(text || '').trim());
}

function isSectionLikeText(text) {
  const trimmed = String(text || '').trimEnd();
  if (!trimmed) return false;
  if (isHeadingLikeText(trimmed) || trimmed.endsWith(':')) return true;
  if (isStandaloneMarkdownLink(trimmed)) return false;
  if (/^\d/.test(trimmed)) return false;
  if (/[.?!]$/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8 && trimmed.length <= 80;
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

function rootContainerMeta(metas, baseLevel) {
  const root = metas[0];
  if (!root || root.kind !== 'plain') return null;
  if (root.level !== baseLevel || isHeadingLikeText(root.text)) return null;
  return root;
}

// Mixed markdown pastes behave like an outline parser, not a plain paragraph
// splitter, so section labels and nested bullets can coexist in one import.
function buildPastedRowsFromTokens(tokens, baseLevel) {
  const metas = [];

  tokens.forEach((token) => {
    const previous = metas[metas.length - 1];
    const previousIsSection = previous ? isSectionLikeText(previous.text) : false;
    const tokenIsSection = token.kind === 'list' && isSectionLikeText(token.text);
    const continuesSectionList = previous
      && previous.kind === 'list'
      && previousIsSection
      && token.kind === 'list'
      && token.indent <= previous.indent
      && token.markerKind !== previous.markerKind;
    const startsOrderedSubsection = previous
      && previous.kind === 'list'
      && previous.markerKind === 'ordered'
      && token.kind === 'list'
      && token.markerKind === 'bullet'
      && tokenIsSection
      && token.indent <= previous.indent;
    let level = baseLevel;
    let sectionLevel = null;

    if (!previous) {
      level = baseLevel;
    } else if (token.kind === 'plain') {
      const plainSibling = previousSameIndentMeta(metas, token.indent, 'plain');
      const isHeadingLike = isHeadingLikeText(token.text);
      const isSectionLike = isSectionLikeText(token.text);
      const isTopLevelBreakout = isTopLevelBreakoutText(token.text);
      const headingSibling = isHeadingLike ? previousSameIndentHeadingMeta(metas, token.indent) : null;

      if (headingSibling) {
        level = headingSibling.level;
        sectionLevel = headingSibling.sectionLevel;
      } else if (
        previous.kind === 'list'
        && token.indent === 0
        && isTopLevelBreakout
      ) {
        const rootContainer = rootContainerMeta(metas, baseLevel);
        if (rootContainer) {
          level = rootContainer.level + 1;
          sectionLevel = rootContainer.level;
        } else {
          level = baseLevel;
          sectionLevel = null;
        }
      } else if (previous.kind === 'list') {
        if (previousIsSection) {
          level = previous.level + 1;
          sectionLevel = previous.level;
        } else if (previous.sectionLevel != null && token.indent <= previous.indent) {
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
      continuesSectionList
      || startsOrderedSubsection
      || (previous.kind === 'plain' && previousIsSection && token.indent <= previous.indent)
    ) {
      level = previous.level + 1;
      sectionLevel = previous.level;
    } else if (previous.kind === 'plain' && token.indent <= previous.indent) {
      if (previous.sectionLevel != null) {
        level = previous.sectionLevel + 1;
        sectionLevel = previous.sectionLevel;
      } else {
        level = previous.level;
      }
    } else if (previous.indent < token.indent) {
      level = previous.level + 1;
      sectionLevel = previousIsSection ? previous.level : previous.sectionLevel;
    } else {
      const sibling = previousSameIndentMeta(metas, token.indent, 'list', token.markerKind)
        || previousSameIndentMeta(metas, token.indent, 'list');
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

export function parsePastedRows(text, baseLevel) {
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

export function mergeParsedRowsIntoContext(editingIndex, parsedRows, allRows, helpers) {
  const { ancestorIndexes, comparableRowLabel } = helpers;
  if (editingIndex === -1 || !parsedRows.length) return null;

  // If the pasted outline already contains the branch we are inside, strip that
  // duplicated ancestor prefix and only insert the new suffix rows.
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
  const minimumMergedLevel = bestMatch.pathIndexes.length === 1 && bestMatch.pathIndexes[0] === 0
    ? bestMatch.rowLevel + 1
    : 0;
  const mergedRows = parsedRows
    .filter((_, index) => !hiddenIndexes.has(index))
    .map((row) => ({
      ...row,
      level: Math.max(0, Math.max(minimumMergedLevel, row.level) + levelDelta)
    }));

  return mergedRows.length ? mergedRows : null;
}
