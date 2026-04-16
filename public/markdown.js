import { DEFAULT_LIST_NAME, normalizeText } from './storage.js';
import { matchOutlineLine } from './outline.js';

function countIndentation(value) {
  return String(value || '').replace(/\t/g, '  ').length;
}

function indentationLevels(entries) {
  return [...new Set(entries.map((entry) => entry.indent))].sort((a, b) => a - b);
}

function parseOutlineEntries(lines) {
  const entries = [];
  let current = null;
  let sawEntry = false;
  let invalid = false;
  let pendingBlankLine = false;

  lines.forEach((line) => {
    if (!line.trim()) {
      if (sawEntry && current) pendingBlankLine = true;
      return;
    }

    const outlineMatch = matchOutlineLine(line);
    if (outlineMatch) {
      sawEntry = true;
      current = {
        indent: countIndentation(outlineMatch[1]),
        marker: outlineMatch[2],
        text: outlineMatch[3]
      };
      entries.push(current);
      pendingBlankLine = false;
      return;
    }

    if (!sawEntry || !current) {
      invalid = true;
      return;
    }

    current.text += `${pendingBlankLine ? '\n\n' : '\n'}${line.trim()}`;
    pendingBlankLine = false;
  });

  if (!sawEntry || invalid) return [];
  return entries.map((entry) => ({ ...entry, text: entry.text.trimEnd() }));
}

export function rowLabel(text) {
  return String(text || '').split('\n')[0] || DEFAULT_LIST_NAME;
}

