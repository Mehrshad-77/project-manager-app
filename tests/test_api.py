import threading
from datetime import timedelta

import psycopg
import pytest

from qaem.backend.routes import today

BASE = "/api/qaem"
D1 = "2026-09-30"
D2 = "2026-10-01"


def add(client, day=D1, truck=1, count=5):
    return client.post(f"{BASE}/services", json={"service_day": day, "truck_id": truck, "truck_service_count": count})


def rows(client, a="2026-01-01", b="2026-12-31"):
    return client.get(f"{BASE}/services", params={"from": a, "to": b}).json()


# ---------- app basics ----------
def test_health_and_projects(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    projects = client.get("/api/projects").json()
    assert [p["id"] for p in projects] == ["qaem", "shahran", "self"]
    assert [p["active"] for p in projects] == [True, False, False]
    assert [p["title"] for p in projects] == ["قائم", "شهران", "خودکفایی"]
    assert all(len(p["description"]) > 5 for p in projects)


def test_frontend_is_served_and_api_404s_are_not_html(client):
    r = client.get("/")
    assert r.status_code == 200 and 'dir="rtl"' in r.text and 'lang="fa"' in r.text
    assert client.get("/jalali.js").status_code == 200
    assert client.get("/api/does-not-exist").status_code == 404


# ---------- POST ----------
def test_create_then_duplicate_is_409(client):
    r = add(client)
    assert r.status_code == 201
    assert r.json() == {"service_day": D1, "truck_id": 1, "truck_service_count": 5}
    assert add(client, count=9).status_code == 409
    assert rows(client) == [r.json()]  # original untouched


def test_same_truck_different_days_and_same_day_different_trucks_allowed(client):
    assert add(client, D1, 1).status_code == 201
    assert add(client, D2, 1).status_code == 201
    assert add(client, D1, 2).status_code == 201


@pytest.mark.parametrize("body", [
    {"service_day": D1, "truck_id": 0, "truck_service_count": 1},
    {"service_day": D1, "truck_id": -3, "truck_service_count": 1},
    {"service_day": D1, "truck_id": 1, "truck_service_count": -1},
    {"service_day": D1, "truck_id": "5", "truck_service_count": 1},
    {"service_day": D1, "truck_id": 1, "truck_service_count": "5"},
    {"service_day": D1, "truck_id": 1.5, "truck_service_count": 1},
    {"service_day": D1, "truck_id": True, "truck_service_count": 1},
    {"service_day": D1, "truck_id": 2147483648, "truck_service_count": 1},
    {"service_day": D1, "truck_id": 1, "truck_service_count": 2147483648},
    {"service_day": "not-a-date", "truck_id": 1, "truck_service_count": 1},
    {"service_day": "2026-02-30", "truck_id": 1, "truck_service_count": 1},
    {"truck_id": 1, "truck_service_count": 1},
    {"service_day": D1, "truck_service_count": 1},
    {"service_day": D1, "truck_id": 1},
    {},
])
def test_create_rejects_bad_input(client, body):
    assert client.post(f"{BASE}/services", json=body).status_code == 422
    assert rows(client) == []


def test_create_accepts_zero_count_and_int_max(client):
    assert add(client, count=0).status_code == 201
    assert add(client, truck=2147483647, count=2147483647).status_code == 201


def test_future_date_rejected_but_today_ok(client):
    assert add(client, str(today() + timedelta(days=1))).status_code == 422
    assert add(client, str(today())).status_code == 201


# ---------- PUT ----------
def test_put_creates_then_replaces(client):
    r = client.put(f"{BASE}/services/{D1}/7", json={"truck_service_count": 3})
    assert r.status_code == 200 and r.json()["truck_service_count"] == 3
    r = client.put(f"{BASE}/services/{D1}/7", json={"truck_service_count": 8})
    assert r.status_code == 200
    assert rows(client) == [{"service_day": D1, "truck_id": 7, "truck_service_count": 8}]


def test_put_validation(client):
    assert client.put(f"{BASE}/services/{D1}/7", json={"truck_service_count": -1}).status_code == 422
    assert client.put(f"{BASE}/services/{D1}/0", json={"truck_service_count": 1}).status_code == 422
    assert client.put(f"{BASE}/services/{D1}/abc", json={"truck_service_count": 1}).status_code == 422
    assert client.put(f"{BASE}/services/2026-13-01/1", json={"truck_service_count": 1}).status_code == 422
    future = today() + timedelta(days=1)
    assert client.put(f"{BASE}/services/{future}/1", json={"truck_service_count": 1}).status_code == 422
    assert rows(client) == []


# ---------- PATCH ----------
def test_patch_each_field_alone(client):
    add(client, D1, 1, 5)
    assert client.patch(f"{BASE}/services/{D1}/1", json={"truck_service_count": 6}).json() == {
        "service_day": D1, "truck_id": 1, "truck_service_count": 6}
    assert client.patch(f"{BASE}/services/{D1}/1", json={"truck_id": 2}).json() == {
        "service_day": D1, "truck_id": 2, "truck_service_count": 6}
    assert client.patch(f"{BASE}/services/{D1}/2", json={"service_day": D2}).json() == {
        "service_day": D2, "truck_id": 2, "truck_service_count": 6}
    assert len(rows(client)) == 1


def test_patch_several_fields_and_count_zero(client):
    add(client, D1, 1, 5)
    r = client.patch(f"{BASE}/services/{D1}/1", json={"service_day": D2, "truck_id": 9, "truck_service_count": 0})
    assert r.json() == {"service_day": D2, "truck_id": 9, "truck_service_count": 0}


def test_patch_onto_occupied_key_is_409_and_nothing_changes(client):
    add(client, D1, 1, 5)
    add(client, D1, 2, 7)
    assert client.patch(f"{BASE}/services/{D1}/1", json={"truck_id": 2}).status_code == 409
    assert client.patch(f"{BASE}/services/{D1}/1", json={"truck_id": 2, "truck_service_count": 99}).status_code == 409
    assert rows(client) == [
        {"service_day": D1, "truck_id": 1, "truck_service_count": 5},
        {"service_day": D1, "truck_id": 2, "truck_service_count": 7},
    ]


def test_patch_missing_row_is_404(client):
    assert client.patch(f"{BASE}/services/{D1}/1", json={"truck_service_count": 1}).status_code == 404


@pytest.mark.parametrize("body", [
    {}, {"truck_id": None}, {"service_day": None, "truck_service_count": None},
    {"truck_id": 0}, {"truck_service_count": -1}, {"truck_id": "3"}, {"service_day": "nope"},
    {"service_day": "2999-01-01"},
])
def test_patch_rejects_bad_bodies(client, body):
    add(client, D1, 1, 5)
    assert client.patch(f"{BASE}/services/{D1}/1", json=body).status_code == 422
    assert rows(client) == [{"service_day": D1, "truck_id": 1, "truck_service_count": 5}]


def test_patch_ignores_unknown_fields_without_changing_anything_else(client):
    add(client, D1, 1, 5)
    r = client.patch(f"{BASE}/services/{D1}/1", json={"truck_service_count": 6, "id": 99})
    assert r.status_code == 200 and r.json()["truck_service_count"] == 6


# ---------- DELETE ----------
def test_delete_then_404(client):
    add(client)
    assert client.delete(f"{BASE}/services/{D1}/1").status_code == 204
    assert client.delete(f"{BASE}/services/{D1}/1").status_code == 404
    assert rows(client) == []


# ---------- GET services ----------
def test_list_is_ordered_and_range_inclusive(client):
    add(client, D2, 2, 1); add(client, D1, 3, 1); add(client, D1, 1, 1); add(client, "2026-10-05", 1, 1)
    got = rows(client, D1, D2)
    assert [(r["service_day"], r["truck_id"]) for r in got] == [(D1, 1), (D1, 3), (D2, 2)]
    assert rows(client, D1, D1) == [r for r in got if r["service_day"] == D1]


@pytest.mark.parametrize("params", [
    {}, {"from": D1}, {"to": D1}, {"from": D2, "to": D1}, {"from": "x", "to": D1},
    {"from": "2020-01-01", "to": "2026-01-01"},
])
def test_list_and_totals_reject_bad_ranges(client, params):
    assert client.get(f"{BASE}/services", params=params).status_code == 422
    assert client.get(f"{BASE}/totals", params=params).status_code == 422


# ---------- totals ----------
def test_totals_sum_trucks_and_run_across_days(client):
    add(client, "2026-10-01", 1, 2); add(client, "2026-10-01", 2, 3)
    add(client, "2026-10-03", 1, 4)          # 10-02 has no rows
    add(client, "2026-10-04", 1, 0)
    got = client.get(f"{BASE}/totals", params={"from": "2026-10-01", "to": "2026-10-31"}).json()
    assert got == [
        {"service_day": "2026-10-01", "day_total": 5, "month_total": 5},
        {"service_day": "2026-10-03", "day_total": 4, "month_total": 9},
        {"service_day": "2026-10-04", "day_total": 0, "month_total": 9},
    ]


def test_month_total_is_a_solar_month_even_when_range_cuts_the_month(client):
    # Mehr 1405 = 2026-09-23 .. 2026-10-22. Ask for only the last part: running total must still include earlier days.
    add(client, "2026-09-30", 1, 10); add(client, "2026-10-01", 1, 5); add(client, "2026-10-22", 1, 1)
    got = client.get(f"{BASE}/totals", params={"from": "2026-10-01", "to": "2026-10-31"}).json()
    assert [(t["service_day"], t["day_total"], t["month_total"]) for t in got] == [
        ("2026-10-01", 5, 15), ("2026-10-22", 1, 16)]


def test_solar_month_boundaries(client):
    # Esfand 1403 (leap) has 30 days: 2025-03-20 is its last day; 2025-03-21 is 1404/01/01.
    add(client, "2025-03-19", 1, 1); add(client, "2025-03-20", 1, 2); add(client, "2025-03-21", 1, 4); add(client, "2025-03-22", 1, 8)
    got = client.get(f"{BASE}/totals", params={"from": "2025-03-01", "to": "2025-04-30"}).json()
    assert [(t["service_day"], t["month_total"]) for t in got] == [
        ("2025-03-19", 1), ("2025-03-20", 3), ("2025-03-21", 4), ("2025-03-22", 12)]


def test_running_total_follows_requested_range_not_gregorian_month(client):
    # A Solar month (e.g. Mehr 1405 = 2026-09-23..2026-10-22) spans two Gregorian months.
    add(client, "2026-09-30", 1, 10); add(client, "2026-10-01", 1, 5); add(client, "2026-10-22", 1, 1)
    add(client, "2026-09-22", 1, 100)        # previous Solar month: must not leak in
    add(client, "2026-10-23", 1, 1000)       # next Solar month: must not leak in
    got = client.get(f"{BASE}/totals", params={"from": "2026-09-23", "to": "2026-10-22"}).json()
    assert [(t["service_day"], t["day_total"], t["month_total"]) for t in got] == [
        ("2026-09-30", 10, 10), ("2026-10-01", 5, 15), ("2026-10-22", 1, 16)]


def test_dates_before_solar_1300_rejected(client):
    assert add(client, "1921-03-20").status_code == 422
    assert add(client, "1921-03-21").status_code == 201
    assert add(client, "0001-01-01", truck=2).status_code == 422


def test_totals_empty_range(client):
    assert client.get(f"{BASE}/totals", params={"from": D1, "to": D2}).json() == []


# ---------- database-level guarantees (independent of the API) ----------
def test_db_rejects_negative_and_duplicate_even_when_api_is_bypassed(admin):
    admin.execute("INSERT INTO qaem.daily_truck_services VALUES ('2026-10-01', 1, 1)")
    with pytest.raises(psycopg.errors.UniqueViolation):
        admin.execute("INSERT INTO qaem.daily_truck_services VALUES ('2026-10-01', 1, 2)")
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute("INSERT INTO qaem.daily_truck_services VALUES ('2026-10-01', 2, -1)")


def test_app_role_is_least_privilege(database):
    with psycopg.connect(pytest.app_url, autocommit=True) as conn:
        conn.execute("SELECT * FROM qaem.daily_truck_services")
        for stmt in ("CREATE TABLE qaem.x (a int)", "DROP TABLE qaem.daily_truck_services",
                     "TRUNCATE qaem.daily_truck_services", "CREATE SCHEMA evil",
                     "ALTER TABLE qaem.daily_truck_services DROP COLUMN truck_id"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(stmt)


# ---------- the SQL Solar calendar must agree with jdatetime for every day ----------
def test_sql_solar_date_matches_jdatetime_for_every_day_1200_to_1633(admin):
    import jdatetime

    start = jdatetime.date(1200, 1, 1).togregorian()
    end = jdatetime.date(1633, 12, 29).togregorian()
    rows = admin.execute(
        "SELECT d::date, s.jy, s.jm, s.jd FROM generate_series(%s::date, %s::date, '1 day') d, "
        "LATERAL qaem.solar_date(d::date) s ORDER BY d",
        (start, end),
    ).fetchall()
    assert len(rows) == (end - start).days + 1 > 150_000
    bad = [r for r in rows
           if (lambda j: (j.year, j.month, j.day))(jdatetime.date.fromgregorian(date=r[0])) != (r[1], r[2], r[3])]
    assert bad == []


# ---------- concurrency ----------
def test_racing_duplicate_inserts_give_exactly_one_201_never_500(client):
    codes, barrier = [], threading.Barrier(8)

    def go():
        barrier.wait()
        codes.append(add(client, D1, 1, 5).status_code)

    threads = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert sorted(codes) == [201] + [409] * 7
    assert len(rows(client)) == 1