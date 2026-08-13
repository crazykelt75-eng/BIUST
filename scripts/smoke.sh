#!/usr/bin/env bash
#
# Health check against the live site. No secrets, no login, no build — three
# plain HTTP requests against public endpoints. Runs standalone or from CI.
#
# Usage:
#   ./scripts/smoke.sh [url]
#
# Defaults to KRAAL_URL, then the known production worker.

set -uo pipefail

URL="${1:-${KRAAL_URL:-https://kraal.crazykelt75.workers.dev}}"
URL="${URL%/}"

SMOKE_FAILURES=0
expect() { # expect <what> <wanted> <got>
  if [[ "$3" == "$2" ]]; then
    echo "✓ $1"
  else
    echo "✗ $1 — expected $2, got $3"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi
}

echo "Checking $URL"

expect "home page serves" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$URL/" || echo 000)"
expect "unauthenticated publish is rejected" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/listings" || echo 000)"

# The one that proves the whole stack. Requesting a code writes an
# otp_challenges row, so a success here means the worker reached the database,
# addressed the right schema, and satisfied RLS — the three things a build
# alone can never confirm.
otp_check() { # otp_check <phone> <what>
  local body
  body=$(curl -s -X POST "$URL/api/auth/request-code" \
    -H 'content-type: application/json' -d "{\"phone\":\"$1\"}" || true)
  # RATE_LIMITED counts as reaching the database: the limiter's verdict comes
  # from counting this number's recent challenges, which is a read of the very
  # table a working path writes to. Only a 500 means the stack is broken.
  if grep -qE 'challengeId|RATE_LIMITED' <<<"$body"; then
    echo "✓ OTP request reached the database ($2)"
  else
    echo "✗ OTP request failed ($2): ${body:0:400}"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi
}

otp_check 71234567 "new number"
# The number LIVE_TESTING.md tells a tester to sign in with, and the seeded
# admin — worth checking separately, because the documented first step of
# testing this app failing is worse than an obscure endpoint failing.
otp_check "${SEED_ADMIN_PHONE:-71000000}" "seeded admin"

echo
if [[ "$SMOKE_FAILURES" != "0" ]]; then
  echo "✗ $SMOKE_FAILURES smoke check(s) failed against $URL"
  # Best-effort only: this script deliberately has no Cloudflare credential,
  # so it cannot pull the worker's own logs the way a full deploy run can.
  # `npx wrangler tail kraal --format pretty` from a machine that IS logged in
  # is the next step.
  exit 1
fi
echo "✓ all checks passed against $URL"