export function comparableRowLabel(text) {
  return rowLabel(normalizeText(text))
    .replace(/^#{1,6}\s+/u, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*][\s\S]*?)\*\*/gu, '$1')
    .replace(/\*([^*][\s\S]*?)\*/gu, '$1')
    .replace(/[:：]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function slugify(value) {
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

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^(https?:|mailto:|\.{1,2}\/|#)/i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)/.test(trimmed)) return trimmed;
  if (/^(www\.|[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$))/i.test(trimmed)) return `https://${trimmed}`;
  return '#';
}

function sanitizeImageUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^(https?:|\.{1,2}\/)/i.test(trimmed)) return trimmed;
  return /^\/(?!\/)/.test(trimmed) ? trimmed : '';
}

function normalizeAutolinkUrl(url) {
  const trimmed = String(url || '').trim();
  return /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function stripAutolinkTrailingPunctuation(url) {
  let clean = String(url || '');
  let trailing = '';

  while (clean) {
    const last = clean.at(-1);
    if (!last || !'),.;:!?'.includes(last)) break;
    if (last === ')') {
      const opens = (clean.match(/\(/g) || []).length;
      const closes = (clean.match(/\)/g) || []).length;
      if (closes <= opens) break;
    }
    trailing = `${last}${trailing}`;
    clean = clean.slice(0, -1);
  }

  return {
    clean,
    trailing
  };
}

function appendInlineText(target, text) {
  if (!text) return;
  const last = target[target.length - 1];
  if (typeof last === 'string') {
    target[target.length - 1] = `${last}${text}`;
    return;
  }
  target.push(text);
}

function renderInlineTree(nodes) {
  return nodes.map((node) => {
    if (typeof node === 'string') return node;

    const content = renderInlineTree(node.children);
    if (!node.closed) {
      return `${'*'.repeat(node.marker)}${content}`;
    }

    return node.marker === 2 ? `<strong>${content}</strong>` : `<em>${content}</em>`;
  }).join('');
}

// Supports nested `*` inside `**` for common emphasis cases without pulling in
// a full markdown parser.
function renderAsteriskEmphasis(text) {
  const root = { marker: 0, closed: true, children: [] };
  const stack = [root];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '*') {
      appendInlineText(stack[stack.length - 1].children, text[index]);
      continue;
    }

    let runLength = 1;
    while (text[index + runLength] === '*') runLength += 1;

    const previousChar = index > 0 ? text[index - 1] : '';
    const nextChar = text[index + runLength] || '';
    const canClose = previousChar && !/\s/.test(previousChar);
    const canOpen = nextChar && !/\s/.test(nextChar);
    let remaining = runLength;

    while (remaining > 0) {
      const top = stack[stack.length - 1];

      if (canClose && top.marker && remaining >= top.marker) {
        top.closed = true;
        stack.pop();
        remaining -= top.marker;
        continue;
      }

      if (canOpen) {
        const marker = remaining >= 2 ? 2 : 1;
        const node = { marker, closed: false, children: [] };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        remaining -= marker;
        continue;
      }

      appendInlineText(stack[stack.length - 1].children, '*'.repeat(remaining));
      remaining = 0;
    }

    index += runLength - 1;
  }

  return renderInlineTree(root.children);
}

const MARKDOWN_DESTINATION_PATTERN = '([^\\s()]+(?:\\([^\\s()]*\\)[^\\s()]*)*)';
let inlineTokenSeed = 0;

function createInlineTokenPrefix(source) {
  let tokenPrefix;

  do {
    inlineTokenSeed += 1;
    tokenPrefix = `@@TABROWS_${inlineTokenSeed}_TOKEN_`;
  } while (source.includes(tokenPrefix));

  return tokenPrefix;
}

function renderInlineMarkdown(raw) {
  const source = String(raw);
  const tokens = [];
  const tokenPrefix = createInlineTokenPrefix(source);
  const tokenPattern = new RegExp(`${escapeRegExp(tokenPrefix)}(\\d+)@@`, 'g');
  const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${MARKDOWN_DESTINATION_PATTERN}\\)`, 'g');
  const linkPattern = new RegExp(`\\[([^\\]]+)\\]\\(${MARKDOWN_DESTINATION_PATTERN}\\)`, 'g');

  const withImageTokens = source.replace(imagePattern, (_, alt, url) => {
    const token = `${tokenPrefix}${tokens.length}@@`;
    tokens.push({ type: 'image', alt, url });
    return token;
  });

  const withMarkdownTokens = withImageTokens.replace(linkPattern, (_, label, url) => {
    const token = `${tokenPrefix}${tokens.length}@@`;
    tokens.push({ type: 'link', label, url });
    return token;
  });

  const withTokens = withMarkdownTokens.replace(/(^|[\s(])((?:https?:\/\/|mailto:|www\.)[^\s<]+)/g, (_, prefix, rawUrl) => {
    const { clean, trailing } = stripAutolinkTrailingPunctuation(rawUrl);
    if (!clean) return `${prefix}${rawUrl}`;

    const token = `${tokenPrefix}${tokens.length}@@`;
    tokens.push({ type: 'link', label: clean, url: normalizeAutolinkUrl(clean) });
    return `${prefix}${token}${trailing}`;
  });

  let html = escapeHtml(withTokens);
  html = renderAsteriskEmphasis(html);
  html = html.replace(tokenPattern, (_, index) => {
    const token = tokens[Number(index)];
    if (!token) return '';

    if (token.type === 'image') {
      const src = sanitizeImageUrl(token.url);
      if (!src) return escapeHtml(token.alt || 'Image');

      const alt = escapeHtml(token.alt || '');
      const safeSrc = escapeHtml(src);
      return `<a class="md-inline-image-link" href="${safeSrc}" target="_blank" rel="noopener noreferrer"><img class="md-inline-image" src="${safeSrc}" alt="${alt}" loading="lazy" decoding="async"></a>`;
    }

    return `<a href="${escapeHtml(sanitizeUrl(token.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.label)}</a>`;
  });

  return html;
}

