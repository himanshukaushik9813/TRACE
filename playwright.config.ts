import { defineConfig } from "@playwright/test";

/**
 * E2E against the running stack (web :3000 → API :4000 → Sepolia/Supabase/Redis).
 * Start both first:  npm run start:server  &&  npm run build && npm run start
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.TRACE_WEB_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
});
