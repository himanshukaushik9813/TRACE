import { defineConfig } from "@playwright/test";

/**
 * E2E against the running stack (web :3000 → API :4000 → Sepolia/Supabase/Redis).
 * Start both first:  npm run start:server  &&  npm run build && npm run start
 *
 * Projects: "desktop" runs every spec at 1440px; "mobile" runs the UX spec
 * (navigation, tooltips, every page without console errors or overflow) at a
 * 390px touch viewport.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.TRACE_WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: /ux\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
});
