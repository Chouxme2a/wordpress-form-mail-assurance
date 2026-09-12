import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  use: {
    baseURL: process.env.WFMA_APP_URL || "https://wp-form-mail-assurance.wordpress-form-mail-assurance.workers.dev",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
