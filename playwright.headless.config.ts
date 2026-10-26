import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Headless override for agent/CI runs.
 * The base config uses headless: false for local debugging in VSCode;
 * that cannot run without an attached display, so this config forces headless
 * while reusing every other base setting (projects, webServer, storageState).
 */
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    headless: true,
  },
  projects: base.projects?.map((project) => ({
    ...project,
    use: {
      ...project.use,
      headless: true,
    },
  })),
});
