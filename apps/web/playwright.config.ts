import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 30_000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3000', headless: true, browserName: 'chromium', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] }, permissions: ['microphone'] },
  webServer: { command: 'npm run dev --workspace @voicebridge/web', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 30000 },
});
