import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, '..', '..');
const TEMP_DIR = path.join(ROOT_DIR, '.tmp', 'playwright');
const DB_PATH = path.join(TEMP_DIR, 'outliner.sqlite');

fs.rmSync(TEMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

process.env.HOST = '127.0.0.1';
process.env.PORT = '4311';
process.env.OUTLINER_DB_PATH = DB_PATH;

await import(pathToFileURL(path.join(ROOT_DIR, 'server.js')).href);
