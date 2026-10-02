import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  // out/renderer is loaded from disk; without this Chromium blocks its module script (origin "null").
  use: { launchOptions: { args: ['--allow-file-access-from-files'] } },
})
