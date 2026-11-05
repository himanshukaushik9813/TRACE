#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TRACE — one-command full-stack runner (macOS)
#
#   bash scripts/run-fullstack.sh
#
# What it does, in order:
#   1. Auto-detect a running Postgres (starts a Homebrew service if stopped)
#   2. Ensure the `trace` database exists and the schema is loaded
#      (schema.sql uses plain CREATE TABLE, so this step is idempotent-tolerant)
#   3. Find a working DATABASE_URL by probing candidates (your machine's
#      Postgres has no `postgres` role — a plain-user URL is the fallback)
#   4. Auto-detect / start Redis (redis-server binary → docker → brew)
#   5. Build engine packages + server if dist/ is missing or stale
#   6. Start api+worker on :4000 (Ctrl+C stops it)
#
# Afterwards, in a second terminal:
#   echo 'NEXT_PUBLIC_TRACE_API_URL=http://localhost:4000' > .env.local
#   npm run dev
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ME="$(whoami)"
REDIS_URL="redis://localhost:6379"

log()  { printf '\033[36m[fullstack]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[fullstack]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[fullstack]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[fullstack] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

port_open() { # port_open <port>
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; } || return 1
}

# ---------------------------------------------------------------- 1. Postgres
if port_open 5432; then
  ok "Postgres is up on :5432"
else
  warn "Postgres not reachable on :5432 — trying to start it"
  started=0
  if command -v pg_ctl >/dev/null 2>&1; then
    pg_ctl -D "$(brew --prefix 2>/dev/null)/var/postgresql@17" start 2>/dev/null || \
    pg_ctl -D "$(brew --prefix 2>/dev/null)/var/postgresql" start 2>/dev/null && started=1
  fi
  if [ "$started" -eq 0 ] && command -v brew >/dev/null 2>&1; then
    for f in $(brew list --versions 2>/dev/null | grep -o 'postgresql[^ ]*' | sort -u); do
      brew services start "$f" >/dev/null 2>&1 && { started=1; ok "started brew service: $f"; break; }
    done
  fi
  sleep 2
  port_open 5432 || die "Postgres is not running and I could not start it.
  Install/start it manually (brew services start postgresql@17) and re-run."
  ok "Postgres is up"
fi

command -v psql >/dev/null 2>&1 || die "psql not found in PATH (expected /usr/local/bin/psql or /opt/homebrew/bin/psql)."

# ---------------------------------------------------------------- 2. DB + schema
createdb trace >/dev/null 2>&1 || true
psql -d trace -f db/schema.sql >/dev/null 2>&1 || true
if psql -d trace -tAc "select 1 from investigations limit 1" >/dev/null 2>&1; then
  ok "schema present (investigations table found)"
else
  warn "loading schema fresh"
  psql -d trace -v ON_ERROR_STOP=0 -f db/schema.sql | grep -vE 'already exists|ERROR|HINT|DETAIL|CONTEXT|^\s*$|^--' || true
  psql -d trace -tAc "select 1 from investigations limit 1" >/dev/null 2>&1 \
    || die "schema still missing in db `trace` — run `psql trace -f db/schema.sql` manually."
fi

# ---------------------------------------------------------------- 3. DATABASE_URL
probe_url() { psql "$1" -c "select 1" >/dev/null 2>&1; }
DB_URL="${DATABASE_URL:-}"
CANDIDATES=(
  "postgres://$ME@localhost:5432/trace"
  "postgres://postgres:postgres@localhost:5432/trace"
  "postgres://localhost:5432/trace"
)
[ -n "$DB_URL" ] || DB_URL=""
for c in ${DB_URL:+$DB_URL} "${CANDIDATES[@]}"; do
  [ -n "$c" ] || continue
  if probe_url "$c"; then DB_URL="$c"; break; fi
done
[ -n "$DB_URL" ] || die "no working Postgres connection string. Set DATABASE_URL manually, e.g.
  export DATABASE_URL=postgres://$ME@localhost:5432/trace"
ok "DATABASE_URL: $DB_URL"

# ---------------------------------------------------------------- 4. Redis
if port_open 6379; then
  ok "Redis is up on :6379"
else
  warn "Redis not reachable on :6379 — trying to start it"
  if command -v redis-server >/dev/null 2>&1; then
    redis-server --daemonize yes && sleep 1
  elif command -v docker >/dev/null 2>&1 && docker ps >/dev/null 2>&1; then
    docker rm -f trace-redis >/dev/null 2>&1
    docker run -d --name trace-redis -p 6379:6379 redis:7 >/dev/null \
      && ok "started Redis via docker (container: trace-redis)"
  elif command -v brew >/dev/null 2>&1 && brew list --versions 2>/dev/null | grep -q redis; then
    brew services start redis >/dev/null 2>&1 && sleep 1
  fi
  port_open 6379 && ok "Redis is up on :6379" || warn "Redis unavailable — the server will fall back to its in-memory queue (no job durability, /health reports 'queue: in-memory'). Start Redis later for the durable BullMQ path."
fi

# ---------------------------------------------------------------- 5. Build
# Pass --rebuild to force recompiling engine packages + server after source
# changes:  bash scripts/run-fullstack.sh --rebuild
#
# Note: `npm run build:server` reports 4 known type-stub errors
# (@types/express + @types/pg not declared) but still emits JS — so we
# validate the emitted file instead of trusting tsc's exit code.
do_build() {
  log "building engine packages + server"
  npm run build:server >/dev/null 2>&1 || warn "tsc reported type errors (known @types/express + @types/pg stubs) — checking the emitted output"
  node --check server/dist/index.js 2>/dev/null || die "server/dist/index.js is missing or invalid — run 'npm run build:server' and fix the errors it prints."
  ok "build complete (server/dist verified)"
}

if [ "$1" = "--rebuild" ] || [ ! -f server/dist/index.js ] || [ ! -f packages/uniswap-v3/dist/index.js ]; then
  do_build
else
  ok "builds present — skipping (run 'bash scripts/run-fullstack.sh --rebuild' after source edits)"
fi

# ---------------------------------------------------------------- 6. Run
log "starting api+worker on :4000 (Ctrl+C to stop — keep this terminal open)"
exec env DATABASE_URL="$DB_URL" REDIS_URL="$REDIS_URL" node server/dist/index.js
