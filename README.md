# Kraal

Farmer-to-farmer and butcher livestock marketplace for Botswana.

Farmers post cattle and other farm products; other farmers and butchers are
notified of what matches their needs and can buy in — individually, by splitting
a lot, or by pooling into a syndicate.

**The full specification is in [`MASTER_PROMPT.md`](./MASTER_PROMPT.md).** It is
the source of truth; this README only covers the state of the code.

---

## Where the build has got to

Phase 1 foundation. The domain core is built and tested; the application layer
is not started.

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
| Migrations, API, workers, UI, i18n | ⬜ Not started |

107 tests, all passing.

```bash
npm install
npm test
npm run typecheck
```

## Why the domain core came first

Everything above is pure, dependency-free TypeScript with no database or
framework in it. That is deliberate — these are the rules that are expensive to
retrofit and cheap to get right early:

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
migration — Prisma does not generate them.

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
  ledger/                 Double-entry journal, events, reconciliation
  transaction/            Transaction state machine and timeouts
  zones/                  Movement feasibility between disease-control zones
  matching/               Alert scoring and delivery decisions
```