export function markdownHeadingMatch(text) {
  return String(text || '').trim().match(/^(#{1,6})\s+(.+)$/u);
}

function renderHeadingLine(line) {
  const match = markdownHeadingMatch(line);
  if (!match) return renderInlineMarkdown(line);

  const level = Math.min(6, match[1].length);
  return `<div class="md-heading md-heading-${level}">${renderInlineMarkdown(match[2])}</div>`;
}

function tableCellsForLine(line) {
  const trimmed = String(line || '').trim();
  if (!/^\|.*\|$/.test(trimmed)) return null;

  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

  return cells.length >= 2 ? cells : null;
}

function isTableSeparatorCell(cell) {
  return /^:?-{1,}:?$/.test(String(cell || '').replace(/\s+/g, ''));
}

function expandCollapsedTableLine(line) {
  const indentMatch = String(line || '').match(/^(\s*)/);
  const indent = indentMatch?.[1] || '';
  const cells = tableCellsForLine(line);
  if (!cells || cells.length < 5) return [line];

  // Checkvist-style exports sometimes collapse every table row into one line
  // with empty cells as row separators; rebuild a normal markdown table first.
  const maxColumns = Math.min(20, Math.floor((cells.length + 1) / 2));
  for (let columns = 2; columns <= maxColumns; columns += 1) {
    const rows = [];
    let index = 0;
    let valid = (cells.length + 1) % (columns + 1) === 0;

    while (valid && index < cells.length) {
      const row = cells.slice(index, index + columns);
      if (row.length !== columns) {
        valid = false;
        break;
      }

      rows.push(row);
      index += columns;

      if (index >= cells.length) break;
      if (cells[index] !== '') {
        valid = false;
        break;
      }
      index += 1;
    }

    if (!valid || rows.length < 2 || !rows[1].every(isTableSeparatorCell)) continue;
    return rows.map((row) => `${indent}| ${row.join(' | ')} |`);
  }

  return [line];
}

function expandCollapsedQuoteLine(line) {
  const match = String(line || '').match(/^(\s*)(.*)$/);
  const indent = match?.[1] || '';
  const body = match?.[2] || '';
  if (!body.includes('>')) return [line];

  const parts = body
    .split(/(?: {2,}|\t+)(?=>)/)
    .map((part) => part.trimEnd())
    .filter(Boolean);

  return parts.length > 1 ? parts.map((part) => `${indent}${part}`) : [line];
}

function expandMarkdownLines(text) {
  return normalizeText(text)
    .split('\n')
    .flatMap((line) => expandCollapsedTableLine(line))
    .flatMap((line) => expandCollapsedQuoteLine(line));
}

function renderTableBlock(lines) {
  const rows = lines.map((line) => tableCellsForLine(line));
  if (rows.some((row) => !row) || rows.length < 2 || !rows[1].every(isTableSeparatorCell)) {
    return lines.map((line) => renderHeadingLine(line)).join('<br>');
  }

  const columnCount = rows[0].length;
  const header = rows[0].slice(0, columnCount);
  const body = rows.slice(2).map((row) => {
    const cells = row.slice(0, columnCount);
    while (cells.length < columnCount) cells.push('');
    return cells;
  });

  const thead = `<thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';

  return `<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`;
}

function renderListBlock(lines, options = {}) {
  const { allowSingleLinePlain = false } = options;
  const entries = parseOutlineEntries(lines);
  if (!entries.length) {
    return lines.map((line) => renderHeadingLine(line)).join('<br>');
  }

  if (allowSingleLinePlain && entries.length === 1 && lines.length === 1) {
    return renderHeadingLine(lines[0]);
  }

  const levels = indentationLevels(entries);
  const items = entries.map((entry) => ({
    level: levels.indexOf(entry.indent),
    listTag: /^[-*+]$/.test(entry.marker) ? 'ul' : 'ol',
    start: /^[-*+]$/.test(entry.marker) ? null : Number.parseInt(entry.marker, 10),
    text: entry.text
  }));

  let html = '';
  const listStack = [];

  function openList(tag, start = null) {
    const startAttr = tag === 'ol' && Number.isInteger(start) && start !== 1
      ? ` start="${start}"`
      : '';
    html += `<${tag}${startAttr}>`;
    listStack.push(tag);
  }

  function closeList() {
    const tag = listStack.pop();
    if (!tag) return;
    html += `</li></${tag}>`;
  }

  items.forEach((item, index) => {
    const text = renderInlineMarkdown(item.text).replace(/\n/g, '<br>');

    if (index === 0) {
      for (let depth = 0; depth <= item.level; depth += 1) {
        openList(item.listTag, item.start);
      }
      html += `<li>${text}`;
      return;
    }

    const previousLevel = listStack.length - 1;
    const previousTag = listStack[previousLevel];

    if (item.level > previousLevel) {
      for (let depth = previousLevel; depth < item.level; depth += 1) {
        openList(item.listTag, item.start);
      }
      html += `<li>${text}`;
      return;
    }

    if (item.level === previousLevel && item.listTag === previousTag) {
      html += `</li><li>${text}`;
      return;
    }

    for (let depth = previousLevel; depth > item.level; depth -= 1) {
      closeList();
    }

    let switchedListTag = false;
    if (listStack[listStack.length - 1] !== item.listTag) {
      closeList();
      openList(item.listTag, item.start);
      switchedListTag = true;
    }

    html += switchedListTag ? `<li>${text}` : `</li><li>${text}`;
  });

  while (listStack.length) {
    closeList();
  }

  return html;
}

export function renderMarkdown(text) {
  const normalized = normalizeText(text);
  if (!normalized.trim()) return '';

  // Render block-by-block so quotes, headings, lists, and plain paragraphs can
  // be mixed inside the same row without one format leaking into the next block.
  const lines = expandMarkdownLines(normalized);
  const nonEmptyLineCount = lines.filter((line) => line.trim()).length;
  const parts = [];
  let paragraphLines = [];
  let quoteLines = [];
  let listLines = [];
  let tableLines = [];

  function nextNonEmptyLine(startIndex) {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (lines[index].trim()) return lines[index];
    }
    return '';
  }

  function flushParagraph() {
    if (!paragraphLines.length) return;
    parts.push(paragraphLines.map((line) => renderHeadingLine(line)).join('<br>'));
    paragraphLines = [];
  }

  function flushQuote() {
    if (!quoteLines.length) return;

    const html = renderMarkdown(
      quoteLines
        .map((line) => line.replace(/^\s*>\s?/, ''))
        .join('\n')
    );

    parts.push(`<blockquote>${html}</blockquote>`);
    quoteLines = [];
  }

  function flushList() {
    if (!listLines.length) return;
    parts.push(renderListBlock(listLines, {
      allowSingleLinePlain: nonEmptyLineCount === 1 && parts.length === 0
    }));
    listLines = [];
  }

  function flushTable() {
    if (!tableLines.length) return;
    parts.push(renderTableBlock(tableLines));
    tableLines = [];
  }

  lines.forEach((line, index) => {
    if (!line.trim()) {
      const nextLine = nextNonEmptyLine(index);
      if (listLines.length && nextLine && (matchOutlineLine(nextLine) || /^\s+/.test(nextLine))) {
        listLines.push('');
        return;
      }

      flushParagraph();
      flushQuote();
      flushList();
      flushTable();
      parts.push('<br>');
      return;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      flushList();
      flushTable();
      quoteLines.push(line);
      return;
    }

    if (markdownHeadingMatch(line)) {
      flushParagraph();
      flushQuote();
      flushList();
      flushTable();
      parts.push(renderHeadingLine(line));
      return;
    }

    if (tableCellsForLine(line)) {
      flushParagraph();
      flushQuote();
      flushList();
      tableLines.push(line);
      return;
    }

    if (matchOutlineLine(line)) {
      flushParagraph();
      flushQuote();
      flushTable();
      listLines.push(line);
      return;
    }

    if (listLines.length && /^\s+/.test(line)) {
      listLines.push(line);
      return;
    }

    flushQuote();
    flushList();
    flushTable();
    paragraphLines.push(line);
  });

  flushParagraph();
  flushQuote();
  flushList();
  flushTable();
  return parts.join('');
}
