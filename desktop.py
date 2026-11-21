"""Desktop version: runs the app on a private local port and shows it in a native window (pywebview).
Start it with `python desktop.py`.

Database: if DATABASE_URL is set (in .env next to this file, or in the environment) that PostgreSQL is used, exactly
like `uvicorn app.main:app`. If it is not set, the app runs its own private PostgreSQL (the pgserver package) with its
data in the user's data folder, so nothing has to be installed or configured.

The private PostgreSQL is started and stopped here with pg_ctl instead of by pgserver, because pgserver gives the
server only 10 seconds to start. On Windows, after an unclean shutdown PostgreSQL has to sync its whole data folder
(slow with antivirus running), the 10 seconds run out, pgserver kills the half-started server, and that kill is again
an unclean shutdown: every following start fails the same way. Here the start waits up to PG_START_TIMEOUT seconds,
the server log lives outside the data folder (so it cannot collide with the sync), and the server is stopped cleanly
when the window closes."""
import os
import socket
import subprocess
import sys
import threading
import time
from html import escape
from pathlib import Path

import psycopg
import uvicorn
import webview
from dotenv import load_dotenv

BASE = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
RES = Path(getattr(sys, "_MEIPASS", BASE))  # where the SQL files live (inside the bundle once packaged)
load_dotenv(BASE / ".env")  # next to desktop.py (or next to the .exe once packaged)

from app.main import app  # noqa: E402

TITLE = "مدیریت پروژه‌ها"
PG_START_TIMEOUT = 300  # seconds PostgreSQL may take to start (recovery after a crash can be slow)
PG_STOP_TIMEOUT = 120
# Plain SQL files that are safe to re-run; applied at every start of the embedded database. (The 003 files only create
# the limited "me_app" role, which a private single-user database does not need.)
SCHEMA = ("qaem/db/001_schema_and_table.sql", "qaem/db/002_daily_totals_view.sql",
          "shahran/db/001_schema_and_tables.sql", "shahran/db/002_views.sql")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def pg_ctl(pgdata: Path, *args: str, timeout: float) -> int:
    """Run pg_ctl from the bundled PostgreSQL and return its exit code (no output is captured: a captured pipe would
    be inherited by the server and never close). No console window flashes up in the packaged app."""
    import pgserver

    exe = Path(pgserver.__file__).parent / "pginstall" / "bin" / ("pg_ctl.exe" if sys.platform == "win32" else "pg_ctl")
    flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
    return subprocess.run([str(exe), "-D", str(pgdata), *args], timeout=timeout, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags).returncode


def ensure_running(pgdata: Path, log: Path) -> None:
    """Start the server (waiting as long as it needs) unless it is already running."""
    if pg_ctl(pgdata, "status", timeout=60) == 0:
        return
    code = pg_ctl(pgdata, "-w", "-t", str(PG_START_TIMEOUT), "-o", f"-h 127.0.0.1 -p {free_port()}", "-l", str(log),
                  "start", timeout=PG_START_TIMEOUT + 60)
    if code != 0:
        raise RuntimeError(f"pg_ctl start failed (exit code {code}); see {log}")


def start_embedded_database():
    """Start the private PostgreSQL, create/refresh the tables, point DATABASE_URL at it. Returns the server."""
    import pgserver
    from platformdirs import user_data_dir

    folder = Path(user_data_dir("ProjectManager", "Mehrshad"))
    folder.mkdir(parents=True, exist_ok=True)  # pgserver does not create the parent folder itself
    pgdata, log = folder / "pgdata", folder / "postgres.log"  # the log stays OUT of the data folder
    if not (pgdata / "PG_VERSION").exists():
        try:
            pgserver.get_server(pgdata, cleanup_mode=None)  # first run only: pgserver creates the empty database
        except Exception:
            pass  # it may be slow (antivirus scanning new files); ensure_running below finishes the job
    ensure_running(pgdata, log)
    server, last = None, None
    for _ in range(3):
        try:
            server = pgserver.get_server(pgdata, cleanup_mode=None)  # finds the running server and gives its address
            break
        except Exception as e:
            last = e
            time.sleep(5)
    if server is None:
        stop_database(pgdata)
        raise last
    try:
        with psycopg.connect(server.get_uri(), autocommit=True) as conn:
            for name in SCHEMA:
                conn.execute((RES / name).read_text(encoding="utf-8"))
    except BaseException:
        stop_database(pgdata)
        raise
    os.environ["DATABASE_URL"] = server.get_uri()
    return server


def stop_database(pgdata: Path) -> None:
    """Clean ("fast") shutdown, so the next start needs no crash recovery."""
    try:
        pg_ctl(Path(pgdata), "-w", "-t", str(PG_STOP_TIMEOUT), "-m", "fast", "stop", timeout=PG_STOP_TIMEOUT + 30)
    except Exception:
        pass  # already stopped


def stop_embedded_database(server) -> None:
    stop_database(Path(server.pgdata))


def database_problem() -> str | None:
    """None when PostgreSQL accepts the app's connection, otherwise a short Farsi message."""
    try:
        psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5).close()
    except psycopg.Error:
        return "اتصال به پایگاه داده PostgreSQL برقرار نشد. مطمئن شوید PostgreSQL روشن است و اطلاعات فایل .env درست است."
    return None


def show_error(text: str) -> None:
    page = f'<body dir="rtl" style="font:18px Tahoma,sans-serif;padding:2rem;line-height:1.8"><p>{escape(text)}</p></body>'
    webview.create_window(TITLE, html=page, width=520, height=260)
    webview.start()


def run_window() -> None:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))  # the OS picks a free port; the socket is handed to the server, so nothing can steal it
    url = f"http://127.0.0.1:{sock.getsockname()[1]}/"
    server = uvicorn.Server(uvicorn.Config(app, log_config=None))  # log_config=None: a windowed .exe has no console to log to
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    while not server.started and thread.is_alive():
        time.sleep(0.05)
    if not server.started:
        return show_error("راه‌اندازی برنامه ناموفق بود.")

    webview.settings["ALLOW_DOWNLOADS"] = True  # without this the Excel / CSV buttons do nothing
    webview.create_window(TITLE, url, width=1200, height=800, min_size=(360, 480))
    try:
        webview.start()
    finally:
        server.should_exit = True
        thread.join(5)


def main() -> None:
    database = None
    try:
        if not os.environ.get("DATABASE_URL"):
            try:
                database = start_embedded_database()
            except Exception as e:
                return show_error(f"پایگاه داده داخلی راه‌اندازی نشد: {e}")
        problem = database_problem()
        return show_error(problem) if problem else run_window()
    finally:
        if database:
            stop_embedded_database(database)


if __name__ == "__main__":
    main()
