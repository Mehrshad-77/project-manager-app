# project-manager

One FastAPI app and one PostgreSQL database (`me_projects`) for several projects.
Each project has its own database schema, its own API routes, and its own front-end page.
The UI is in Farsi (right-to-left) with Solar (Jalali) dates; code, API and database stay in English.

| Project | Status |
|---|---|
| `qaem` | Done: daily service counts per truck, with daily and month-to-date totals |
| `shahran` | Done: workers, daily time sheet (attendance), daily counts per role, monthly pay |
| `self` | Placeholder ("به‌زودی") until its tables are designed |

## Layout

```
app/                FastAPI app, DB pool, project registry, shared Excel/CSV export (export.py)
qaem/db/            numbered SQL files (schema + table, totals view, app role)
qaem/backend/       qaem API routes
shahran/db/         numbered SQL files (schema + tables, views, grants for the app role)
shahran/backend/    shahran API routes
frontend/           plain HTML/CSS/JS (project selector, one page per project, Solar-date helper, bundled font)
tests/              API tests (pytest); Solar-date, colour-contrast, UI and real-browser tests (Node)
```

## Setup (WSL2 / Linux)

1. **Database.** If `me_projects` already has a project's schema you can skip that project's first commands.
   All files are safe to re-run.
   ```bash
   sudo -u postgres psql -d me_projects < qaem/db/001_schema_and_table.sql
   sudo -u postgres psql -d me_projects < qaem/db/002_daily_totals_view.sql
   sudo -u postgres psql -d me_projects -v app_password='ChooseAPassword123' < qaem/db/003_app_role.sql
   sudo -u postgres psql -d me_projects < shahran/db/001_schema_and_tables.sql
   sudo -u postgres psql -d me_projects < shahran/db/002_views.sql
   sudo -u postgres psql -d me_projects < shahran/db/003_app_grants.sql
   ```
   `qaem/db/003_app_role.sql` creates the limited `me_app` role the web app uses; re-running it just resets the password.
   Use letters and digits only in the password. `shahran/db/003_app_grants.sql` gives that role access to the shahran
   schema (read/write on its three tables, read on its two views), so run it after the qaem one.

2. **Python.**
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Settings.** `cp .env.example .env`, then put the same password into `DATABASE_URL`.
   `.env` is git-ignored: never commit it.

4. **Run.**
   ```bash
   uvicorn app.main:app --reload
   ```
   Open http://localhost:8000 (works from the Windows browser too).

## API (qaem), all under `/api/qaem`

| Method and path | Purpose |
|---|---|
| `POST /services` | Add a row; `409` if that truck already has a row for that day |
| `PUT /services/{day}/{truck_id}` | Set a count: creates the row or replaces the count |
| `PATCH /services/{day}/{truck_id}` | Change only the fields sent (`service_day`, `truck_id`, `truck_service_count`); `404` if missing, `409` on clash |
| `DELETE /services/{day}/{truck_id}` | Remove a row |
| `GET /services?from=&to=` | Rows between two dates (inclusive, max 400 days) |
| `GET /totals?from=&to=` | `day_total` per day and `month_total`, the running sum within that day's **Solar month** |
| `GET /export/{table}?from=&to=&format=` | Download `services` or `totals` for the range as `xlsx` (default) or `csv` |

Dates in the API are Gregorian `YYYY-MM-DD`; the front end converts to and from Solar dates.
Future dates are rejected (Tehran time), as are dates before Solar 1300 (1921-03-21).
Counts must be whole numbers `>= 0`, truck ids `> 0`.
Interactive docs: http://localhost:8000/docs

## API (shahran), all under `/api/shahran`

Same conventions as qaem: Gregorian dates, `from`/`to` ranges (max 400 days), future dates and dates before
1921-03-21 rejected, `409` for duplicates, `422` for bad values, `404` for a missing row.

| Method and path | Purpose |
|---|---|
| `GET /workers`, `POST /workers` | List workers / add one (`full_name`, `role` = `simple` or `builder`, `daily_salary`); `409` if the name exists |
| `PATCH /workers/{id}`, `DELETE /workers/{id}` | Change only the fields sent / remove; delete gives `409` while the worker has time sheet rows |
| `GET /time-sheet?from=&to=` | Time sheet rows with the worker's name |
| `POST /time-sheet` | Add a row for a worker and day: `arrival_time`, `exit_time`, `overtime` (hours, 0-24), `is_holiday`, `is_off_day`, `explanation` |
| `PATCH /time-sheet/{day}/{worker_id}` | Change only the fields sent; send `null` to empty a time or the explanation; the day and worker can be changed too |
| `DELETE /time-sheet/{day}/{worker_id}` | Remove a row |
| `GET /aggregated-work?from=&to=` | One row for every day: `total_workers`, `simple_workers`, `builders`, `explanation` (zeros on days nobody worked) |
| `PUT /aggregated-work/{day}`, `DELETE /aggregated-work/{day}` | Set or clear that day's explanation (the only typed part of the sheet) |
| `GET /monthly-salary?year=&month=` | Per worker for one **Solar** month (`year` and `month` are Solar numbers): `work_days`, `daily_salary`, `salary` = work days x daily salary |
| `GET /export/{table}?from=&to=&format=` | Download `time-sheet` (کارکرد روزانه) or `aggregated-work` (کارکرد تجمیعی ماهانه) for the range as `xlsx` (default) or `csv` |

