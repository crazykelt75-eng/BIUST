-- Append-only enforcement for the evidence tables.
--
-- MASTER_PROMPT.md §10.3: transaction_events, journal_entries, journal_lines and
-- audit_log are append-only. Livestock disputes reach real arbitration and
-- sometimes court, and an immutable log is the evidence. A ledger you can
-- UPDATE is not a ledger, it is a spreadsheet with extra steps.
--
-- Enforced in the database rather than only in application code, because the
-- application is not the only thing that will ever hold a connection to this
-- database. Corrections are new reversing entries (see events.ts `correction`),
-- never edits.
--
-- Apply this as part of the initial migration:
--   npx prisma migrate dev --create-only --name init
--   cat prisma/sql/append_only.sql >> prisma/migrations/<timestamp>_init/migration.sql
--   npx prisma migrate dev

CREATE OR REPLACE FUNCTION kraal_forbid_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only. % is not permitted. Post a reversing entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transaction_events',
    'journal_entries',
    'journal_lines',
    'audit_log'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only
         BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION kraal_forbid_mutation()',
      t, t
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ledger balance constraint.
--
-- The application validates that every journal entry balances (journal.ts
-- buildEntry), and validates it twice — overall and within each fund class.
-- This is the backstop for anything that reaches the database by another route.

CREATE OR REPLACE FUNCTION kraal_assert_entry_balances()
RETURNS TRIGGER AS $$
DECLARE
  total bigint;
  line_count int;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
    INTO total, line_count
    FROM journal_lines
   WHERE "entryId" = NEW."entryId";

  IF line_count >= 2 AND total <> 0 THEN
    RAISE EXCEPTION
      'Journal entry % does not balance: lines sum to %, expected 0',
      NEW."entryId", total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFERRABLE so a multi-line entry can be inserted line by line inside one
-- transaction and is only checked at COMMIT.
CREATE CONSTRAINT TRIGGER journal_lines_balance
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kraal_assert_entry_balances();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trust account may never be overdrawn.
--
-- A negative trust cash balance means client money has been paid out that was
-- never received. There is no legitimate state in which this is correct.

CREATE OR REPLACE FUNCTION kraal_assert_trust_not_overdrawn()
RETURNS TRIGGER AS $$
DECLARE
  trust_balance bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO trust_balance
    FROM journal_lines
   WHERE account = 'bank:trust';

  IF trust_balance < 0 THEN
    RAISE EXCEPTION
      'Trust account would be overdrawn (balance %). Client funds cannot go negative.',
      trust_balance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_trust_not_overdrawn
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kraal_assert_trust_not_overdrawn();
