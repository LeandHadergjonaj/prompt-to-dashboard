-- Strictly read-only role for the dashboard app. Idempotent; safe to re-run.
-- Invoke: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v reader_password="$READER_PASSWORD" -f db/readonly_role.sql
-- NOTE: psql variables are NOT interpolated inside dollar-quoted DO bodies,
-- hence the \gexec pattern for role creation.

SELECT format('CREATE ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

SELECT format('ALTER ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

ALTER ROLE dashboard_reader SET default_transaction_read_only = on;
ALTER ROLE dashboard_reader SET statement_timeout = '20s';

GRANT USAGE ON SCHEMA public TO dashboard_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_reader;

-- Belt-and-suspenders
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM dashboard_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dashboard_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM dashboard_reader;
REVOKE CREATE ON SCHEMA public FROM dashboard_reader;

-- OPTIONAL (recommended where acceptable): some schemas grant CREATE on
-- schema public to PUBLIC; closing that hole hardens the whole database but
-- also affects roles other than dashboard_reader, so it is not applied by
-- default against an existing production database. Uncomment to apply.
-- REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- OPTIONAL: if your tables use row-level security, dashboard_reader needs a
-- SELECT policy per table or it will see zero rows. This additive block
-- creates one SELECT-only policy per table, scoped TO dashboard_reader, so
-- every other role's behavior is untouched (reversible via DROP POLICY).
-- Uncomment to apply.
-- DO $$
-- DECLARE
--   t text;
-- BEGIN
--   FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
--   LOOP
--     EXECUTE format('DROP POLICY IF EXISTS dashboard_reader_select ON public.%I;', t);
--     EXECUTE format(
--       'CREATE POLICY dashboard_reader_select ON public.%I FOR SELECT TO dashboard_reader USING (true);', t
--     );
--   END LOOP;
-- END $$;