A day counts as a work day only when **both** `arrival_time` and `exit_time` are filled; a row with just one of them is
refused (the database enforces it too). Holidays, off-days and overtime do not change the pay.
If a worker's `daily_salary` is changed, every month is recalculated at the new rate.

### Export to Excel

Each table on the qaem and shahran pages has **دانلود Excel** (`.xlsx`) and **دانلود CSV** buttons; they download the month
on screen (shahran: the daily time sheet and the aggregated sheet; pay and workers are not exported). All of it is done by
`app/export.py`, which the two projects share.

- The `.xlsx` has the table's Farsi name as a bold heading in row 1 (the CSV stays a clean table with no heading row),
  Farsi column headers in row 2, and opens right-to-left.
- Every file starts with the Solar date (text, e.g. `1405/08/09`) and the Gregorian date (a real date cell, so it sorts and
  filters). Times are real time cells (`hh:mm`), counts and overtime are numbers; holiday / off-day show `✓` as on screen.
- Typed text that starts with `=`, `+`, `-` or `@` cannot run as a spreadsheet formula (kept as text in `.xlsx`, quote-prefixed in CSV).
- The CSV starts with a UTF-8 BOM so Excel shows Farsi correctly. In locales where Excel's list separator is `;` a comma CSV
  opens in one column, so prefer the `.xlsx` there.
- The rows are produced by the same queries as the screen (`fetch_*` functions in each `routes.py`).

### How Solar months work in the database

The tables store Gregorian dates. Each project's `002` SQL file uses a function that converts a date to its Solar
year/month/day, and its views use it, so there is one definition of "month" and it lives in the database:

| Project | Function | Views |
|---|---|---|
| `qaem` | `qaem.solar_date(date)` | `qaem.daily_totals` (`day_total`, `month_total` restarting on the 1st of each Solar month) |
| `shahran` | `shahran.solar_date(date)` | `shahran.aggregated_work` (counts per day), `shahran.monthly_salary` (work days and pay per worker and Solar month) |

```bash
sudo -u postgres psql -d me_projects -c "SELECT * FROM qaem.daily_totals ORDER BY service_day;"
sudo -u postgres psql -d me_projects -c "SELECT * FROM shahran.monthly_salary ORDER BY solar_year, solar_month, full_name;"
```

The APIs read these views. After re-running a project's `002` (it recreates the views), re-run its grants file
(`qaem/db/003_app_role.sql` or `shahran/db/003_app_grants.sql`) so the app role can read the views again.

## Design

Burgundy (`#3B1515`) on warm neutrals, large header bands, cards and clean tables, in the style of reckoner.com.
All colours are variables at the top of `frontend/style.css`; change them there. Layout works from 320 px phones to wide
desktops. The shahran page adds a few rules (tabs, totals row, checkboxes) in `frontend/shahran.css`, using the same colour
variables. The Farsi font is Vazirmatn (SIL Open Font License, see `frontend/fonts/OFL.txt`), served from this project so
it also works offline.

## Tests

```bash
pip install -r requirements-dev.txt

# API tests (qaem, shahran and both exports): need a superuser URL; they create and drop their own database
# "me_projects_test" and role "me_app_test" and never touch me_projects.
TEST_ADMIN_URL=postgresql://postgres:PASSWORD@127.0.0.1:5432/postgres pytest

# Solar-date conversion (JavaScript) vs jdatetime for every day of Solar 1200-1633,
# and vs Node's ICU calendar for 1200-1500 (the SQL versions are checked in pytest)
python tests/gen_jalali_expected.py /tmp/jd.json
node tests/jalali.test.js /tmp/jd.json

# Colour contrast of the palette (WCAG AA), reads the variables from style.css
node tests/contrast.test.js

# Against a running server whose database is EMPTY and disposable (these tests add and delete rows):
npm install --no-save jsdom puppeteer-core @sparticuz/chromium
node tests/ui.test.js http://127.0.0.1:8000             # every qaem UI flow, simulated browser
node tests/shahran.ui.test.js http://127.0.0.1:8000     # every shahran UI flow (and that qaem still opens)
node tests/browser.test.js http://127.0.0.1:8000        # real headless Chromium: font, layout at 6 widths, pop-up
```

## Adding a project

1. New schema + numbered SQL files in `<project>/db/`.
2. `<project>/backend/routes.py` with an `APIRouter(prefix="/api/<project>")`; include it in `app/main.py`.
3. `frontend/<project>.js` exposing `window.<Name>View = { mount(container) }`; add it to `VIEWS` in `frontend/app.js`
   and add its `<script>` tag to `frontend/index.html`.
4. Set `active: True` for it in `PROJECTS` in `app/main.py`.
5. Grant the `me_app` role access to the new schema (see `shahran/db/003_app_grants.sql`).
6. To add downloads, give its `routes.py` an `/export/{table}` route that calls `export_file` from `app/export.py`.