import threading
from datetime import date, timedelta

import psycopg
import pytest

from shahran.backend.routes import today

BASE = "/api/shahran"

# Solar calendar anchors (Gregorian): 1 Mehr 1405 = 2026-09-23, 30 Mehr = 2026-10-22, 1 Aban = 2026-10-23
MEHR_1, MEHR_30, ABAN_1, ABAN_2 = "2026-09-23", "2026-10-22", "2026-10-23", "2026-10-24"
MEHR = {"from": "2026-09-23", "to": "2026-10-22"}
ABAN = {"from": "2026-10-23", "to": "2026-11-21"}


@pytest.fixture(autouse=True)
def clean_shahran(database):
    with psycopg.connect(pytest.admin_url, autocommit=True) as conn:
        conn.execute("TRUNCATE shahran.daily_time_sheet, shahran.daily_notes, shahran.workers RESTART IDENTITY CASCADE")


def worker(client, name, role="simple", salary=1_000_000):
    r = client.post(f"{BASE}/workers", json={"full_name": name, "role": role, "daily_salary": salary})
    assert r.status_code == 201, r.text
    return r.json()["worker_id"]


def sheet(client, day, wid, a="07:00", e="16:00", **extra):
    r = client.post(f"{BASE}/time-sheet", json={"work_day": day, "worker_id": wid, "arrival_time": a, "exit_time": e, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def rows(client, rng=None):
    return client.get(f"{BASE}/time-sheet", params=rng or {"from": "2026-01-01", "to": "2026-12-31"}).json()


# ---------- workers ----------
def test_workers_crud(client):
    wid = worker(client, "Ali", "simple", 1_000_000)
    assert client.get(f"{BASE}/workers").json() == [
        {"worker_id": wid, "full_name": "Ali", "role": "simple", "daily_salary": 1_000_000}]
    r = client.patch(f"{BASE}/workers/{wid}", json={"daily_salary": 1_500_000})
    assert r.status_code == 200 and r.json()["daily_salary"] == 1_500_000
    r = client.patch(f"{BASE}/workers/{wid}", json={"role": "builder", "full_name": "  Ali R  "})
    assert r.json()["role"] == "builder" and r.json()["full_name"] == "Ali R"
    assert client.delete(f"{BASE}/workers/{wid}").status_code == 204
    assert client.delete(f"{BASE}/workers/{wid}").status_code == 404
    assert client.get(f"{BASE}/workers").json() == []


def test_workers_validation(client):
    wid = worker(client, "Ali")
    post = lambda **kw: client.post(f"{BASE}/workers", json={"full_name": "Z", "role": "simple", "daily_salary": 1, **kw})
    assert post(full_name="Ali").status_code == 409
    assert post(full_name="   ").status_code == 422
    assert post(role="boss").status_code == 422
    assert post(daily_salary=-1).status_code == 422
    assert post(daily_salary="5").status_code == 422
    assert post(daily_salary=1.5).status_code == 422
    assert post(daily_salary=10**12 + 1).status_code == 422
    assert client.post(f"{BASE}/workers", json={}).status_code == 422
    assert client.patch(f"{BASE}/workers/{wid}", json={}).status_code == 422
    assert client.patch(f"{BASE}/workers/{wid}", json={"full_name": None}).status_code == 422
    assert client.patch(f"{BASE}/workers/{wid}", json={"role": "x"}).status_code == 422
    assert client.patch(f"{BASE}/workers/999", json={"daily_salary": 5}).status_code == 404
    assert client.patch(f"{BASE}/workers/0", json={"daily_salary": 5}).status_code == 422
    worker(client, "Reza")
    assert client.patch(f"{BASE}/workers/{wid}", json={"full_name": "Reza"}).status_code == 409


def test_worker_with_time_sheet_rows_cannot_be_deleted(client):
    wid = worker(client, "Ali")
    sheet(client, ABAN_1, wid)
    assert client.delete(f"{BASE}/workers/{wid}").status_code == 409
    client.delete(f"{BASE}/time-sheet/{ABAN_1}/{wid}")
    assert client.delete(f"{BASE}/workers/{wid}").status_code == 204


# ---------- time sheet ----------
def test_time_sheet_create_list_patch_delete(client):
    wid = worker(client, "Ali")
    row = sheet(client, ABAN_1, wid, overtime=2, explanation="  late  ")
    assert row == {"work_day": ABAN_1, "worker_id": wid, "full_name": None, "arrival_time": "07:00:00",
                   "exit_time": "16:00:00", "overtime": 2.0, "is_holiday": False, "is_off_day": False, "explanation": "late"}
    listed = rows(client, ABAN)
    assert len(listed) == 1 and listed[0]["full_name"] == "Ali"
    assert rows(client, MEHR) == []
    # change one field, then empty both times, flags and explanation
    r = client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}", json={"exit_time": "17:30"})
    assert r.json()["exit_time"] == "17:30:00" and r.json()["arrival_time"] == "07:00:00"
    r = client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}",
                     json={"arrival_time": None, "exit_time": None, "is_off_day": True, "explanation": None})
    assert r.status_code == 200 and r.json()["arrival_time"] is None and r.json()["is_off_day"] is True
    assert r.json()["explanation"] is None
    assert client.delete(f"{BASE}/time-sheet/{ABAN_1}/{wid}").status_code == 204
    assert client.delete(f"{BASE}/time-sheet/{ABAN_1}/{wid}").status_code == 404


