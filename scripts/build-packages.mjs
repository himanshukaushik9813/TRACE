#!/usr/bin/env node
/**
 * Build all engine packages to dist/ in dependency order, offline.
 *
 * Each package's tsconfig.build.json points "paths" at the *source* of its
 * @trace/* deps. We do a two-phase build:
 *
 *   Phase 1 — tsc with noEmit, per package, resolving @trace/* to their
 *             SOURCE. This strict-checks every file against its real imports
 *             (catches genuine type errors, not stub-vs-source drift).
 *   Phase 2 — tsc with noEmit=false emitting to dist/, but rewriting each
 *             @trace/* import to the sibling package's DIST output so the
 *             emitted JS resolves at runtime (like real workspaces do).
 *
 * Ambient stubs are owned by each package: a package that imports an external
 * runtime (viem, node:crypto, express/pg/bullmq) already lists its .d.ts stub
 * in its own tsconfig.build.json include. We never clobber cfg.include, so the
 * package-specific stubs survive both phases.
 *
 * Real, network-connected builds just `npm install` (workspaces symlink the
 * @trace/* packages and install viem/express/pg/bullmq); then tsc's `paths`
 * still resolves the @trace/* to source and everything works unchanged.
 *
 * `@trace/server` is intentionally NOT built here: it has no tsconfig.build.json
 * and depends on express/pg/bullmq/ioredis, which only exist after a real
 * `npm install`. It is type-checked separately (tsconfig.server.json).
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Strict dependency order: every entry may only depend on earlier ones.
const order = [
  "strategy-ir",
  "uniswap-v3",
  "strategy-inference",
  "backtester",
  "aqua-adapter",
  "world-auth",
  "zero-g-storage",
  "chain-data",
];

function tsc(pkg, extra) {
  execSync(`cd "${root}packages/${pkg}" && tsc -p tsconfig.build.json ${extra}`, {
    stdio: "inherit",
  });
}

for (const pkg of order) {
  const dir = root + "packages/" + pkg;
  const cfgPath = dir + "/tsconfig.build.json";
  if (!existsSync(cfgPath)) continue;

  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

  // Phase 1: strict check against source deps. Keep the package's own include
  // (it already lists its ambient stubs, e.g. chain-data → ../types/viem.d.ts).
  const checkCfgPath = dir + "/tsconfig.check.json";
  cfg.compilerOptions.noEmit = true;
  writeFileSync(checkCfgPath, JSON.stringify(cfg, null, 2));
  try {
    execSync(`cd "${dir}" && tsc -p tsconfig.check.json`, { stdio: "inherit" });
  } finally {
    rmSync(checkCfgPath, { force: true });
  }

  // Phase 2: emit dist/. Point @trace/* imports at the sibling dist so the
  // runtime resolution is by prebuilt output (matches how workspaces consume
  // packages). The include is left untouched, so package ambient stubs stay.
  for (const [k] of Object.entries(cfg.compilerOptions.paths || {})) {
    const dep = k.replace("@trace/", "");
    if (dep !== pkg) cfg.compilerOptions.paths[k] = [`../${dep}/dist`];
  }
  cfg.compilerOptions.noEmit = false;
  rmSync(dir + "/dist", { recursive: true, force: true });
  tsc(pkg, "");
  console.log(`[build] ${pkg} → dist/ ok`);
}

console.log("[build] all engine packages emitted to dist/");
