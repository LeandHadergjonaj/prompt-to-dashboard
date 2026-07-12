-- Read-only role for the text-to-dashboard app, scoped to the EXISTING
-- project data in schema public (land registry / VOA / opportunities app).
-- Deliberately minimal-touch: no REVOKEs on the project's own grants, no
-- default-privilege changes — only additive, clearly-named objects that are
-- trivially reversible (DROP ROLE / DROP POLICY).
-- Invoke: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v reader_password="$READER_PASSWORD" -f db/05_dashboard_reader_existing_data.sql

SELECT format('CREATE ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

SELECT format('ALTER ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

ALTER ROLE dashboard_reader SET default_transaction_read_only = on;
ALTER ROLE dashboard_reader SET statement_timeout = '20s';

GRANT USAGE ON SCHEMA public TO dashboard_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;

-- All 8 tables have RLS enabled; without a policy the role would see zero
-- rows. One additive SELECT-only policy per table, scoped TO dashboard_reader
-- so the app's anon/authenticated/service_role behavior is untouched.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS dashboard_reader_select ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY dashboard_reader_select ON public.%I FOR SELECT TO dashboard_reader USING (true);', t
    );
  END LOOP;
END $$;
