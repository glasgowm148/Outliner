import test from 'node:test';
import assert from 'node:assert/strict';

import { comparableRowLabel, markdownHeadingMatch, renderMarkdown, rowLabel, slugify } from '../../markdown.js';

test('comparableRowLabel strips common markdown formatting before comparison', () => {
  assert.equal(
    comparableRowLabel('### **[Moral Framework](https://example.com):**'),
    'moral framework'
  );
});

test('rowLabel returns the first logical line and slugify creates stable filenames', () => {
  assert.equal(rowLabel('First line\nSecond line'), 'First line');
  assert.equal(slugify('  Export Me / Please  '), 'export-me-please');
});

test('markdownHeadingMatch recognizes standard headings', () => {
  const match = markdownHeadingMatch('#### Heading');
  assert.equal(match?.[1], '####');
  assert.equal(match?.[2], 'Heading');
});

test('renderMarkdown sanitizes unsafe markdown links', () => {
  assert.equal(
    renderMarkdown('[bad](javascript:alert(1))'),
    '<a href="#" target="_blank" rel="noopener noreferrer">bad</a>'
  );
});

test('renderMarkdown falls back to alt text for unsafe images', () => {
  assert.equal(
    renderMarkdown('![diagram](javascript:alert(1))'),
    'diagram'
  );
});

test('renderMarkdown keeps mixed block types isolated from each other', () => {
  assert.equal(
    renderMarkdown('Paragraph\n\n> Quote\n> - item\n\n### Heading\n\n1. One\n\n2. Two'),
    'Paragraph<br><blockquote>Quote<ul><li>item</li></ul></blockquote><br><div class="md-heading md-heading-3">Heading</div><br><ol><li>One</li><li>Two</li></ol>'
  );
});
