"""Desktop version: runs the app on a private local port and shows it in a native window (pywebview).
Start it with `python desktop.py`. It needs the same .env and PostgreSQL as `uvicorn app.main:app`."""
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
load_dotenv(BASE / ".env")  # next to desktop.py (or next to the .exe once packaged)

from app.main import app  # noqa: E402

TITLE = "مدیریت پروژه‌ها"


def database_problem() -> str | None:
    """None when PostgreSQL accepts the app's connection, otherwise a short Farsi message."""
    try:
        psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5).close()
    except KeyError:
        return "آدرس پایگاه داده (DATABASE_URL) در فایل .env پیدا نشد."
    except psycopg.Error:
        return "اتصال به پایگاه داده PostgreSQL برقرار نشد. مطمئن شوید PostgreSQL روشن است و اطلاعات فایل .env درست است."
    return None


def show_error(text: str) -> None:
    page = f'<body dir="rtl" style="font:18px Tahoma,sans-serif;padding:2rem;line-height:1.8"><p>{escape(text)}</p></body>'
    webview.create_window(TITLE, html=page, width=520, height=260)
    webview.start()


def main() -> None:
    problem = database_problem()
    if problem:
        return show_error(problem)

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


if __name__ == "__main__":
    main()
