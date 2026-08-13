#!/usr/bin/env bash
#
# One-command test deploy: Supabase + Cloudflare Workers.
#
# Everything DEPLOYMENT.md describes, in order, with the RLS step impossible
# to skip. Run it from a machine where `npx wrangler login` has been done.
#
# Required environment (put them in .deploy.env, which is gitignored):
#
#   DATABASE_URL   Supabase transaction pooler (port 6543,
#                  ...?pgbouncer=true&connection_limit=1)
#   DIRECT_URL     Supabase direct connection (port 5432)
#   OTP_PEPPER     openssl rand -base64 32
#
# Optional (photo storage — omit both blocks below to fail fast instead):
#   S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE_URL
#
# Optional (SMS — omit to use the console escape hatch for testing):
#   AT_API_KEY AT_USERNAME AT_SENDER_ID
#
#   SEED_ADMIN_PHONE   e.g. 71000000 — creates a test admin
#
# Usage:
#   cp .deploy.env.example .deploy.env  &&  edit it
#   ./scripts/deploy.sh

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .deploy.env ]]; then
  set -a; source .deploy.env; set +a
fi

fail() { echo "✗ $1" >&2; exit 1; }
step() { echo; echo "━━ $1"; }

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is not set (Supabase pooler, port 6543)"
[[ -n "${DIRECT_URL:-}"   ]] || fail "DIRECT_URL is not set (Supabase direct, port 5432)"
[[ -n "${OTP_PEPPER:-}"   ]] || fail "OTP_PEPPER is not set (openssl rand -base64 32)"
[[ "${#OTP_PEPPER}" -ge 16 ]] || fail "OTP_PEPPER must be at least 16 characters"
[[ "$DATABASE_URL" == *6543* ]] || echo "⚠ DATABASE_URL does not look like the 6543 pooler — check it"
[[ "$DIRECT_URL"   == *5432* ]] || echo "⚠ DIRECT_URL does not look like the 5432 direct port — check it"
# The database is shared with another application in public. Prisma finds its
# migration history through ?schema=kraal; without it, migrate deploy would try
# to re-apply the whole schema into public, on top of the other app. Hard stop.
[[ "$DIRECT_URL" == *schema=kraal* ]] || fail "DIRECT_URL must include ?schema=kraal (shared database — see .deploy.env.example)"
[[ "$DATABASE_URL" == *kraal_app* ]] || echo "⚠ DATABASE_URL does not use the kraal_app role — runtime queries will not resolve the kraal schema"

# Which schema Prisma addresses. The role's server-side search_path covers raw
# SQL only; Prisma's model queries are schema-qualified explicitly and default
# to `public` whatever the search_path says. DIRECT_URL is the source of truth
# because ?schema= is mandatory there and already validated above.
DB_SCHEMA="$(sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p' <<<"$DIRECT_URL")"
export DB_SCHEMA
[[ -n "$DB_SCHEMA" ]] || fail "Could not read the schema from DIRECT_URL"

npx wrangler whoami > /dev/null 2>&1 || fail "wrangler is not logged in. Run: npx wrangler login"

# psql speaks libpq, which rejects Prisma's query parameters outright — it errors
# on the URI rather than ignoring what it does not know. Drop them for psql;
# Prisma keeps the full URL.
psql_url() {
  local url="$1" base out= kv
  base="${url%%\?*}"
  if [[ "$url" == *\?* ]]; then
    local IFS='&'
    for kv in ${url#*\?}; do
      case "$kv" in schema=*|pgbouncer=*|connection_limit=*) continue ;; esac
      out="${out:+$out&}$kv"
    done
  fi
  printf '%s%s' "$base" "${out:+?$out}"
}

