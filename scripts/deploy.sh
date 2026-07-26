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

npx wrangler whoami > /dev/null 2>&1 || fail "wrangler is not logged in. Run: npx wrangler login"

step "1/7 PostGIS + migrations (direct connection)"
psql "$DIRECT_URL" -qc 'CREATE EXTENSION IF NOT EXISTS postgis;'
npx prisma migrate deploy

step "2/7 Deny-all RLS on the kraal schema"
# Scoped STRICTLY to the kraal schema. This database is shared with another
# application in public; the public-scoped rls_deny_all.sql must NEVER run here.
psql "$DIRECT_URL" -q <<'SQL'
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
UNPROTECTED=$(psql "$DIRECT_URL" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='kraal' AND NOT rowsecurity")
[[ "$UNPROTECTED" == "0" ]] || fail "$UNPROTECTED kraal table(s) still have RLS off — refusing to continue"
echo "✓ RLS forced on every kraal table; kraal_app policy refreshed" 

step "3/7 Seed (zones + optional test admin)"
node prisma/seed.mjs

step "4/7 Cloudflare secrets"
put() { printf '%s' "$2" | npx wrangler secret put "$1" > /dev/null && echo "  ✓ $1"; }
put DATABASE_URL "$DATABASE_URL"
put DIRECT_URL   "$DIRECT_URL"
put OTP_PEPPER   "$OTP_PEPPER"

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

step "5/7 Build (Next + OpenNext, budget enforced)"
npm run cf:build
BINARIES=$(find .open-next -name '*.node' | wc -l)
[[ "$BINARIES" == "0" ]] || fail "Native binaries in the bundle — engineType=client regressed"

step "6/7 Deploy"
DEPLOY_OUT=$(npx wrangler deploy 2>&1) || { echo "$DEPLOY_OUT"; fail "wrangler deploy failed"; }
echo "$DEPLOY_OUT" | tail -3
URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)

step "7/7 Smoke checks"
[[ -n "$URL" ]] || { echo "⚠ Could not detect the URL; run the checks from DEPLOYMENT.md §7"; exit 0; }
sleep 3
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/listings")
[[ "$CODE" == "401" ]] && echo "✓ unauthenticated publish → 401" || echo "✗ expected 401, got $CODE"
LANG_TAG=$(curl -s "$URL/" | grep -oE '<html lang="[a-z]+"' | head -1)
echo "✓ home page serves ($LANG_TAG)"
CHALLENGE=$(curl -s -X POST "$URL/api/auth/request-code" -H 'content-type: application/json' -d '{"phone":"71234567"}')
echo "$CHALLENGE" | grep -q challengeId && echo "✓ OTP flow reachable" || echo "✗ OTP request failed: $CHALLENGE"

echo
echo "Live at: $URL"
echo "OTP codes (test mode): npx wrangler tail kraal --format pretty"
echo "Tester guide: LIVE_TESTING.md"
