"""Desktop version: runs the app on a private local port and shows it in a native window (pywebview).
Start it with `python desktop.py`.

Database: if DATABASE_URL is set (in .env next to this file, or in the environment) that PostgreSQL is used, exactly
like `uvicorn app.main:app`. If it is not set, the app runs its own private PostgreSQL (the pgserver package) with its
data in the user's data folder, so nothing has to be installed or configured."""
import os
import socket
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
# Plain SQL files that are safe to re-run; applied at every start of the embedded database. (The 003 files only create
# the limited "me_app" role, which a private single-user database does not need.)
SCHEMA = ("qaem/db/001_schema_and_table.sql", "qaem/db/002_daily_totals_view.sql",
          "shahran/db/001_schema_and_tables.sql", "shahran/db/002_views.sql")


def start_embedded_database():
    """Start the private PostgreSQL, create/refresh the tables, point DATABASE_URL at it. Returns the server."""
    import pgserver
    from platformdirs import user_data_dir

    folder = Path(user_data_dir("ProjectManager", "Mehrshad"))
    folder.mkdir(parents=True, exist_ok=True)  # pgserver does not create the parent folder itself
    server = pgserver.get_server(folder / "pgdata", cleanup_mode=None)  # we stop it ourselves, see stop_embedded_database
    try:
        with psycopg.connect(server.get_uri(), autocommit=True) as conn:
            for name in SCHEMA:
                conn.execute((RES / name).read_text(encoding="utf-8"))
    except BaseException:
        stop_embedded_database(server)
        raise
    os.environ["DATABASE_URL"] = server.get_uri()
    return server


def stop_embedded_database(server) -> None:
    """Always stop it: pgserver's own reference counting never stops a server whose previous user crashed."""
    import pgserver

    try:
        pgserver.pg_ctl(["-w", "-m", "fast", "stop"], pgdata=server.pgdata, user=server.system_user)
    except Exception:
        pass  # already stopped


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
