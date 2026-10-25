-- Limited role the web app connects as (never connect the app as "postgres").
-- Safe to re-run: creates the role if missing and (re)sets its password.
-- Run as a superuser against your database, passing the password on the command line
-- so it never lands in git:
--   psql -d me_projects -v app_password='YOUR_PASSWORD' < qaem/db/003_app_role.sql
-- Use letters and digits in the password so it can sit in DATABASE_URL without escaping.

SELECT 'CREATE ROLE me_app LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'me_app') \gexec

ALTER ROLE me_app PASSWORD :'app_password';

SELECT format('GRANT CONNECT ON DATABASE %I TO me_app', current_database()) \gexec

GRANT USAGE ON SCHEMA qaem TO me_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON qaem.daily_truck_services TO me_app;
GRANT SELECT ON qaem.daily_totals TO me_app;