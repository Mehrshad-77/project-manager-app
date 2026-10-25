"""Tests run against a real PostgreSQL server (never the real me_projects database).

Set TEST_ADMIN_URL to a superuser connection, e.g.
  TEST_ADMIN_URL=postgresql://postgres:secret@127.0.0.1:5432/postgres pytest
The suite creates and drops its own database "me_projects_test" and role "me_app_test".
"""
import os
import pathlib
import subprocess

import psycopg
import pytest
from psycopg import sql

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "qaem" / "db"
ADMIN_URL = os.environ.get("TEST_ADMIN_URL")
TEST_DB, TEST_ROLE, TEST_PASSWORD = "me_projects_test", "me_app_test", "app-test-pw"


def _split(url, dbname):
    base = url.rsplit("/", 1)[0]
    return f"{base}/{dbname}"


def _psql(url, filename, text=None, **variables):
    args = ["psql", url, "-v", "ON_ERROR_STOP=1", "-q"]
    for k, v in variables.items():
        args += ["-v", f"{k}={v}"]
    text = text if text is not None else (DB_DIR / filename).read_text()
    subprocess.run(args, input=text, text=True, check=True, capture_output=True)


@pytest.fixture(scope="session", autouse=True)
def database():
    if not ADMIN_URL:
        pytest.exit("Set TEST_ADMIN_URL (superuser URL) to run the tests", returncode=2)
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DB)))
        admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(TEST_ROLE)))
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    test_url = _split(ADMIN_URL, TEST_DB)
    _psql(test_url, "001_schema_and_table.sql")
    _psql(test_url, "002_daily_totals_view.sql")
    role_sql = (DB_DIR / "003_app_role.sql").read_text().replace("me_app", TEST_ROLE)
    _psql(test_url, None, text=role_sql, app_password=TEST_PASSWORD)

    host = ADMIN_URL.split("@")[1].rsplit("/", 1)[0]
    app_url = f"postgresql://{TEST_ROLE}:{TEST_PASSWORD}@{host}/{TEST_DB}"
    os.environ["DATABASE_URL"] = app_url
    pytest.admin_url, pytest.app_url = test_url, app_url
    yield
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DB)))
        admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(TEST_ROLE)))


@pytest.fixture(scope="session")
def client(database):
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_table(database):
    with psycopg.connect(pytest.admin_url, autocommit=True) as conn:
        conn.execute("TRUNCATE qaem.daily_truck_services")


@pytest.fixture()
def admin():
    with psycopg.connect(pytest.admin_url, autocommit=True) as conn:
        yield conn
