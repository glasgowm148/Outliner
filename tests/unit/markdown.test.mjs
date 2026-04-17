import test from 'node:test';
import assert from 'node:assert/strict';

import { comparableRowLabel, markdownHeadingMatch, renderMarkdown, rowLabel, slugify } from '../../public/markdown.js';

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
    '<a href="#" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">bad</a>'
  );
  assert.equal(
    renderMarkdown('[external](//example.com/path)'),
    '<a href="#" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">external</a>'
  );
});

test('renderMarkdown supports emphasis inside markdown link labels', () => {
  assert.equal(
    renderMarkdown('[**Study of L-Dopa in ADHD and RLS/PLMS**](https://grantome.com/grant/NIH/R01-NS040829-03)'),
    '<a href="https://grantome.com/grant/NIH/R01-NS040829-03" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><strong>Study of L-Dopa in ADHD and RLS/PLMS</strong></a>'
  );
});

test('renderMarkdown suppresses referrers for external links and images', () => {
  const link = renderMarkdown('[docs](https://example.com)');
  assert.match(link, /rel="noopener noreferrer"/);
  assert.match(link, /referrerpolicy="no-referrer"/);

  const image = renderMarkdown('![diagram](https://example.com/image.png)');
  assert.match(image, /<a[^>]+referrerpolicy="no-referrer"/);
  assert.match(image, /<img[^>]+referrerpolicy="no-referrer"/);
});

test('renderMarkdown falls back to alt text for unsafe images', () => {
  assert.equal(
    renderMarkdown('![diagram](javascript:alert(1))'),
    'diagram'
  );
  assert.equal(
    renderMarkdown('![diagram](//example.com/image.png)'),
    'diagram'
  );
  assert.equal(
    renderMarkdown('![diagram](data:image/svg+xml,<svg></svg>)'),
    'diagram'
  );
});

test('renderMarkdown keeps mixed block types isolated from each other', () => {
  assert.equal(
    renderMarkdown('Paragraph\n\n> Quote\n> - item\n\n### Heading\n\n1. One\n\n2. Two'),
    'Paragraph<br><blockquote>Quote<ul><li>item</li></ul></blockquote><br><div class="md-heading md-heading-3">Heading</div><br><ol><li>One</li><li>Two</li></ol>'
  );
});

test('renderMarkdown does not eat literal token-like text', () => {
  const literalTokens = Array.from(
    { length: 200 },
    (_, index) => `@@OUTLINER_${index + 1}_TOKEN_0@@`
  ).join(' ');

  assert.equal(
    renderMarkdown('Literal @@TOKEN0@@ text'),
    'Literal @@TOKEN0@@ text'
  );

  const rendered = renderMarkdown(`${literalTokens} [safe](https://example.com)`);
  assert.ok(rendered.includes('@@OUTLINER_1_TOKEN_0@@'));
  assert.ok(rendered.includes('@@OUTLINER_200_TOKEN_0@@'));
  assert.ok(rendered.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">safe</a>'));
});

test('renderMarkdown keeps balanced parentheses in autolinks', () => {
  assert.equal(
    renderMarkdown('See https://example.com/foo(bar)'),
    'See <a href="https://example.com/foo(bar)" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">https://example.com/foo(bar)</a>'
  );
});

test('renderMarkdown preserves ordered list start numbers', () => {
  assert.equal(
    renderMarkdown('3. Three\n4. Four'),
    '<ol start="3"><li>Three</li><li>Four</li></ol>'
  );
});