# Supabase's poolers are multi-tenant and route on the USERNAME, so it must
# carry the project ref as a suffix: postgres.<ref>, kraal_app.<ref>. A plain
# username matches no tenant and is rejected as "password authentication
# failed" — which reads like a wrong password and sends you looking in entirely
# the wrong place. Catch it here, where the fix can be spelled out.
check_pooler_user() {
  local name="$1" url="$2" user
  [[ "$url" == *pooler.supabase.com* ]] || return 0
  user="${url#*://}"; user="${user%%:*}"
  [[ "$user" == *.* ]] && return 0
  fail "$name connects to the pooler as '$user', with no project ref.

  Pooler usernames are tenant-qualified. Change the username to:
    $user.<project-ref>          e.g. $user.hqnwxckuptagvsizanho

  Everything else in the URL stays as it is. Copy the exact URI from:
  Supabase dashboard → Connect → (Session pooler for DIRECT_URL,
  Transaction pooler for DATABASE_URL)."
}

# Validate BOTH before spending a connection on either: a run that clears the
# migration URL only to fail on the runtime URL five minutes later costs another
# whole round trip, and these are the same two mistakes each time.
check_pooler_user DIRECT_URL   "$DIRECT_URL"
check_pooler_user DATABASE_URL "$DATABASE_URL"

PSQL_DIRECT="$(psql_url "$DIRECT_URL")"
PSQL_RUNTIME="$(psql_url "$DATABASE_URL")"

# Supabase's direct host (db.<ref>.supabase.co) resolves to IPv6 ONLY, and most
# CI runners — GitHub Actions included — have no IPv6 route. Diagnose it here
# rather than leaving a bare "Network is unreachable".
problem() { echo "✗ $1" >&2; }

preflight() {
  local name="$1" url="$2" role err attempt=0 max=5

  # Supabase's pooler caches each role's credentials, so a connection made
  # seconds after ALTER ROLE can still be checked against the old password and
  # rejected. That is indistinguishable from a genuinely wrong password on the
  # first attempt, and it is the difference between two consecutive deploys
  # disagreeing about the same credential. Retry the auth failures; everything
  # else fails immediately, because no amount of waiting fixes a bad hostname.
  while :; do
    if err="$(psql "$url" -qc 'SELECT 1' 2>&1 >/dev/null)"; then
      [[ "$attempt" == "0" ]] && echo "✓ $name connects" \
                              || echo "✓ $name connects (after ${attempt} retries — stale pooler credentials)"
      return 0
    fi
    case "$err" in
      # The third of these is Supavisor rejecting its OWN cached pool after the
      # role's password changed underneath it. It says so, and it recovers on
      # reconnection — but the wording shares nothing with the other two, so it
      # has to be matched separately.
      *"password authentication failed"*|*"Tenant or user not found"*|*"Authentication credentials are invalid"*)
        attempt=$((attempt + 1))
        if [[ "$attempt" -lt "$max" ]]; then
          echo "  … $name rejected, retrying in 8s [${attempt}/$((max - 1))]"
          sleep 8
          continue
        fi ;;
    esac
    break
  done

  # Surface what psql actually said — an earlier version swallowed it and left
  # "cannot reach the database" with no cause, which is nearly useless.
  echo "psql said: $err" >&2

  if [[ "$url" == *db.*.supabase.co* ]]; then
    problem "Cannot reach the database with $name.

  It points at db.<ref>.supabase.co, which Supabase serves over IPv6 only.
  GitHub Actions runners have no IPv6 route, so this can never connect from CI.

  Use a POOLER host instead — the session pooler (5432) supports everything a
  direct connection does, DDL and prepared statements included:

    postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=kraal

  Copy the exact host from: Supabase dashboard → Connect."
    return 1
  fi

  role="${url#*://}"; role="${role%%:*}"; role="${role%%.*}"
  case "$err" in
    *"Tenant or user not found"*|*"password authentication failed"*)
      # The pooler reports the BARE role name even for a tenant-qualified
      # login, so this error reads identically whether the project-ref suffix
      # is missing or the password is wrong. The suffix is checked before we
      # get here, so this is the password — and which password that is depends
      # on the role, which is the part people get wrong:
      local hint
      if [[ "$role" == postgres ]]; then
        hint="  'postgres' authenticates with the PROJECT DATABASE PASSWORD, set in
  Supabase dashboard → Settings → Database. Setting some other role's password
  does not change it. Reset it there if you do not know it, or set it directly
  in the SQL editor:  ALTER ROLE postgres WITH PASSWORD '...';"
      else
        hint="  '$role' is created without a usable password. Set one, once, in the
  Supabase SQL editor:  ALTER ROLE $role PASSWORD '...';"
      fi
      problem "The database rejected $name's password (role: $role), and still did
  after $((max - 1)) retries — so this is not the pooler serving a stale credential.

