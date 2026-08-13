-- Deny-all row-level security.
--
-- REQUIRED ON SUPABASE. Not optional, not a hardening nicety.
--
-- Supabase runs PostgREST in front of the database and automatically exposes
-- every table in the `public` schema over HTTPS. The `anon` key that
-- authenticates those requests is designed to be public — it ships in client
-- bundles and is visible to anyone who opens devtools.
--
-- The only thing standing between that endpoint and the whole database is row
-- level security. With RLS off, `anon` can read and write every table. For this
-- application that means:
--
--   sessions          → session token hashes, i.e. account takeover
--   otp_challenges    → OTP hashes, i.e. account takeover
--   journal_lines     → the entire trust account ledger
--   users             → every farmer's phone number
--   animals           → LITS numbers and owners, a shopping list for stock theft
--   farms             → exact farm coordinates
--
-- This script enables RLS on every table and creates NO policies, which denies
-- everything to every role that does not bypass RLS. The application's own
-- connection is unaffected: Prisma connects as a role with BYPASSRLS (the
-- Supabase `postgres` role does), so the app keeps working while PostgREST is
-- shut out entirely.
--
-- Defence in depth, not the only defence. Also disable the Data API in the
-- Supabase dashboard if you are not using it — this application never does.
--
-- Apply after every migration that adds a table:
--   psql "$DIRECT_URL" -f prisma/sql/rls_deny_all.sql

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
       -- PostGIS's own metadata table; leave its grants alone.
       AND tablename <> 'spatial_ref_sys'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    -- FORCE applies RLS to the table owner too, so a compromised owner
    -- connection does not silently bypass it.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);
  END LOOP;
END $$;

-- Belt and braces: revoke the grants PostgREST relies on. RLS alone is enough,
-- but a future migration that accidentally adds a permissive policy should not
-- be the only thing standing between anon and the ledger.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON SCHEMA public FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON SCHEMA public FROM authenticated;
  END IF;
END $$;

-- Verification. Run this after applying; every row returned is a hole.
--
--   SELECT tablename
--     FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename <> 'spatial_ref_sys'
--      AND NOT rowsecurity;
