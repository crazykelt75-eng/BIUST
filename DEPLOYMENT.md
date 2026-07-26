# Deploying Kraal — Supabase + Cloudflare

Target: **Supabase** for Postgres/PostGIS, **Cloudflare Workers** for the app
(via OpenNext), **Cloudflare R2** for photos.

## Current state (provisioned 2026-07-26)

The database side is **done**, in the `kraal` schema of the existing shared
Supabase project (`hqnwxckuptagvsizanho`, chosen over a new $10/month project):
all four migrations applied, Prisma history bookkept with real checksums,
append-only + ledger triggers installed and verified live, deny-all RLS forced
on all 30 tables, zones + test admin (+26771000000) seeded, and the other
application in `public` untouched.

The app connects as the dedicated `kraal_app` role. Its **role-level
search_path** routes unqualified queries into the kraal schema server-side —
per-connection parameters do not survive the transaction pooler, and the
adapter's schema option was tested and does nothing. The role has least
privilege (nothing in `public`) and an explicit RLS allow policy per table.

Remaining, on a machine with `wrangler login`:

1. Set the runtime role's password (Supabase SQL editor, once):
   `ALTER ROLE kraal_app PASSWORD '...';` — it is created unusable until then.
2. `cp .deploy.env.example .deploy.env`, fill in, `./scripts/deploy.sh`.

The sections below document the full path for a fresh, dedicated project. On
the shared project, **never run `rls_deny_all.sql`** — it is public-scoped and
would break the other application; `deploy.sh` carries a kraal-scoped version
and hard-stops without `?schema=kraal` in `DIRECT_URL`.

> Read §1 before doing anything else. It is the step that, skipped, publishes
> your session tokens and trust ledger to the public internet.

---

## 1. Supabase exposes every table by default — turn it off

Supabase runs **PostgREST** in front of the database and automatically exposes
every table in the `public` schema over HTTPS. The `anon` key that authenticates
those requests is *designed to be public* — it ships in client bundles.

With row-level security off, `anon` can read and write every table in this
application:

| Table | What leaks |
|---|---|
| `sessions` | session token hashes → account takeover |
| `otp_challenges` | OTP hashes → account takeover |
| `journal_lines` | the entire trust account ledger |
| `users` | every farmer's phone number |
| `animals` | LITS numbers and owners — a shopping list for stock theft |
| `farms` | exact farm coordinates |

Two mitigations, apply **both**:

**a) Disable the Data API.** This application never uses PostgREST; it talks to
Postgres directly through Prisma. In the Supabase dashboard:
*Settings → API → Data API → set the exposed schema to none.*

**b) Deny-all RLS**, as defence in depth:

```bash
psql "$DIRECT_URL" -f prisma/sql/rls_deny_all.sql
```

This enables (and `FORCE`s) RLS on every table and creates no policies, which
denies everything to every role that does not bypass RLS. Prisma connects as
`postgres`, which does bypass it, so the application is unaffected.

**Re-run it after every migration that adds a table.** A new table arrives with
RLS off.

Verify — this must return zero rows:

```sql
SELECT tablename FROM pg_tables
 WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
   AND NOT rowsecurity;
```

And confirm it actually bites, rather than trusting that the script ran:

```sql
SET ROLE anon;
SELECT count(*) FROM sessions;   -- must be 0, not your real session count
RESET ROLE;
```

---

## 2. Supabase project

1. Create the project. Choose the region closest to Botswana — at time of
   writing that is `eu-central-1` (Frankfurt) or `ap-south-1` (Mumbai); measure
   both from a Botswana connection rather than assuming, because the routing
   matters more than the map.

2. Enable PostGIS. SQL editor:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```

3. Collect **two** connection strings from *Settings → Database*:

   | Variable | Port | Used for | Why |
   |---|---|---|---|
   | `DATABASE_URL` | 6543 | runtime | Transaction pooler. Serverless invocations are numerous and short-lived; direct connections exhaust Postgres's limit fast. |
   | `DIRECT_URL` | 5432 | migrations only | The pooler cannot run DDL — no prepared statements, no advisory locks. |

   Append `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`.

   Getting these the wrong way round gives you a system that works in
   development and falls over under load, which is the worst time to discover it.

---

## 3. Migrations

```bash
export DIRECT_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
export DATABASE_URL="postgresql://postgres:...@...pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

