import assert from 'node:assert/strict';

import { normalizeDbObject } from '../storage.js';
import { renderMarkdown, comparableRowLabel } from '../markdown.js';
import { mergeParsedRowsIntoContext, parsePastedRows } from '../outline.js';

function summarize(rows) {
  return rows.map((row) => ({ level: row.level, text: row.text }));
}

function ancestorIndexes(index, rows) {
  const path = [];
  let currentLevel = rows[index].level;

  for (let i = index; i >= 0; i -= 1) {
    if (rows[i].level === currentLevel) {
      path.unshift(i);
      currentLevel -= 1;
    }
    if (currentLevel < 0) break;
  }

  return path;
}

{
  const rows = parsePastedRows(`Full

- **🛣️ Guidance**
   - **DSM-5** CheckList
   - **❗Identify your issues**

🗂️ **Organization and Planning**

🧑‍🎓**Studies**

📌 **Resources**`, 0);

  assert.deepEqual(summarize(rows), [
    { level: 0, text: 'Full' },
    { level: 1, text: '**🛣️ Guidance**' },
    { level: 2, text: '**DSM-5** CheckList' },
    { level: 2, text: '**❗Identify your issues**' },
    { level: 1, text: '🗂️ **Organization and Planning**' },
    { level: 1, text: '🧑‍🎓**Studies**' },
    { level: 1, text: '📌 **Resources**' }
  ]);
}

{
  const rows = parsePastedRows(`**Common Arguments**
- **Humane Treatment**
   - **Logic**
      - Useful starter argument:
To assess:
- **Validity**
**Hunting**`, 0);

  assert.deepEqual(summarize(rows), [
    { level: 0, text: '**Common Arguments**' },
    { level: 1, text: '**Humane Treatment**' },
    { level: 2, text: '**Logic**' },
    { level: 3, text: 'Useful starter argument:' },
    { level: 3, text: 'To assess:' },
    { level: 4, text: '**Validity**' },
    { level: 0, text: '**Hunting**' }
  ]);
}

{
  const parsedRows = parsePastedRows(`Full

- **🛣️ Guidance**
   - **DSM-5** CheckList
   - **❗Identify your issues**

🗂️ **Organization and Planning**

🧑‍🎓**Studies**

📌 **Resources**`, 1);

  const merged = mergeParsedRowsIntoContext(
    0,
    parsedRows,
    [
      { id: 'full', text: 'Full', level: 0 },
      { id: 'blank', text: '', level: 1 }
    ],
    { ancestorIndexes, comparableRowLabel }
  );

  assert.deepEqual(summarize(merged), [
    { level: 1, text: '**🛣️ Guidance**' },
    { level: 2, text: '**DSM-5** CheckList' },
    { level: 2, text: '**❗Identify your issues**' },
    { level: 1, text: '🗂️ **Organization and Planning**' },
    { level: 1, text: '🧑‍🎓**Studies**' },
    { level: 1, text: '📌 **Resources**' }
  ]);
}

{
  assert.equal(
    renderMarkdown('- A\n1. B\n2. C\n- D'),
    '<ul><li>A</li></ul><ol><li>B</li><li>C</li></ol><ul><li>D</li></ul>'
  );
}

{
  const db = normalizeDbObject({
    currentId: 'list-1',
    lists: [
      {
        id: 'list-1',
        name: 'Test',
        rows: [
          { id: 'row-1', text: 'Root', level: 0 },
          { id: 'row-2', text: 'Impossible jump', level: 4 },
          { id: 'row-2', text: 'Duplicate id', level: 7 }
        ]
      }
    ]
  });

  assert.deepEqual(
    db.lists[0].rows.map((row) => row.level),
    [0, 1, 2]
  );
  assert.equal(new Set(db.lists[0].rows.map((row) => row.id)).size, 3);
}

console.log('Outline parser regression checks passed.');
