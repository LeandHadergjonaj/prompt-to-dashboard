-- Strictly read-only role for the dashboard app. Idempotent.
-- Invoke: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v reader_password="$READER_PASSWORD" -f db/04_dashboard_reader_role.sql
-- NOTE: psql variables are NOT interpolated inside dollar-quoted DO bodies,
-- hence the \gexec pattern for role creation.

SELECT format('CREATE ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

SELECT format('ALTER ROLE dashboard_reader LOGIN PASSWORD %L CONNECTION LIMIT 10', :'reader_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_reader') \gexec

ALTER ROLE dashboard_reader SET default_transaction_read_only = on;
ALTER ROLE dashboard_reader SET statement_timeout = '20s';

-- pagila-schema.sql grants ALL (incl. CREATE) on schema public to PUBLIC; close that hole.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dashboard_reader;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_reader;

-- Belt-and-suspenders
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM dashboard_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dashboard_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM dashboard_reader;
REVOKE CREATE ON SCHEMA public FROM dashboard_reader;
