-- Lets the web app role use the shahran schema (least privilege: no DDL, no TRUNCATE).
-- The role itself is created by qaem/db/003_app_role.sql, so run that one first.
-- Safe to re-run. Re-run it after re-running 002 so the app role can read the views again:
--   sudo -u postgres psql -d me_projects < shahran/db/003_app_grants.sql

GRANT USAGE ON SCHEMA shahran TO me_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shahran.workers, shahran.daily_time_sheet, shahran.daily_notes TO me_app;
GRANT SELECT ON shahran.aggregated_work, shahran.monthly_salary TO me_app;