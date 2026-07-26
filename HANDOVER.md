# Handover — where Kraal stands and what to do next

Written for whoever (or whatever) picks this up cold. Read this first, then
`MASTER_PROMPT.md` for the product, `DEPLOYMENT.md` for infrastructure,
`LIVE_TESTING.md` for walking the app.

**Last updated:** 2026-07-26, during the first live deploy attempt.

---

## 1. What this is

A farmer-to-farmer and butcher livestock marketplace for Botswana. Farmers list
cattle; other farmers and butchers get alerted and can buy. The full
specification — including the mechanics that make it more than a classifieds
board — is `MASTER_PROMPT.md`, which is the source of truth for product
decisions.

**Working branch:** `claude/farmer-marketplace-platform-yha3pl`.
Nothing has been merged to `main`. No PR has been opened (none was requested).

---

## 2. Current state

**Code: complete for a Phase 1 live test.** 194 unit tests + 55 integration
tests passing, typecheck clean, Next and OpenNext builds passing, JS bundle
361 KB of a 500 KB budget.

The whole loop is verified working against a local production build:
signup → farm → verification → admin approval (T0→T1→T2) → publish with photos
→ browse → offer → accept → transaction. See the walkthrough in
`LIVE_TESTING.md`.

**Database: provisioned and verified.** See §4.

**Deployment: in progress, not yet confirmed green.** See §5.

### Built

| Area | Location |
|---|---|
| Domain core (pure, no I/O) | `src/domain/` |
| Money, ledger, reconciliation | `src/domain/money.ts`, `src/domain/ledger/` |
| Weight-tolerance settlement | `src/domain/settlement.ts` |
| Transaction state machine | `src/domain/transaction/` |
| Zone movement feasibility | `src/domain/zones/` |
| Alert matching + delivery rules | `src/domain/matching/` |
| Verification tiers | `src/domain/verification.ts` |
| OTP policy | `src/domain/auth/otp.ts` |
| Upload validation | `src/domain/media/` |
| Persistence, ledger repo | `src/db/` |
| Services (listing, offer, txn, auth, photo, onboarding, sms, queue) | `src/services/` |
| Pages + API routes | `src/app/` |
| Setswana + English | `src/i18n/` |

### Deliberately NOT built

- **Escrow payment UI.** Ledger and services exist; no payment rail connected.
- **Alert push delivery.** Matches are computed and logged to `alert_sends`;
  nothing is actually pushed.
- **Auctions.** Licence-gated — see §7.
- **Syndicates / lot splitting.** Phase 2. The spec's flagship differentiator.
- **Photo resizing.** Listing cards fetch full-size images.
- **USSD.** Phase 3.

---

## 3. Non-obvious decisions — do not "fix" these

Each of these looks wrong until you know why. All are load-bearing.

1. **`publishListing` takes the root Prisma client, not a transaction.** A
   rejected publish must still commit its fraud flag. An earlier version wrote
   the flag inside the write transaction and threw — the rollback erased the
   evidence, so listing stolen cattle was refused *and forgotten*. Three
   phases: read-only check → commit violations in their own transaction →
   write.

2. **The ledger enforces two invariants, not one.** Lines sum to zero, *and*
   they sum to zero within each fund class. The second is the client/platform
   money wall. A legitimate fee sweep crosses it using a balanced pair on each
   side. See `src/domain/ledger/journal.ts`.

3. **Unswept platform fees count as CLIENT_TRUST.** Until the sweep runs the
   money is physically in the trust account. Reclassifying early breaks
   reconciliation.

4. **The OTP attempt counter increments before the code comparison.** Otherwise
   killing the request mid-verify leaves the attempt unspent, and whether a
   request completes is entirely within an attacker's control.

5. **Hitting the OTP attempt cap kills the whole challenge**, not just that
   guess. Even the correct code is then refused.

6. **The inspection window auto-settles, not auto-refunds.** Silence favours
   the seller who has already performed; otherwise a buyer strands a seller's
   money by doing nothing.

7. **Per-head sales are never repriced on weight.** The parties agreed a price
   per animal. Only `PER_KG_*` bases auto-adjust. Weight over tolerance on a
   per-head sale flags for review instead.