$hint

  Then percent-encode it in the URL: @ → %40, # → %23, / → %2F, : → %3A.
  An unencoded @ silently truncates the host and gives this same error."
      return 1 ;;
    *"could not translate host name"*|*"Name or service not known"*)
      problem "$name's hostname does not resolve. The region prefix is often
  aws-0- or aws-1- and varies by project — copy the exact host from:
  Supabase dashboard → Connect."
      return 1 ;;
    *)
      problem "Cannot reach the database with $name (see psql error above).
  Check the host, the password encoding, and that the project is not paused."
      return 1 ;;
  esac
}

# Credential repair, attempted only when something is actually broken.
#
# This used to run unconditionally, before every deploy, and that was the cause
# of its own failures: ALTER ROLE invalidates the pooler's cached credentials,
# so "fixing" a password that was already correct made the next connection fail
# with exactly the error the repair exists to prevent. Repair on failure, not
# on principle.
repair() {
  [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || return 1
  echo "→ attempting repair through the Supabase API"
  python3 scripts/db-bootstrap.py
}

# DATABASE_URL is what the application runs on. Without it there is nothing to
# deploy, so its failure is fatal.
if ! preflight DATABASE_URL "$PSQL_RUNTIME"; then
  repair || fail "DATABASE_URL is unusable — the application cannot run without it. Nothing was changed."
  preflight DATABASE_URL "$PSQL_RUNTIME" \
    || fail "DATABASE_URL is still unusable after repair. Nothing was changed."
fi

# DIRECT_URL is only ever used for schema administration: creating the
# extension, applying migrations, forcing RLS. All three need privileges the
# runtime role deliberately does not have.
#
# Its absence does not have to stop a deploy. What matters is not that this
# script PERFORMED those steps, but that the database is in the state they
# would produce — and every one of those states is READABLE by the runtime
# role. So when DIRECT_URL is unusable, each administrative step becomes an
# assertion instead of an action, and a failed assertion still stops the
# deploy. The guarantee is unchanged; only who has to be able to write is.
DB_ADMIN=1
preflight DIRECT_URL "$PSQL_DIRECT" || DB_ADMIN=0
if [[ "$DB_ADMIN" == "0" ]]; then
  echo
  echo "⚠ Continuing WITHOUT schema-administration privileges."
  echo "  The steps below are verified rather than applied. Anything already"
  echo "  out of place will stop the deploy — it just cannot be repaired here."
fi

step "1/7 PostGIS + migrations"
if [[ "$DB_ADMIN" == "1" ]]; then
  psql "$PSQL_DIRECT" -qc 'CREATE EXTENSION IF NOT EXISTS postgis;'
  npx prisma migrate deploy
else
  HAS_POSTGIS=$(psql "$PSQL_RUNTIME" -tAc "SELECT count(*) FROM pg_extension WHERE extname='postgis'")
  [[ "$HAS_POSTGIS" == "1" ]] || fail "PostGIS is not installed and cannot be installed without DIRECT_URL."
  echo "✓ PostGIS present"

  # Prisma records each applied migration by folder name. Comparing the
  # folders on disk against that table says whether this build's schema is
  # the one the database actually has — which is the only thing `migrate
  # deploy` would have told us here anyway, since it is a no-op when there is
  # nothing pending.
  APPLIED=$(psql "$PSQL_RUNTIME" -tAc \
    "SELECT migration_name FROM kraal._prisma_migrations WHERE finished_at IS NOT NULL")

  # An unmatched glob would otherwise expand to the literal pattern, fail the
  # -f test, and leave the loop with nothing to compare — reporting success
  # for having checked no migrations at all. A verification that passes
  # vacuously is worse than no verification, because it reads as a guarantee.
  shopt -s nullglob
  MIGRATIONS=(prisma/migrations/*/)
  shopt -u nullglob
  [[ "${#MIGRATIONS[@]}" -gt 0 ]] || fail "No migration folders under prisma/migrations — refusing to report the schema as verified."

  PENDING=""
  for dir in "${MIGRATIONS[@]}"; do
    [[ -f "$dir/migration.sql" ]] || continue
    name=$(basename "$dir")
    grep -qxF "$name" <<<"$APPLIED" || PENDING="$PENDING $name"
  done
  [[ -z "$PENDING" ]] || fail "Unapplied migration(s):$PENDING
  These need DIRECT_URL — applying schema changes is exactly the privilege the
  runtime role does not have. Fix the migration credential and re-run."
  echo "✓ every migration on disk is applied ($(wc -l <<<"$APPLIED" | tr -d ' ') recorded)"
fi

step "2/7 Deny-all RLS on the kraal schema"
if [[ "$DB_ADMIN" == "1" ]]; then
  # Scoped STRICTLY to the kraal schema. This database is shared with another
  # application in public; the public-scoped rls_deny_all.sql must NEVER run here.
  psql "$PSQL_DIRECT" -q <<'SQL'
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='kraal' LOOP
    EXECUTE format('ALTER TABLE kraal.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE kraal.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kraal_app_all ON kraal.%I', t);
    EXECUTE format('CREATE POLICY kraal_app_all ON kraal.%I FOR ALL TO kraal_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA kraal TO kraal_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kraal TO kraal_app;
REVOKE ALL ON ALL TABLES IN SCHEMA kraal FROM anon, authenticated;
SQL
fi

# This check runs either way, and it is the part that actually matters. A table
# with RLS off is readable by Supabase's public `anon` key — session tokens, OTP
# hashes, the trust ledger, every farmer's phone number. pg_tables is readable
# by any role, so the runtime connection can confirm it unaided.
UNPROTECTED=$(psql "$PSQL_RUNTIME" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='kraal' AND NOT rowsecurity")
if [[ "$UNPROTECTED" != "0" ]]; then
  [[ "$DB_ADMIN" == "1" ]] && fail "$UNPROTECTED kraal table(s) still have RLS off — refusing to continue"
  fail "$UNPROTECTED kraal table(s) have RLS OFF, and it cannot be turned on without DIRECT_URL.

  Refusing to deploy. Those tables are exposed to Supabase's public anon key.
  Either restore the migration credential and re-run, or run this in the SQL
  editor:

    ALTER TABLE kraal.<table> ENABLE ROW LEVEL SECURITY;
    ALTER TABLE kraal.<table> FORCE ROW LEVEL SECURITY;
    CREATE POLICY kraal_app_all ON kraal.<table>
      FOR ALL TO kraal_app USING (true) WITH CHECK (true);"
fi
echo "✓ RLS on every kraal table ($([[ "$DB_ADMIN" == "1" ]] && echo "forced and policy refreshed" || echo "verified"))"

# The most dangerous silent failure in this deployment: kraal_app connecting
# with a default search_path, so every unqualified query lands in public — on
# top of the unrelated application living there. Nothing errors; it just writes
# to the wrong database. Ask the runtime connection itself, through the same
# pooler the worker uses, rather than trusting that the role was configured.
RUNTIME_PATH=$(psql "$PSQL_RUNTIME" -tAc 'SHOW search_path')
if [[ "$RUNTIME_PATH" != *kraal* ]] && repair; then
  RUNTIME_PATH=$(psql "$PSQL_RUNTIME" -tAc 'SHOW search_path')
fi
[[ "$RUNTIME_PATH" == *kraal* ]] || fail "The runtime connection's search_path is \"$RUNTIME_PATH\" — no kraal.

  Unqualified queries would resolve against public, where another application
  lives. Fix it server-side (per-connection settings do not survive the pooler,
  and the adapter's schema option does nothing):

    ALTER ROLE kraal_app SET search_path = kraal, extensions;

  Then re-run. Refusing to deploy against the wrong schema."
echo "✓ runtime search_path resolves to kraal ($RUNTIME_PATH)"

step "3/7 Seed (zones + optional test admin)"
node prisma/seed.mjs

step "4/7 Build (Next + OpenNext, budget enforced)"
npm run cf:build
BINARIES=$(find .open-next -name '*.node' | wc -l)
[[ "$BINARIES" == "0" ]] || fail "Native binaries in the bundle — engineType=client regressed"

# Prisma must load its query compiler as a WASM module, not off a filesystem
# the Workers runtime does not have. Both wrong ways build and deploy cleanly
# and fail on every database request afterwards, so check the bundle rather
# than waiting for the smoke tests to find it.
HANDLER=.open-next/server-functions/default/handler.mjs
if [[ -f "$HANDLER" ]]; then
  grep -q 'queryCompilerWasmFilePath' "$HANDLER" && fail "The bundle loads Prisma's query compiler from disk.
  Workers have no filesystem; every database request will fail with
  '[unenv] fs.readFileSync is not implemented yet'. The Workers client alias in
  next.config.mjs has regressed — check CF_WORKERS is set and that
  src/db/prisma-client.ts is the import path used."
  WASM_IMPORTS=$(grep -o 'query_compiler_bg\.wasm?module' "$HANDLER" | wc -l)
  [[ "$WASM_IMPORTS" -gt 0 ]] || fail "No WASM query-compiler import in the bundle — the Workers Prisma client is not being used."
  echo "✓ Prisma query compiler bundled as WASM ($WASM_IMPORTS import sites, one file)"
fi

step "5/7 Deploy"
DEPLOY_OUT=$(npx wrangler deploy 2>&1) || { echo "$DEPLOY_OUT"; fail "wrangler deploy failed"; }
echo "$DEPLOY_OUT" | tail -3
URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)

step "6/7 Cloudflare secrets"
# After the deploy, deliberately: `wrangler secret put` fails on a worker that
# does not exist yet, so on a first run the worker must be created first. A
# few seconds of a live worker without secrets is harmless — every request in
# that window fails closed on the missing DATABASE_URL. Updated secrets take
# effect immediately; no second deploy is needed.
put() { printf '%s' "$2" | npx wrangler secret put "$1" > /dev/null && echo "  ✓ $1"; }
put DATABASE_URL "$DATABASE_URL"
put DIRECT_URL   "$DIRECT_URL"
put OTP_PEPPER   "$OTP_PEPPER"
# Without this the worker's model queries address `public` — the other
# application's schema — and fail with P2021 on every request.
put DB_SCHEMA    "$DB_SCHEMA"

if [[ -n "${S3_ENDPOINT:-}" ]]; then
  put S3_ENDPOINT "$S3_ENDPOINT"; put S3_BUCKET "$S3_BUCKET"
  put S3_ACCESS_KEY_ID "$S3_ACCESS_KEY_ID"; put S3_SECRET_ACCESS_KEY "$S3_SECRET_ACCESS_KEY"
  put S3_PUBLIC_BASE_URL "${S3_PUBLIC_BASE_URL:-$S3_ENDPOINT/$S3_BUCKET}"
else
  echo "  ⚠ No R2 credentials. Photo upload will fail on Workers (no disk there);"
  echo "    enable R2 in the dashboard, make a bucket + token, and re-run."
fi

if [[ -n "${AT_API_KEY:-}" ]]; then
  put AT_API_KEY "$AT_API_KEY"; put AT_USERNAME "$AT_USERNAME"
  [[ -n "${AT_SENDER_ID:-}" ]] && put AT_SENDER_ID "$AT_SENDER_ID"
else
  put ALLOW_CONSOLE_SMS "true"
  echo "  ⚠ TEST MODE: OTP codes will be written to the worker log."
  echo "    Read them with: npx wrangler tail kraal --format pretty"
fi

step "7/7 Smoke checks"
[[ -n "$URL" ]] || { echo "⚠ Could not detect the URL; run the checks from DEPLOYMENT.md §7"; exit 0; }

# Every command here is guarded. An unguarded `grep` with no match returns 1,
# and under `set -e` that ends the script mid-verification — which reads in the
# log exactly like a failed deploy, on a deploy that in fact succeeded.
SMOKE_FAILURES=0
expect() { # expect <what> <wanted> <got>
  if [[ "$3" == "$2" ]]; then
    echo "  ✓ $1"
  else
    echo "  ✗ $1 — expected $2, got $3"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi
}

sleep 5   # a new version takes a moment to start serving

expect "home page serves" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$URL/" || echo 000)"
expect "unauthenticated publish is rejected" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/listings" || echo 000)"

# The one that proves the whole stack. Requesting a code writes an
# otp_challenges row, so a success here means the worker reached the database,
# addressed the right schema, and satisfied RLS — the three things that cannot
# be confirmed from the build alone.
otp_check() { # otp_check <phone> <what>
  local body
  body=$(curl -s -X POST "$URL/api/auth/request-code" \
    -H 'content-type: application/json' -d "{\"phone\":\"$1\"}" || true)
  # RATE_LIMITED counts as reaching the database: the limiter's verdict comes
  # from counting this number's recent challenges, which is a read of the very
  # table a working path writes to. Only a 500 means the stack is broken.
  if grep -qE 'challengeId|RATE_LIMITED' <<<"$body"; then
    echo "  ✓ OTP request reached the database ($2)"
  else
    echo "  ✗ OTP request failed ($2): ${body:0:400}"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi
}

otp_check 71234567 "new number"
# The number LIVE_TESTING.md tells a tester to sign in with. It is the seeded
# admin, so it exercises the path against a user that already exists — worth
# checking separately, because the documented first step of testing this app
# failing is worse than an obscure endpoint failing.
otp_check "${SEED_ADMIN_PHONE:-71000000}" "seeded admin"

# When a check fails, the useful information is inside the worker, and the
# response deliberately does not carry it — `error.generic` is what a user
# should see, not what a deploy log should have to work from. Attach to the
# live log stream and reissue the failing requests, so the actual exception
# lands in CI rather than requiring someone to reproduce it by hand.
if [[ "$SMOKE_FAILURES" != "0" ]]; then
  echo
  echo "━━ Capturing worker logs for the failing requests"
  npx wrangler tail kraal --format pretty > /tmp/kraal-tail.log 2>&1 &
  TAIL_PID=$!
  sleep 8   # tail takes a few seconds to attach; requests before that are lost
  curl -s -o /dev/null "$URL/" || true
  curl -s -o /dev/null -X POST "$URL/api/auth/request-code" \
    -H 'content-type: application/json' -d '{"phone":"71234567"}' || true
  sleep 8
  kill "$TAIL_PID" 2>/dev/null || true
  wait "$TAIL_PID" 2>/dev/null || true
  echo "───── worker log ─────"
  tail -80 /tmp/kraal-tail.log 2>/dev/null || echo "(no log captured)"
  echo "───── end worker log ─────"
fi

echo
[[ "$SMOKE_FAILURES" == "0" ]] || fail "$SMOKE_FAILURES smoke check(s) failed.
  The worker is deployed at $URL but is not serving correctly. It was
  previously possible for this to print ✗ and still exit 0 — a deploy that
  reports success while broken is worse than one that fails."

echo "Live at: $URL"
echo "OTP codes (test mode): npx wrangler tail kraal --format pretty"
echo "Tester guide: LIVE_TESTING.md"
