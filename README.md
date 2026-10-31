# project-manager

One FastAPI app and one PostgreSQL database (`me_projects`) for several projects.
Each project has its own database schema, its own API routes, and its own front-end page.
The UI is in Farsi (right-to-left) with Solar (Jalali) dates; code, API and database stay in English.

| Project | Status |
|---|---|
| `qaem` | Done: daily service counts per truck, with daily and month-to-date totals |
| `shahran`, `self` | Placeholders ("به‌زودی") until their tables are designed |

## Layout

```
app/                FastAPI app, DB pool, project registry
qaem/db/            numbered SQL files (schema + table, totals view, app role)
qaem/backend/       qaem API routes
frontend/           plain HTML/CSS/JS (project selector, qaem page, Solar-date helper, bundled font)
tests/              API tests (pytest); Solar-date, colour-contrast, UI and real-browser tests (Node)
```

## Setup (WSL2 / Linux)

1. **Database.** If `me_projects` already has the `qaem` schema and table you can skip the first two commands.
   Both files are safe to re-run.
   ```bash
   sudo -u postgres psql -d me_projects < qaem/db/001_schema_and_table.sql
   sudo -u postgres psql -d me_projects < qaem/db/002_daily_totals_view.sql
   sudo -u postgres psql -d me_projects -v app_password='ChooseAPassword123' < qaem/db/003_app_role.sql
   ```
   The last command creates the limited `me_app` role the web app uses (read/write on the qaem table only).
   Re-running it just resets the password. Use letters and digits only in the password.

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

### Export to Excel

Each table on the qaem page has **دانلود Excel** (`.xlsx`) and **دانلود CSV** buttons; they download the month on screen.
The `.xlsx` has the table's Farsi name as a bold heading in row 1 (the CSV stays a clean table with no heading row).
Columns: Solar date (text, e.g. `1405/08/09`), Gregorian date (a real date cell, so it sorts and filters), then the numbers.
Headers are Farsi and the sheet opens right-to-left. The CSV starts with a UTF-8 BOM so Excel shows Farsi correctly;
in locales where Excel's list separator is `;` a comma CSV opens in one column, so prefer the `.xlsx` there.
The export uses the same queries as the screen (`fetch_services`, `fetch_totals` in `qaem/backend/routes.py`).

### How Solar months work in the database

The table stores Gregorian dates. `qaem/db/002_daily_totals_view.sql` adds a function,
`qaem.solar_date(date)`, that converts a date to its Solar year/month/day, and the view
`qaem.daily_totals` that uses it:

| Column | Meaning |
|---|---|
| `service_day`, `solar_year`, `solar_month` | the day and its Solar month |
| `day_total` | sum of every truck's count that day |
| `month_total` | running sum of `day_total` inside the Solar month (restarts on the 1st of each Solar month) |

```bash
sudo -u postgres psql -d me_projects -c "SELECT * FROM qaem.daily_totals ORDER BY service_day;"
```

The API reads this view, so there is one definition of "month" and it lives in the database.
After re-running `002` (it recreates the view), re-run `003` so the app role can read the view again.

## Design

Burgundy (`#3B1515`) on warm neutrals, large header bands, cards and clean tables, in the style of reckoner.com.
All colours are variables at the top of `frontend/style.css`; change them there. Layout works from 320 px phones to wide
desktops. The Farsi font is Vazirmatn (SIL Open Font License, see `frontend/fonts/OFL.txt`), served from this project so
it also works offline.

## Tests

```bash
pip install -r requirements-dev.txt

# API tests (including tests/test_export.py): need a superuser URL; they create and drop their own database
# "me_projects_test" and role "me_app_test" and never touch me_projects.
TEST_ADMIN_URL=postgresql://postgres:PASSWORD@127.0.0.1:5432/postgres pytest

# Solar-date conversion (JavaScript) vs jdatetime for every day of Solar 1200-1633,
# and vs Node's ICU calendar for 1200-1500 (the SQL version is checked in pytest)
python tests/gen_jalali_expected.py /tmp/jd.json
node tests/jalali.test.js /tmp/jd.json

# Colour contrast of the palette (WCAG AA), reads the variables from style.css
node tests/contrast.test.js

# Against a running server whose database is EMPTY and disposable (these tests add and delete rows):
npm install --no-save jsdom puppeteer-core @sparticuz/chromium
node tests/ui.test.js http://127.0.0.1:8000        # every UI flow, simulated browser
node tests/browser.test.js http://127.0.0.1:8000   # real headless Chromium: font, layout at 6 widths, pop-up
```

## Adding a project

1. New schema + numbered SQL files in `<project>/db/`.
2. `<project>/backend/routes.py` with an `APIRouter(prefix="/api/<project>")`; include it in `app/main.py`.
3. `frontend/<project>.js` exposing `window.<Name>View = { mount(container) }`; add it to `VIEWS` in `frontend/app.js`.
4. Set `active: True` for it in `PROJECTS` in `app/main.py`.
5. Grant the `me_app` role access to the new schema.