8. **EXIF is read and then stripped.** Capture location/time are fraud signals
   worth keeping server-side (§8.3 of the spec); publishing them hands out a
   cattle post's coordinates, and stock theft is the dominant fraud here (§4.3).

9. **No public competing bid amounts, no auto-award to highest bidder.** These
   two properties are what keep best-offer and sealed-bid outside auctioneer
   licensing. Enforced in the service layer, not the UI.

10. **Zone restrictions are hard blocks in the state machine**, never warnings.
    Cancellation stays available while restricted — a restriction must not trap
    a buyer's money.

11. **`engineType = "client"` in `prisma/schema.prisma`.** Without it Prisma
    emits a ~17 MB native `libquery_engine` binary that cannot run on Workers
    and alone exceeds the size limit. After any Prisma upgrade:
    `find .open-next -name '*.node' | wc -l` must be 0.

12. **Queue bindings are commented out in `wrangler.jsonc`.** The OpenNext
    worker exports only `fetch`; attaching a consumer would deliver messages to
    a handler that does not exist. Re-enabling needs a wrapper entry that
    re-exports the OpenNext handler and adds `queue()` from
    `src/workers/queue-consumer.ts`. With no binding, fan-out runs inline —
    correct at test volume.

13. **The Prisma adapter's `schema` option does nothing.** Tested directly: it
    does not set `search_path`, and per-connection parameters do not survive
    Supabase's transaction pooler. Schema routing is done by the `kraal_app`
    role's server-side `SET search_path`. See §4.

---

## 4. Database — Supabase (provisioned, verified)

**Project:** `hqnwxckuptagvsizanho` (region `eu-west-1`), org
`hwgcbpgfqhjqruvxzynx`. This project is **shared** with an unrelated app
(`mr2x`) that owns the `public` schema.

**Kraal lives entirely in the `kraal` schema.** 30 tables. The user chose this
over a dedicated $10/month project.

Verified live during provisioning:

- All four migrations applied; Prisma history table pre-populated with the real
  sha256 checksums so `prisma migrate deploy` is a no-op.
- PostGIS 3.3.7 in the `extensions` schema.
- Append-only triggers on `transaction_events`, `journal_entries`,
  `journal_lines`, `audit_log` — installation confirmed by catalog query and
  the refusal path confirmed by a caught `restrict_violation`.
- Ledger balance + trust-overdraw constraint triggers installed.
- Deny-all `FORCE` RLS on all 30 tables; `anon`/`authenticated` hold zero
  privileges on the schema.
- Zones (5) and test admin `+26771000000` seeded.
- `public` untouched — mr2x's 9 tables intact.

### The `kraal_app` role — how schema routing actually works

The app connects as `kraal_app`, which has a **role-level**
`SET search_path = kraal, extensions`. This is a server-side property applied
on every connection, so it survives the transaction pooler. It has least
privilege (nothing in `public`) and an explicit per-table RLS allow policy
(`kraal_app_all`) rather than an unauditable `BYPASSRLS` attribute.

**Any new migration that adds a table must:** enable + force RLS on it, create
the `kraal_app_all` policy, and grant `kraal_app` DML. Step 2 of
`scripts/deploy.sh` does all three and is safe to re-run.

### Two connection strings, different jobs