def test_time_sheet_rows_can_move_to_another_day_or_worker(client):
    ali, reza = worker(client, "Ali"), worker(client, "Reza")
    sheet(client, ABAN_1, ali)
    sheet(client, ABAN_2, reza)
    moved = client.patch(f"{BASE}/time-sheet/{ABAN_1}/{ali}", json={"work_day": MEHR_30, "worker_id": reza}).json()
    assert (moved["work_day"], moved["worker_id"]) == (MEHR_30, reza)
    # moving onto an occupied key is refused and changes nothing
    assert client.patch(f"{BASE}/time-sheet/{MEHR_30}/{reza}", json={"work_day": ABAN_2}).status_code == 409
    assert client.patch(f"{BASE}/time-sheet/{MEHR_30}/{reza}", json={"worker_id": 999}).status_code == 409
    assert sorted((r["work_day"], r["worker_id"]) for r in rows(client)) == [(MEHR_30, reza), (ABAN_2, reza)]


@pytest.mark.parametrize("body", [
    {"arrival_time": "07:00"}, {"exit_time": "16:00"},                      # only one time
    {"overtime": -1}, {"overtime": 25}, {"overtime": 1.234}, {"overtime": "x"},
    {"arrival_time": "25:00", "exit_time": "16:00"},
    {"is_holiday": "yes"}, {"is_off_day": 1},
    {"work_day": "not-a-date"}, {"work_day": "2026-02-30"}, {"work_day": "1921-03-20"},
    {"work_day": str(today() + timedelta(days=1))},
])
def test_time_sheet_rejects_bad_input(client, body):
    wid = worker(client, "Ali")
    r = client.post(f"{BASE}/time-sheet", json={"work_day": ABAN_1, "worker_id": wid, **body})
    assert r.status_code == 422
    assert rows(client) == []


