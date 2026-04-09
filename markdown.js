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

function sanitizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^(https?:|mailto:|\/|\.{1,2}\/|#)/i.test(trimmed)) return trimmed;
  if (/^(www\.|[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$))/i.test(trimmed)) return `https://${trimmed}`;
  return '#';
}

function sanitizeImageUrl(url) {
  const trimmed = String(url || '').trim();
  return /^(https?:|data:image\/|blob:|\/|\.{1,2}\/)/i.test(trimmed) ? trimmed : '';
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

function renderInlineMarkdown(raw) {
  const tokens = [];
  const withImageTokens = String(raw).replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_, alt, url) => {
    const token = `@@TOKEN${tokens.length}@@`;
    tokens.push({ type: 'image', alt, url });
    return token;
  });

  const withMarkdownTokens = withImageTokens.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, url) => {
    const token = `@@TOKEN${tokens.length}@@`;
    tokens.push({ type: 'link', label, url });
    return token;
  });

  const withTokens = withMarkdownTokens.replace(/(^|[\s(])((?:https?:\/\/|mailto:|www\.)[^\s<]+)/g, (_, prefix, rawUrl) => {
    const { clean, trailing } = stripAutolinkTrailingPunctuation(rawUrl);
    if (!clean) return `${prefix}${rawUrl}`;

    const token = `@@TOKEN${tokens.length}@@`;
    tokens.push({ type: 'link', label: clean, url: normalizeAutolinkUrl(clean) });
    return `${prefix}${token}${trailing}`;
  });

  let html = escapeHtml(withTokens);
  html = renderAsteriskEmphasis(html);
  html = html.replace(/@@TOKEN(\d+)@@/g, (_, index) => {
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

function renderListBlock(lines) {
  const entries = parseOutlineEntries(lines);
  if (!entries.length) {
    return lines.map((line) => renderHeadingLine(line)).join('<br>');
  }

  const levels = indentationLevels(entries);
  const items = entries.map((entry) => ({
    level: levels.indexOf(entry.indent),
    listTag: /^[-*]$/.test(entry.marker) ? 'ul' : 'ol',
    text: entry.text
  }));

  let html = '';
  const listStack = [];

  function openList(tag) {
    html += `<${tag}>`;
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
        openList(item.listTag);
      }
      html += `<li>${text}`;
      return;
    }

    const previousLevel = listStack.length - 1;
    const previousTag = listStack[previousLevel];

    if (item.level > previousLevel) {
      for (let depth = previousLevel; depth < item.level; depth += 1) {
        openList(item.listTag);
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
      openList(item.listTag);
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

    if (matchOutlineLine(line)) {
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