| Variable | Role | Host / port | Notes |
|---|---|---|---|
| `DATABASE_URL` | `kraal_app` | `…pooler.supabase.com:6543` (transaction) | Runtime. `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | `postgres.<ref>` | `…pooler.supabase.com:5432` (**session pooler**) | Migrations only. **Must** carry `?schema=kraal` |

**`DIRECT_URL` must use the session pooler, not `db.<ref>.supabase.co`.** That
direct host resolves to IPv6 only, and GitHub Actions runners have no IPv6
route — it can never connect from CI. The session pooler is IPv4 and supports
everything a direct connection does (DDL, prepared statements), unlike the
transaction pooler on 6543. The username is tenant-qualified: `postgres.<ref>`.
`scripts/deploy.sh` preflights this and prints the fix.

`DIRECT_URL` without `?schema=kraal` would make Prisma look for its history in
`public` and try to re-apply the whole Kraal schema on top of mr2x.
`scripts/deploy.sh` hard-stops if it is missing.

**`psql` cannot accept `?schema=`** — libpq rejects unknown URI parameters. The
deploy script strips it into `PSQL_URL` for psql steps while Prisma keeps the
full URL. This bug failed the first CI run.

### NEVER run `prisma/sql/rls_deny_all.sql` against this project

That file is `public`-scoped and would force policy-less RLS onto mr2x's
tables, breaking the other application. It remains in the repo for a future
dedicated project. The kraal-scoped version lives inline in step 2 of
`scripts/deploy.sh`.

---

## 5. Deployment — Cloudflare Workers (in progress)

**Route:** GitHub Actions runs `scripts/deploy.sh` on a runner, so no local
tooling is needed. Workflow: `.github/workflows/deploy.yml`.

**Triggering:** `workflow_dispatch` is declared but GitHub does not register a
workflow for API dispatch until it exists on the **default branch**. Until this
lands on `main`, deploys are requested by **changing `.deploy-trigger`** on the
working branch (a `push` trigger scoped to that one path, so ordinary commits
never deploy).

```bash
date -u > .deploy-trigger && git commit -am "deploy" && git push
```

Then check runs via the GitHub MCP tools (`actions_list` /
`get_job_logs` with `failed_only: true`).

**Required repository secrets** (Settings → Secrets and variables → Actions):
`DATABASE_URL`, `DIRECT_URL`, `OTP_PEPPER`, `CLOUDFLARE_API_TOKEN`,
optionally `CLOUDFLARE_ACCOUNT_ID`.

### Deploy history

| Run | Outcome |
|---|---|
| 30221535961 | ❌ `psql: invalid URI query parameter: "schema"` — psql cannot take Prisma's `?schema=`. Fixed: script strips it into `PSQL_URL`. |
| 30222276887 | ❌ `Network is unreachable` on `db.<ref>.supabase.co:5432` — IPv6-only host, no IPv6 on GitHub runners. Fixed: `DIRECT_URL` must use the **session pooler**; script now preflights and diagnoses. Needs the user to update the `DIRECT_URL` secret. |
| 30222628106 | ❌ `FATAL: password authentication failed for user "postgres"`. Host resolved and connected — the IPv6 problem was solved. The pooler is multi-tenant and **routes on the username**, which must be `postgres.<project-ref>`; plain `postgres` matches no tenant and is reported as a password failure. Fixed by updating the secret; script now checks both URLs' usernames before connecting. |
| (next) | **Check this first.** |

Four failures, four different pieces of infrastructure plumbing — libpq
parameter handling, IPv6, a swallowed diagnostic, the pooler username. None was
application code. Each fix is in `scripts/deploy.sh` and each now fails with the
correction spelled out rather than with the raw symptom.

### Known deploy gotchas

- **Passwords with `@` `:` `/` `#` `?` must be percent-encoded** in the
  connection URLs. The user's password contains `@`, so `DATABASE_URL` and
  `DIRECT_URL` need `%40`. This caused a round trip.
- **Never use `db.<ref>.supabase.co` from CI** — IPv6 only. Session pooler
  (`…pooler.supabase.com:5432`) is the IPv4 equivalent. See §4.
- **Pooler usernames carry the project ref**: `postgres.hqnwxckuptagvsizanho`,
  `kraal_app.hqnwxckuptagvsizanho`. The poolers are multi-tenant and route on
  the username; a plain one is rejected as *"password authentication failed"*,
  which sends you hunting for a password problem that does not exist. Only the
  pooler hosts need this — a direct connection takes the bare role name.
- **Migrations are already applied**, so steps 1–3 of the script are
  verification no-ops. They are still not optional: step 2 is what forces RLS
  and refreshes the `kraal_app` policy on any newly added table.
- **Deploy runs before secrets are set**, deliberately — `wrangler secret put`
  fails on a worker that does not exist. The gap is harmless because a
  secretless worker fails closed.
- **R2 is not enabled** on the Cloudflare account (needs a dashboard click).
  Without it photo upload fails on Workers — there is no filesystem there. The
  app deploys and everything else works.