def test_time_sheet_other_rules(client):
    wid = worker(client, "Ali")
    post = lambda **kw: client.post(f"{BASE}/time-sheet", json={"work_day": ABAN_1, "worker_id": wid, **kw})
    assert post(worker_id=999).status_code == 409                 # unknown worker
    assert post(worker_id="1").status_code == 422
    assert client.post(f"{BASE}/time-sheet", json={"worker_id": wid}).status_code == 422
    assert post().status_code == 201                              # a blank row (absent) is fine
    assert post().status_code == 409                              # same worker, same day
    assert post(work_day=str(today())).status_code == 201         # today is allowed
    assert post(work_day="1921-03-21").status_code == 201         # first allowed day
    # a patch that would leave one time only is refused by the database rule
    client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}", json={"arrival_time": "07:00", "exit_time": "16:00"})
    r = client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}", json={"arrival_time": None})
    assert r.status_code == 422 and "both be filled or both be empty" in r.json()["detail"]
    assert client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}", json={}).status_code == 422
    assert client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}", json={"overtime": None}).status_code == 422
    assert client.patch(f"{BASE}/time-sheet/{ABAN_1}/{wid}", json={"work_day": "2999-01-01"}).status_code == 422
    assert client.patch(f"{BASE}/time-sheet/2026-01-01/{wid}", json={"overtime": 1}).status_code == 404


@pytest.mark.parametrize("path", ["time-sheet", "aggregated-work"])
@pytest.mark.parametrize("params", [
    {}, {"from": ABAN_1}, {"to": ABAN_1}, {"from": ABAN_2, "to": ABAN_1}, {"from": "x", "to": ABAN_1},
    {"from": "2020-01-01", "to": "2026-01-01"},
])
def test_ranges_are_validated(client, path, params):
    assert client.get(f"{BASE}/{path}", params=params).status_code == 422


# ---------- aggregated work and monthly pay: hand-calculated scenario ----------
def scenario(client):
    ali = worker(client, "Ali", "simple", 1_000_000)
    reza = worker(client, "Reza", "simple", 1_200_000)
    hasan = worker(client, "Hasan", "builder", 2_000_000)
    sheet(client, MEHR_1, ali)
    sheet(client, MEHR_30, ali); sheet(client, MEHR_30, reza)
    sheet(client, MEHR_30, hasan, a=None, e=None, explanation="absent")
    sheet(client, ABAN_1, ali); sheet(client, ABAN_1, hasan, a="08:00", e="17:00")
    sheet(client, ABAN_1, reza, a=None, e=None, is_off_day=True)
    sheet(client, ABAN_2, ali, e="18:00", overtime=2)
    sheet(client, ABAN_2, hasan, a="08:00", e="17:00", is_holiday=True)
    return ali, reza, hasan


def pay(client, y, m):
    r = client.get(f"{BASE}/monthly-salary", params={"year": y, "month": m})
    assert r.status_code == 200
    return {x["full_name"]: (x["work_days"], x["daily_salary"], x["salary"]) for x in r.json()}


def test_monthly_salary_is_workdays_times_daily_salary(client):
    scenario(client)
    assert pay(client, 1405, 7) == {"Ali": (2, 1_000_000, 2_000_000), "Reza": (1, 1_200_000, 1_200_000), "Hasan": (0, 2_000_000, 0)}
    # Aban: overtime changes nothing, work on a holiday counts, an off-day row does not
    assert pay(client, 1405, 8) == {"Ali": (2, 1_000_000, 2_000_000), "Reza": (0, 1_200_000, 0), "Hasan": (2, 2_000_000, 4_000_000)}
    assert pay(client, 1405, 9) == {}
    for bad in ({"year": 1299, "month": 1}, {"year": 1405, "month": 13}, {"year": 1405}, {"year": "x", "month": 1}):
        assert client.get(f"{BASE}/monthly-salary", params=bad).status_code == 422


def test_pay_follows_a_changed_daily_salary(client):
    ali, *_ = scenario(client)
    client.patch(f"{BASE}/workers/{ali}", json={"daily_salary": 1_100_000})
    assert pay(client, 1405, 7)["Ali"] == (2, 1_100_000, 2_200_000)


