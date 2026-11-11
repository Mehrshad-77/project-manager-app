# Project Manager

A single-user desktop application for tracking project work, built with FastAPI and PostgreSQL.
It runs as a normal Windows program (installer and desktop shortcut included) and ships with its own private database,
so nothing else has to be installed.

The interface is in **Farsi (right-to-left)** with **Solar (Jalali) dates**. Code, API and database stay in English.

## Projects

| Project | Status | What it does |
|---|---|---|
| `qaem` | Done | Daily service counts per truck, with daily and month-to-date totals |
| `shahran` | Done | Workers, daily time sheet (attendance), daily counts per role, monthly pay |
| `self` | Placeholder | Shown as "به‌زودی" (coming soon) until its tables are designed |

## Features

- **Two projects, one app.** Each project has its own database schema, API routes and front-end page.
- **Solar calendar everywhere.** Dates are picked and shown in the Solar calendar; the database stores Gregorian dates.
  Solar months are computed in the database itself, so there is one definition of "month".
- **Excel and CSV export.** Print-ready `.xlsx` tables (A4, right-to-left, repeated header) and Excel-friendly CSV.
  The shahran aggregated sheet is laid out as an official letter with totals and signature boxes.
- **Desktop app.** Runs in a native window (pywebview) on a private local port, with an optional embedded PostgreSQL.
- **Windows installer.** One `Setup.exe` that installs the app and adds a desktop shortcut.
- **Well tested.** API tests, Solar-calendar verification for every day of Solar 1200-1633, UI tests, real-browser
  layout tests and a WCAG colour-contrast check.

## Contents

