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
        text: outlineMatch[2]
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
    .replace(/^\*\*(.*)\*\*$/u, '$1')
    .replace(/^\*(.*)\*$/u, '$1')
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