def test_aggregated_work_counts_and_fills_every_day(client):
    scenario(client)
    assert client.put(f"{BASE}/aggregated-work/{ABAN_1}", json={"explanation": "site inspection"}).status_code == 200
    assert client.put(f"{BASE}/aggregated-work/2026-10-25", json={"explanation": "rain"}).status_code == 200
    got = client.get(f"{BASE}/aggregated-work", params=ABAN).json()
    assert len(got) == 30 and got[0]["work_day"] == ABAN_1 and got[-1]["work_day"] == "2026-11-21"
    d = {r["work_day"]: r for r in got}
    assert (d[ABAN_1]["total_workers"], d[ABAN_1]["simple_workers"], d[ABAN_1]["builders"]) == (2, 1, 1)
    assert d[ABAN_1]["explanation"] == "site inspection"
    assert (d[ABAN_2]["total_workers"], d[ABAN_2]["simple_workers"], d[ABAN_2]["builders"]) == (2, 1, 1)
    assert d["2026-10-25"] == {"work_day": "2026-10-25", "total_workers": 0, "simple_workers": 0, "builders": 0, "explanation": "rain"}
    assert d["2026-11-10"] == {"work_day": "2026-11-10", "total_workers": 0, "simple_workers": 0, "builders": 0, "explanation": None}
    mehr = {r["work_day"]: r for r in client.get(f"{BASE}/aggregated-work", params=MEHR).json()}
    assert len(mehr) == 30
    assert (mehr[MEHR_30]["total_workers"], mehr[MEHR_30]["simple_workers"], mehr[MEHR_30]["builders"]) == (2, 2, 0)  # absent builder not counted
    assert mehr[MEHR_1]["total_workers"] == 1
    assert all(r["total_workers"] == r["simple_workers"] + r["builders"] for r in got + list(mehr.values()))
    one = client.get(f"{BASE}/aggregated-work", params={"from": ABAN_1, "to": ABAN_1}).json()
    assert len(one) == 1 and one[0]["total_workers"] == 2


def test_aggregated_explanation_edit_and_delete(client):
    day = {"from": ABAN_1, "to": ABAN_1}
    url = f"{BASE}/aggregated-work/{ABAN_1}"
    assert client.put(url, json={"explanation": "first"}).json() == {"work_day": ABAN_1, "explanation": "first"}
    assert client.put(url, json={"explanation": "second"}).json()["explanation"] == "second"
    assert client.get(f"{BASE}/aggregated-work", params=day).json()[0]["explanation"] == "second"
    assert client.delete(url).status_code == 204
    assert client.delete(url).status_code == 404
    assert client.get(f"{BASE}/aggregated-work", params=day).json()[0]["explanation"] is None
    assert client.put(url, json={"explanation": "  "}).status_code == 422
    assert client.put(url, json={}).status_code == 422
    assert client.put(f"{BASE}/aggregated-work/{today() + timedelta(days=1)}", json={"explanation": "x"}).status_code == 422
    assert client.put(f"{BASE}/aggregated-work/1921-03-20", json={"explanation": "x"}).status_code == 422


def test_empty_database(client):
    assert client.get(f"{BASE}/workers").json() == []
    assert rows(client) == []
    assert pay(client, 1405, 1) == {}
    assert len(client.get(f"{BASE}/aggregated-work", params={"from": "2026-03-21", "to": "2026-04-20"}).json()) == 31


def test_solar_month_boundaries_incl_leap_esfand(client):
    wid = worker(client, "Ali", "simple", 1000)
    # 2025-03-20 = 30 Esfand 1403 (leap year), 2025-03-21 = 1 Farvardin 1404; 2026-03-20 = 29 Esfand 1404 (not leap)
    for d in ("2025-03-19", "2025-03-20", "2025-03-21", "2025-03-22", "2026-03-20", "2026-03-21"):
        sheet(client, d, wid)
    assert pay(client, 1403, 12)["Ali"][0] == 2        # 29 and 30 Esfand
    assert pay(client, 1404, 1)["Ali"][0] == 2         # 1 and 2 Farvardin
    assert pay(client, 1404, 12)["Ali"][0] == 1        # 29 Esfand 1404
    assert pay(client, 1405, 1)["Ali"][0] == 1


