import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4311;
const ROOT_DIR = path.resolve('.');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tests/e2e/start-server.mjs',
    url: `http://127.0.0.1:${PORT}`,
    timeout: 30_000,
    reuseExistingServer: false,
    cwd: ROOT_DIR
  }
});