- [Quick start (desktop app)](#quick-start-desktop-app)
- [Building the Windows installer](#building-the-windows-installer)
- [Running as a web app](#running-as-a-web-app)
- [Project layout](#project-layout)
- [API: qaem](#api-qaem)
- [API: shahran](#api-shahran)
- [Export to Excel](#export-to-excel)
- [How Solar months work](#how-solar-months-work-in-the-database)
- [Design](#design)
- [Tests](#tests)
- [Adding a project](#adding-a-project)

---

## Quick start (desktop app)

Requirements: Windows, and Python **3.12** (the `pgserver` package may not have a build for newer versions).

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt pywebview pgserver platformdirs
python desktop.py
```

`desktop.py` starts the app on a free local port and shows it in a native window. The database is chosen like this:

| Situation | Database used |
|---|---|
| `DATABASE_URL` is set (in `.env` next to `desktop.py`, or in the environment) | That PostgreSQL, exactly like the web version |
| `DATABASE_URL` is not set | A private PostgreSQL started by the `pgserver` package |

With the private database, the data lives in the user's data folder
(`%LOCALAPPDATA%\Mehrshad\ProjectManager\pgdata` on Windows). The tables and views are created or refreshed at every
start, and the database is stopped when the window closes. Reinstalling or updating the app does not touch the data.

## Building the Windows installer

Two steps: pack the app with PyInstaller, then wrap it with Inno Setup.

**1. Pack the app**

```powershell
pip install pyinstaller
pyinstaller desktop.py --name ProjectManager --windowed --noconfirm `
  --add-data "frontend;frontend" --add-data "qaem/db;qaem/db" --add-data "shahran/db;shahran/db" `
  --collect-all pgserver --collect-all webview --collect-all tzdata
```

The result is the folder `dist\ProjectManager\`. Run `dist\ProjectManager\ProjectManager.exe` to test it before
building the installer. The flags matter:

- `--add-data` copies the front end and the SQL files into the package (they are not Python code).
- `--collect-all pgserver` bundles the PostgreSQL binaries (the biggest part of the package).
- `--collect-all tzdata` provides the `Asia/Tehran` time zone, which Windows does not ship.
- `--windowed` hides the console window.

**2. Build the installer**

Install [Inno Setup 6](https://jrsoftware.org/isinfo.php), open `installer.iss` and press **Ctrl+F9**
(or run `ISCC.exe installer.iss`). The installer is written to:

```
installer\ProjectManager-Setup.exe
```

It installs per user (no administrator rights, which PostgreSQL requires), creates a desktop shortcut and a Start menu
entry, and offers to launch the app. Windows SmartScreen may warn about an unknown publisher because the installer is
not code-signed; choose **More info → Run anyway**.

## Running as a web app

For development, or to use an existing PostgreSQL server.

1. **Database.** All files are safe to re-run.
   ```bash
   sudo -u postgres psql -d me_projects < qaem/db/001_schema_and_table.sql
   sudo -u postgres psql -d me_projects < qaem/db/002_daily_totals_view.sql
   sudo -u postgres psql -d me_projects -v app_password='ChooseAPassword123' < qaem/db/003_app_role.sql
   sudo -u postgres psql -d me_projects < shahran/db/001_schema_and_tables.sql
   sudo -u postgres psql -d me_projects < shahran/db/002_views.sql
   sudo -u postgres psql -d me_projects < shahran/db/003_app_grants.sql
   ```
   `qaem/db/003_app_role.sql` creates the limited `me_app` role the web app uses (re-running it resets the password;
   use letters and digits only). `shahran/db/003_app_grants.sql` gives that role access to the shahran schema, so run it
   after the qaem one.

2. **Python.**
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Settings.** `cp .env.example .env` and put the same password into `DATABASE_URL`. `.env` is git-ignored: never
   commit it.

4. **Run.**
   ```bash
   uvicorn app.main:app --reload
   ```
   Open http://localhost:8000. Interactive API docs are at http://localhost:8000/docs.

## Project layout

```
app/                FastAPI app, DB pool, project registry, shared Excel/CSV export (export.py)
qaem/db/            numbered SQL files (schema + table, totals view, app role)
qaem/backend/       qaem API routes
shahran/db/         numbered SQL files (schema + tables, views, grants for the app role)
shahran/backend/    shahran API routes
frontend/           plain HTML/CSS/JS (project selector, one page per project, Solar-date helper, bundled font)
desktop.py          desktop entry point: native window, private port, optional embedded PostgreSQL
installer.iss       Inno Setup script that builds ProjectManager-Setup.exe
tests/              API tests (pytest); Solar-date, colour-contrast, UI and real-browser tests (Node)
```

---

## API: qaem

All routes are under `/api/qaem`.

| Method and path | Purpose |
|---|---|
| `POST /services` | Add a row; `409` if that truck already has a row for that day |
| `PUT /services/{day}/{truck_id}` | Set a count: creates the row or replaces the count |
| `PATCH /services/{day}/{truck_id}` | Change only the fields sent (`service_day`, `truck_id`, `truck_service_count`); `404` if missing, `409` on clash |
| `DELETE /services/{day}/{truck_id}` | Remove a row |
| `GET /services?from=&to=` | Rows between two dates (inclusive, max 400 days) |
| `GET /totals?from=&to=` | `day_total` per day and `month_total`, the running sum within that day's **Solar month** |
| `GET /export/{table}?from=&to=&format=` | Download `services` or `totals` as `xlsx` (default) or `csv` |

Dates in the API are Gregorian `YYYY-MM-DD`; the front end converts to and from Solar dates. Future dates are rejected
(Tehran time), as are dates before Solar 1300 (1921-03-21). Counts must be whole numbers `>= 0`, truck ids `> 0`.

## API: shahran

All routes are under `/api/shahran`. Same conventions as qaem: Gregorian dates, `from`/`to` ranges (max 400 days),
future dates and dates before 1921-03-21 rejected, `409` for duplicates, `422` for bad values, `404` for a missing row.

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
| `GET /monthly-salary?year=&month=` | Per worker for one **Solar** month: `work_days`, `daily_salary`, `salary` = work days x daily salary |
| `GET /export/{table}?from=&to=&format=` | Download `time-sheet` or `aggregated-work` as `xlsx` (default) or `csv` |

**Pay rules.** A day counts as a work day only when **both** `arrival_time` and `exit_time` are filled; a row with just
one of them is refused (the database enforces this too). Holidays, off-days and overtime do not change the pay. If a
worker's `daily_salary` changes, every month is recalculated at the new rate.

## Export to Excel

Each table on the qaem and shahran pages has **دانلود Excel** (`.xlsx`) and **دانلود CSV** buttons that download the month
on screen. Pay and workers are not exported. Everything is handled by `app/export.py`, shared by both projects.

- **Print-ready `.xlsx`.** Thin black grid inside a heavy frame, taller rows, a shaded centred header and the table's
  Farsi name as a heading. It opens right-to-left and prints on A4, one page wide, with the header repeated on every page.
  The CSV stays a clean table with no heading.
- **Aggregated sheet as a letter.** The shahran aggregated sheet starts with بسمه تعالی, then a typed date, addressee and
  text, then the table, a **جمع** totals row and two empty signature boxes (نقشه بردار_مسئول اجراء / مدیریت کارگاه). The three
  typed texts are fields on that tab (starting wording in `LETTER_TO` / `LETTER_BODY` at the top of
  `frontend/shahran.js`) and travel with the download as `letter_date`, `letter_to` and `letter_body`.
- **Typed values.** Every file starts with the Solar date as text (e.g. `1405/08/09`). Times are real time cells
  (`hh:mm`); counts and overtime are numbers; holiday and off-day show `✓` as on screen.
- **Formula safety.** Typed text starting with `=`, `+`, `-` or `@` cannot run as a spreadsheet formula (kept as text in
  `.xlsx`, quote-prefixed in CSV).
- **CSV and Excel.** The CSV starts with a UTF-8 BOM so Excel shows Farsi correctly. Where Excel's list separator is
  `;`, a comma CSV opens in one column, so prefer `.xlsx` there.
- **Same data as the screen.** Rows come from the same queries as the on-screen tables (`fetch_*` in each `routes.py`).

## How Solar months work in the database

The tables store Gregorian dates. Each project's `002` SQL file defines a function that converts a date to its Solar
year/month/day, and its views use it.

| Project | Function | Views |
|---|---|---|
| `qaem` | `qaem.solar_date(date)` | `qaem.daily_totals` (`day_total`, `month_total` restarting on the 1st of each Solar month) |
| `shahran` | `shahran.solar_date(date)` | `shahran.aggregated_work` (counts per day), `shahran.monthly_salary` (work days and pay per worker and Solar month) |

```bash
sudo -u postgres psql -d me_projects -c "SELECT * FROM qaem.daily_totals ORDER BY service_day;"
sudo -u postgres psql -d me_projects -c "SELECT * FROM shahran.monthly_salary ORDER BY solar_year, solar_month, full_name;"
```

The APIs read these views. After re-running a project's `002` file (it recreates the views), re-run its grants file
(`qaem/db/003_app_role.sql` or `shahran/db/003_app_grants.sql`) so the app role can read the views again.
The embedded database used by the desktop app needs no grants: it runs without the limited role.

## Design

Burgundy (`#3B1515`) on warm neutrals, large header bands, cards and clean tables. All colours are variables at the top
of `frontend/style.css`; change them there. The layout works from 320 px phones to wide desktops. The shahran page adds a
few rules (tabs, totals row, checkboxes) in `frontend/shahran.css`. The Farsi font is Vazirmatn (SIL Open Font License,
see `frontend/fonts/OFL.txt`), served from this project so it works offline.

## Tests

```bash
pip install -r requirements-dev.txt
```

**API tests** (qaem, shahran and both exports). They need a PostgreSQL superuser URL, create and drop their own
database `me_projects_test` and role `me_app_test`, and never touch `me_projects`:

```bash
TEST_ADMIN_URL=postgresql://postgres:PASSWORD@127.0.0.1:5432/postgres pytest
```

**Solar-date conversion** in JavaScript, checked against `jdatetime` for every day of Solar 1200-1633 and against
Node's ICU calendar for 1200-1500 (the SQL versions are checked in pytest):

```bash
python tests/gen_jalali_expected.py /tmp/jd.json
node tests/jalali.test.js /tmp/jd.json
```

**Colour contrast** of the palette (WCAG AA), reading the variables from `style.css`:

```bash
node tests/contrast.test.js
```

**UI and browser tests.** Run these against a server whose database is **empty and disposable** (they add and delete rows):

```bash
npm install --no-save jsdom puppeteer-core @sparticuz/chromium
node tests/ui.test.js http://127.0.0.1:8000             # every qaem UI flow, simulated browser
node tests/shahran.ui.test.js http://127.0.0.1:8000     # every shahran UI flow (and that qaem still opens)
node tests/browser.test.js http://127.0.0.1:8000        # real headless Chromium: font, layout at 6 widths, pop-up
```

## Adding a project

1. Add a new schema and numbered SQL files in `<project>/db/`, and list the files in `SCHEMA` in `desktop.py` so the
   embedded database creates them.
2. Add `<project>/backend/routes.py` with an `APIRouter(prefix="/api/<project>")`, and include it in `app/main.py`.
3. Add `frontend/<project>.js` exposing `window.<Name>View = { mount(container) }`; register it in `VIEWS` in
   `frontend/app.js` and add its `<script>` tag to `frontend/index.html`.
4. Set `active: True` for it in `PROJECTS` in `app/main.py`.
5. Grant the `me_app` role access to the new schema (see `shahran/db/003_app_grants.sql`).
6. To add downloads, give its `routes.py` an `/export/{table}` route that calls `export_file` from `app/export.py`.
7. If the project has its own SQL folder, add it to the `--add-data` flags of the PyInstaller command.