npx prisma migrate deploy      # uses DIRECT_URL
psql "$DIRECT_URL" -f prisma/sql/rls_deny_all.sql
```

The append-only triggers and ledger constraints are already inside the initial
migration, so `migrate deploy` installs them. Confirm afterwards:

```sql
-- Must error: "Table journal_lines is append-only."
UPDATE journal_lines SET amount = 1 WHERE false;
```

---

## 4. R2 for photos

R2 speaks the S3 API, so the existing `S3Storage` works unchanged — and R2
charges no egress, which matters when the product is photographs of cattle
served to people on metered mobile data.

1. Create a bucket, e.g. `kraal-photos`.
2. Create an R2 API token with **Object Read & Write** scoped to that bucket.
3. Connect a custom domain or enable the public r2.dev URL, and set
   `S3_PUBLIC_BASE_URL` to it.

Do **not** make the bucket publicly writable. Uploads go through the app, which
validates the bytes, strips EXIF, and assigns a random key.

---

## 4b. SMS gateway

Africa's Talking, chosen for Botswana coverage and because it also provides the
USSD that Phase 3 needs.

1. Create an account and top it up. **An empty balance fails every send**, and
   the client classifies that as permanent rather than retrying — so it surfaces
   loudly instead of silently burning attempts.
2. Register an alphanumeric sender ID (e.g. `KRAAL`). Without one, messages go
   out on a shared shortcode and look like spam.
3. Set `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID`. Use `AT_SANDBOX=true` while
   testing.

The app **refuses to start in production without these** rather than falling
back to logging codes — a deployment that quietly writes one-time codes to a log
is worse than one that fails, because the failure is invisible until an account
is taken over.

Every send is recorded in `sms_deliveries` with its provider reference and cost,
and never with the message body. Support will need it the first time someone
says they did not get a code.

## 4c. Queues — deliberately off for the first deploy

Queue bindings are commented out in `wrangler.jsonc`. With no `QUEUE` binding
the app runs fan-out inline in the request, which is correct at test volume and
means the queues need not exist before the first deploy. The config comment
documents how to re-enable them (create the queues, add a wrapper entry that
gives the worker a `queue()` handler) when volume justifies it.

## 4d. The short path: one command

```bash
cp .deploy.env.example .deploy.env   # fill in Supabase creds + OTP_PEPPER
npx wrangler login
./scripts/deploy.sh
```

The script runs migrations, forces RLS and refuses to continue if any table is
left unprotected, seeds zones, pushes secrets, builds, deploys, and smoke-tests
the URL. Everything below documents what it does, for when a step needs to be
run by hand.

## 5. Cloudflare secrets

Never put these in `wrangler.jsonc` — it is committed.

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put DIRECT_URL
npx wrangler secret put OTP_PEPPER            # openssl rand -base64 32
npx wrangler secret put S3_ENDPOINT           # https://<account>.r2.cloudflarestorage.com
npx wrangler secret put S3_BUCKET
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
npx wrangler secret put S3_PUBLIC_BASE_URL
npx wrangler secret put AT_API_KEY
npx wrangler secret put AT_USERNAME
npx wrangler secret put AT_SENDER_ID
```

`OTP_PEPPER` is required in production and the app refuses to issue codes
without it. Changing it later invalidates every outstanding OTP — harmless, they
expire in five minutes anyway.

---

## 6. Deploy

```bash
npm run cf:build      # next build + opennextjs-cloudflare build
npm run cf:preview    # runs the worker locally against real secrets
npm run cf:deploy
```

Two things make this work on Workers and both are easy to undo by accident:

- **`nodejs_compat`** in `wrangler.jsonc`. Prisma's driver adapter routes
  through `pg`, which needs Node's net/tls shims. Without the flag the worker
  fails at import, not at query time.
- **`engineType = "client"`** in `prisma/schema.prisma`. Prisma otherwise emits
  a ~17 MB native `libquery_engine` binary — a Linux `.so` that cannot execute
  on Workers and on its own exceeds the worker size limit. Verify after any
  Prisma upgrade:

  ```bash
  find .open-next -name '*.node' | wc -l   # must be 0
  ```

---

## 7. Post-deploy checks

```bash
BASE=https://kraal.<subdomain>.workers.dev

curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/listings          # 401
curl -sI $BASE/ | grep -i content-language                                   # tn
curl -s -X POST $BASE/api/auth/request-code \
  -H 'content-type: application/json' -d '{"phone":"71234567"}'              # challengeId
```

Then confirm the session cookie comes back `HttpOnly; Secure; SameSite=Lax`,
and that a fourth code request inside the window returns `429`.

---

## Still outstanding before real users

These are not deployment steps — they are gaps in the product.

1. **Photo serving.** Currently the R2 public URL. Put Cloudflare Images or a
   resizing Worker in front before launch, or every listing card downloads a
   full-size photo on a metered connection.

4. **Backups.** Supabase's automatic backups depend on plan. The trust ledger is
   financial evidence; confirm point-in-time recovery is on before taking a
   single real payment.