# ---------- the SQL Solar calendar must agree with jdatetime ----------
def test_sql_solar_date_matches_jdatetime_for_every_day_1921_to_2100(admin):
    import jdatetime

    start, end = date(1921, 3, 21), date(2100, 12, 31)
    got = admin.execute(
        "SELECT x.d, s.jy, s.jm, s.jd FROM (SELECT %s::date + g AS d FROM generate_series(0, %s) g) x, "
        "LATERAL shahran.solar_date(x.d) s ORDER BY x.d",
        (start, (end - start).days),
    ).fetchall()
    assert len(got) == (end - start).days + 1 > 65_000
    bad = [r for r in got if (lambda j: (j.year, j.month, j.day))(jdatetime.date.fromgregorian(date=r[0])) != tuple(r[1:])]
    assert bad == []


@pytest.mark.parametrize("year", [1403, 1404])  # 1403 is leap (30-day Esfand)
def test_whole_solar_year_through_api_matches_jdatetime(client, year):
    import collections
    import jdatetime

    wid = worker(client, "Ali", "simple", 1000)
    expected, d = collections.Counter(), jdatetime.date(year, 1, 1)
    while d.year == year:
        sheet(client, str(d.togregorian()), wid)
        expected[d.month] += 1
        d += jdatetime.timedelta(days=1)
    assert sum(expected.values()) == (366 if year == 1403 else 365)
    for m in range(1, 13):
        assert pay(client, year, m)["Ali"] == (expected[m], 1000, expected[m] * 1000)


# ---------- database-level guarantees (independent of the API) ----------
def test_db_rules_hold_even_when_api_is_bypassed(admin):
    admin.execute("INSERT INTO shahran.workers (full_name, role, daily_salary) VALUES ('A', 'simple', 1)")
    for stmt in (
        "INSERT INTO shahran.workers (full_name, role, daily_salary) VALUES ('A', 'simple', 1)",          # duplicate name
        "INSERT INTO shahran.workers (full_name, role, daily_salary) VALUES ('B', 'boss', 1)",            # role
        "INSERT INTO shahran.workers (full_name, role, daily_salary) VALUES ('C', 'simple', -1)",         # salary
        "INSERT INTO shahran.daily_time_sheet (work_day, worker_id, arrival_time) VALUES ('2026-10-01', 1, '07:00')",
        "INSERT INTO shahran.daily_time_sheet (work_day, worker_id, overtime) VALUES ('2026-10-01', 1, 30)",
        "INSERT INTO shahran.daily_time_sheet (work_day, worker_id) VALUES ('2026-10-01', 99)",           # no such worker
    ):
        with pytest.raises(psycopg.Error):
            admin.execute(stmt)


def test_app_role_is_least_privilege(database):
    with psycopg.connect(pytest.app_url, autocommit=True) as conn:
        conn.execute("SELECT * FROM shahran.workers")
        conn.execute("SELECT * FROM shahran.aggregated_work")
        conn.execute("SELECT * FROM shahran.monthly_salary")
        for stmt in ("CREATE TABLE shahran.x (a int)", "DROP TABLE shahran.workers", "TRUNCATE shahran.workers",
                     "ALTER TABLE shahran.workers DROP COLUMN role", "DROP VIEW shahran.monthly_salary"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(stmt)
        # the views are read-only for the app role
        for view in ("shahran.aggregated_work", "shahran.monthly_salary"):
            assert conn.execute("SELECT has_table_privilege(%s, 'INSERT')", (view,)).fetchone()[0] is False


# ---------- concurrency ----------
def test_racing_duplicate_inserts_give_exactly_one_201_never_500(client):
    codes, barrier = [], threading.Barrier(8)

    def go():
        barrier.wait()
        codes.append(client.post(f"{BASE}/workers", json={"full_name": "Ali", "role": "simple", "daily_salary": 1}).status_code)

    threads = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert sorted(codes) == [201] + [409] * 7