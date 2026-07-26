# Kraal

Farmer-to-farmer and butcher livestock marketplace for Botswana.

Farmers post cattle and other farm products; other farmers and butchers are
notified of what matches their needs and can buy in — individually, by splitting
a lot, or by pooling into a syndicate.

**The full specification is in [`MASTER_PROMPT.md`](./MASTER_PROMPT.md).** It is
the source of truth; this README only covers the state of the code.

---

## Where the build has got to

Phase 1. Domain core, persistence, the listing → alert vertical, and the
seller-facing UI are built and tested. The app builds and runs; auth and photo
storage are the remaining blockers to it being usable by a real farmer.

| Area | State |
|---|---|
| Product & architecture spec | ✅ `MASTER_PROMPT.md` |
| Prisma schema (Phase 1 scope) | ✅ `prisma/schema.prisma` — validates |
| Append-only + ledger DB constraints | ✅ `prisma/sql/append_only.sql` |
| Money primitives | ✅ `src/domain/money.ts` |
| Double-entry ledger | ✅ `src/domain/ledger/` |
| Trust reconciliation | ✅ `src/domain/ledger/reconcile.ts` |
| Weight-tolerance settlement | ✅ `src/domain/settlement.ts` |
| Transaction state machine | ✅ `src/domain/transaction/` |
| Zone movement feasibility | ✅ `src/domain/zones/` |
| Alert matching & delivery | ✅ `src/domain/matching/` |
| Verification tiers | ✅ `src/domain/verification.ts` |
| Initial migration (applied, PostGIS) | ✅ `prisma/migrations/` |
| Setswana + English i18n | ✅ `src/i18n/` |
| Listing validation (LITS, animals) | ✅ `src/domain/listing/` |
| Listing publish + anti-theft checks | ✅ `src/services/listing-service.ts` |
| Animal provenance chain | ✅ `AnimalTransfer` |
| Alert match worker | ✅ `src/services/match-worker.ts` |
| Ledger persistence + idempotency | ✅ `src/db/ledger-repository.ts` |
| Transaction orchestration | ✅ `src/services/transaction-service.ts` |
| Listing creation UI (offline, i18n) | ✅ `src/app/sell/` |
| Browse page (SSR) | ✅ `src/app/page.tsx` |
| Publish API route | ✅ `src/app/api/listings/` |
| Bundle budget guard | ✅ `scripts/check-bundle-budget.mjs` |
| Phone-OTP auth + sessions | ✅ `src/services/auth-service.ts` |
| Server-side capability gates | ✅ `src/lib/session.ts` |
| Sign-in / verify pages | ✅ `src/app/signin/`, `src/app/verify/` |
| Photo storage, BullMQ queue | ⬜ Not started |

155 unit tests + 52 integration tests, all passing.

```bash
npm install
npm test              # unit — no database needed
npm run typecheck
npm run build         # builds and enforces the JS budget
npm run dev

npm run test:integration   # needs a live PostgreSQL 16 + PostGIS
npm run test:all
```

## Why the domain core came first

Everything under `src/domain/` is pure, dependency-free TypeScript with no
database or framework in it, and `src/db/` and `src/services/` are thin layers
over it. That is deliberate — these are the rules that are expensive to retrofit
and cheap to get right early:

- **The ledger.** A double-entry ledger bolted onto months of ad-hoc transfers
  is a reconstruction project. Built first, it costs a week.
- **The fund wall.** Client money and platform money are separate accounts, and
  `buildEntry` rejects any posting that moves value across the wall without a
  balanced pair on each side. Commingling is a thrown error, not a code review
  question.
- **Zone restrictions.** Movement blocks are enforced in the state machine, so
  no feature can accidentally route around them later.

## Running the database

Requires PostgreSQL 16 with PostGIS.

```bash
createdb kraal
psql kraal -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
export DATABASE_URL="postgresql://localhost:5432/kraal"

npx prisma migrate dev --create-only --name init
cat prisma/sql/append_only.sql >> prisma/migrations/*_init/migration.sql
npx prisma migrate dev
```

The append-only triggers and ledger constraints must be appended to the initial
migration — Prisma does not generate them. The committed migration already
includes them.

Integration tests truncate every table between cases, so point `DATABASE_URL`
at a disposable database, never a shared one.

## Configuration

`OTP_PEPPER` is **required in production** and must be at least 16 characters;
the app refuses to issue codes without it. Without a pepper, a leaked database
yields a rainbow table of one million entries, which is no protection at all
for a 6-digit code. See `.env.example`.

```bash
openssl rand -base64 32
```

## Not yet safe to deploy

Photo uploads are unwired — the publish route generates placeholder URLs so the
three-photo rule stays enforced rather than silently skipped. Real object
storage is the remaining gap before a farmer can actually list an animal.

SMS currently goes to the server log via `consoleSmsSender`. Wire a real
gateway (Africa's Talking) before any public deployment, or codes will be
visible in logs and invisible to users.

## Before this takes real money

Two items in `MASTER_PROMPT.md` §14 gate going live with escrow, and both are
legal rather than technical:

1. Trust account structure — segregated corporate account, or an attorney's
   trust account with statutory ring-fencing.
2. Whether holding client funds requires authorisation under the National
   Payment System Act.

The code is agnostic to how these resolve. Taking a deposit is not.

## Layout

```
MASTER_PROMPT.md          Specification — read this first
prisma/schema.prisma      Phase 1 data model
prisma/sql/               DB-level constraints Prisma cannot express
src/domain/
  money.ts                Integer thebe, safe splitting, no floats
  verification.ts         Tiers and capability gates
  settlement.ts           Weight tolerance and settlement arithmetic
  listing/                LITS validation, animal and listing schemas
  ledger/                 Double-entry journal, events, reconciliation
  transaction/            Transaction state machine and timeouts
  zones/                  Movement feasibility between disease-control zones
  matching/               Alert scoring and delivery decisions
  auth/                   OTP policy: rate limits, attempt caps, phone format
src/db/                   Prisma client, ledger persistence
src/services/             Listing publication, transactions, match fan-out
src/i18n/                 Setswana and English catalogue
src/app/                  Next.js routes, pages, and API handlers
src/lib/                  Session cookies, capability guards, offline drafts
```
