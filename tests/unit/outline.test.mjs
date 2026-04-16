import test from 'node:test';
import assert from 'node:assert/strict';

import { createRow } from '../../public/storage.js';
import { comparableRowLabel } from '../../public/markdown.js';
import { mergeParsedRowsIntoContext, parsePastedRows } from '../../public/outline.js';

function ancestorIndexes(index, rows) {
  if (index < 0 || index >= rows.length) return [];
  const path = [index];
  let level = rows[index].level;

  for (let i = index - 1; i >= 0; i -= 1) {
    if (rows[i].level < level) {
      path.unshift(i);
      level = rows[i].level;
      if (level === 0) break;
    }
  }

  return path;
}

test('parsePastedRows prefers strict tab outlines when indentation is explicit', () => {
  const rows = parsePastedRows('All\n\tNutrition\n\t\tProtein\n\tDisease', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'All', level: 0 },
      { text: 'Nutrition', level: 1 },
      { text: 'Protein', level: 2 },
      { text: 'Disease', level: 1 }
    ]
  );
});

test('parsePastedRows keeps markdown prelude as the parent row for following list items', () => {
  const rows = parsePastedRows('Intro\n- Child\n  - Grandchild\n  continuation', 0);
  assert.deepEqual(
    rows.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'Intro', level: 0 },
      { text: 'Child', level: 1 },
      { text: 'Grandchild\ncontinuation', level: 2 }
    ]
  );
});

test('mergeParsedRowsIntoContext drops a repeated root container during re-import', () => {
  const allRows = [createRow('All', 0)];
  const parsedRows = parsePastedRows('- All\n  - Nutrition\n  - Disease', 0);

  const merged = mergeParsedRowsIntoContext(0, parsedRows, allRows, {
    ancestorIndexes,
    comparableRowLabel
  });

  assert.deepEqual(
    merged.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'Nutrition', level: 1 },
      { text: 'Disease', level: 1 }
    ]
  );
});

test('mergeParsedRowsIntoContext drops repeated nested ancestors and keeps descendants', () => {
  const allRows = [
    createRow('All', 0),
    createRow('Ethics', 1),
    createRow('Resources', 2)
  ];
  const parsedRows = parsePastedRows('- Ethics\n  - Resources\n    - Links\n    - Quotes', 2);

  const merged = mergeParsedRowsIntoContext(2, parsedRows, allRows, {
    ancestorIndexes,
    comparableRowLabel
  });

  assert.deepEqual(
    merged.map((row) => ({ text: row.text, level: row.level })),
    [
      { text: 'Links', level: 3 },
      { text: 'Quotes', level: 3 }
    ]
  );
});
