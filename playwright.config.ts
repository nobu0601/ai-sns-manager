import { defineConfig } from "@playwright/test";

// E2E テスト。事前に `npm run build` と DB・Redis の起動が必要。
// アプリ（npm run start）と Worker は自動起動される（アプリが起動済みなら再利用）
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: { command: "npm run start", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
