#!/usr/bin/env node
/**
 * Minimal, transactional SQL migration runner.
 *   node --env-file=.env.local scripts/migrate.mjs
 * Applies db/migrations/*.sql in name order, each inside a transaction,
 * recording applied files in schema_migrations. Idempotent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}
const ssl = process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
const done = new Set((await client.query(`select name from schema_migrations`)).rows.map((r) => r.name));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  const sql = readFileSync(dir + f, "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(`insert into schema_migrations (name) values ($1)`, [f]);
    await client.query("commit");
    console.log(`[migrate] applied ${f}`);
    applied++;
  } catch (err) {
    await client.query("rollback");
    console.error(`[migrate] FAILED ${f}: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}
console.log(applied ? `[migrate] ${applied} migration(s) applied` : "[migrate] up to date");
await client.end();
