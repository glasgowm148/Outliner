import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ignoredFiles = new Set(['package-lock.json']);
const checkedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !ignoredFiles.has(file));

const failures = [];

function isProbablyBinary(bytes) {
  if (bytes.includes(0)) return true;
  return bytes.subarray(0, 8000).toString('utf8').includes('\uFFFD');
}

for (const file of checkedFiles) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue;
  }
  if (isProbablyBinary(bytes)) continue;

  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (/[ \t]$/.test(line)) failures.push(`${file}:${index + 1}: trailing whitespace`);
    if (/^(<<<<<<<|=======|>>>>>>>)($| )/.test(line)) failures.push(`${file}:${index + 1}: conflict marker`);
  });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Repository hygiene checks passed.');