- **SMS is in test mode** (`ALLOW_CONSOLE_SMS=true`, set automatically when no
  Africa's Talking keys are present). Codes go to the worker log:
  `npx wrangler tail kraal`.

---

## 6. Security posture

**Escape hatches — never set on a real deployment.** Both require an exact
named opt-in and log a warning on every use:

- `ALLOW_CONSOLE_SMS=true` — OTP codes to the log instead of SMS.
- `ALLOW_LOCAL_STORAGE=true` — photos to local disk. Cannot work on Workers.

**⚠️ Credentials exposed in the chat transcript.** During this session the user
pasted a Cloudflare API token and a Supabase personal access token, and their
database password (`kelvin@7620`, used for both `postgres` and `kraal_app`) was
disclosed. **All of these must be rotated once testing finishes:**

1. Cloudflare: roll the API token, update the GitHub secret.
2. Supabase: revoke the personal access token (Account → Access Tokens). It was
   never usable — `api.supabase.com` is blocked by this environment's egress
   policy — so revoking it costs nothing.
3. Supabase: change the `postgres` password (dashboard) and `kraal_app`
   password (SQL editor), update both GitHub secrets.

No application change is needed for any of these.

**The session container cannot reach Supabase at all.** Outbound TCP to 5432 is
blocked and `api.supabase.com` is denied by egress policy, so no amount of
credentials lets this session touch the database directly. Database work must
go through the Supabase MCP connector (enabled per-chat), the dashboard, or the
GitHub Actions runner, which has unrestricted egress.

---

## 7. Open questions blocking real users

From `MASTER_PROMPT.md` §14, unchanged and all legal rather than technical:

1. **Trust account structure** — segregated corporate account, or an attorney's
   trust account with statutory ring-fencing? Blocks taking real money.
2. **Payment-institution licensing** under the National Payment System Act for
   holding client funds. Blocks taking real money.
3. **Auctioneer licence** — confirmed required. The MVP routes around it (see
   decision 9 above); get counsel to confirm in writing that best-offer and
   sealed-bid are not auctions. Cheapest high-leverage question on the list.
4. **LITS API access** from DVS — determines whether ear-tag verification is a
   real control or self-declared.
5. **Pilot region** — Central District (Serowe/Palapye) is the obvious choice.
6. **Cold-start supply** and **butcher anchor** — who lists first, and which
   butchers commit before launch.

---

## 8. Suggested next steps

**Immediately:** confirm the deploy went green; if not, read the failed job
logs and fix. The two failures seen so far were both in the deploy plumbing,
not the app.

**Then, in rough priority order:**

1. **R2 + photo resizing.** Enable R2, create `kraal-photos` + a scoped token,
   add the four `S3_*` secrets, re-run. Then put Cloudflare Images or a
   resizing worker in front — listing cards currently fetch full-size photos
   over metered mobile data, which cuts against the whole point.
2. **Africa's Talking.** Register a sender ID, top up the balance, add the
   `AT_*` secrets. Removes the console-SMS hatch.
3. **Alert delivery.** Matching and logging work; nothing is actually sent.
   Web Push first, SMS for time-critical only (it is metered).
4. **Cloudflare Queues** for fan-out, once volume justifies it — see decision
   12 for the wrapper-entry requirement.
5. **Phase 2: syndicates and lot splitting.** The spec's differentiator
   (`MASTER_PROMPT.md` §6). Everything before this is a classifieds site.

---

## 9. Working notes

- **Tests:** `npm test` (unit, no DB), `npm run test:integration` (needs live
  PostgreSQL 16 + PostGIS), `npm run test:all`. Integration tests truncate every
  table — never point them at a shared database.
- **Local DB:** the container's Postgres stops between sessions; restart with
  `service postgresql start`. Local dev uses the `public` schema and the default
  role, unchanged.
- **Build:** `npm run build` also enforces the JS budget via
  `scripts/check-bundle-budget.mjs`. It measures *uncompressed* bytes
  deliberately — parse time on a low-end Android scales with those, and Next's
  own "First Load JS" figure is post-compression and reads roughly a third.
- **Bugs found by tests, not review** (worth preserving those tests): the
  Postgres aborted-transaction idempotency bug, the fraud-flag rollback, the
  root-relative photo URL rejection, the EXIF fixture offset error.
