import csv
import io
from datetime import time

import psycopg
import pytest
from openpyxl import load_workbook

BASE = "/api/shahran"
ABAN = {"from": "2026-10-23", "to": "2026-11-21"}          # 1 Aban 1405 .. 30 Aban 1405
TITLE = "کارگاه تونل دسترسی تهران_شمال پروژه شهران (آبان ۱۴۰۵)"
BOX1, BOX2, BOX3 = "پیمانکار اسکندری", "حضور‌غیاب کل‌ماه", "سمت:کارگر ساده"
HEAD = ["تاریخ", "ساعت ورود", "ساعت خروج", "Ali", "Reza", "توضیحات"]


@pytest.fixture(autouse=True)
def clean_shahran(database):
    with psycopg.connect(pytest.admin_url, autocommit=True) as conn:
        conn.execute("TRUNCATE shahran.daily_time_sheet, shahran.daily_notes, shahran.workers RESTART IDENTITY CASCADE")


def worker(client, name, role="simple"):
    r = client.post(f"{BASE}/workers", json={"full_name": name, "role": role, "daily_salary": 1000})
    assert r.status_code == 201, r.text
    return r.json()["worker_id"]


def sheet(client, day, wid, a="07:00", e="16:00"):
    r = client.post(f"{BASE}/time-sheet", json={"work_day": day, "worker_id": wid, "arrival_time": a, "exit_time": e})
    assert r.status_code == 201, r.text


def seed(client):
    ali, reza = worker(client, "Ali"), worker(client, "Reza")
    hasan, _zed = worker(client, "Hasan", "builder"), worker(client, "Zed")     # Zed: a simple worker with no rows
    sheet(client, "2026-10-23", ali)                          # full day 07:00-16:00
    sheet(client, "2026-10-23", reza, "08:00", "12:00")       # half day
    sheet(client, "2026-10-23", hasan, "05:00", "20:00")      # builder: must not leak into the simple sheet
    sheet(client, "2026-10-24", ali, None, None)              # absent
    sheet(client, "2026-10-24", reza, "06:30", "17:30")
    assert client.put(f"{BASE}/aggregated-work/2026-10-25", json={"explanation": "rain"}).status_code == 200


def get(client, path, **params):
    return client.get(f"{BASE}/{path}", params={**ABAN, **params})


def xlsx_rows(r):
    return [list(x) for x in load_workbook(io.BytesIO(r.content)).active.iter_rows(values_only=True)]


# ---------- the API ----------
def test_attendance_simple_role(client):
    seed(client)
    a = get(client, "attendance").json()
    assert [w["full_name"] for w in a["workers"]] == ["Ali", "Reza"]       # no builder, no worker without rows
    assert len(a["days"]) == 30 and a["days"][0]["work_day"] == "2026-10-23" and a["days"][-1]["work_day"] == "2026-11-21"
    d1, d2, d3, d4 = a["days"][:4]
    assert (d1["arrival_time"], d1["exit_time"], d1["units"]) == ("07:00:00", "16:00:00", [2, 1])   # earliest in, latest out
    assert (d2["arrival_time"], d2["exit_time"], d2["units"]) == ("06:30:00", "17:30:00", [0, 2])   # the absent row adds nothing
    assert (d3["arrival_time"], d3["exit_time"], d3["units"], d3["explanation"]) == (None, None, [0, 0], "rain")
    assert d4["units"] == [0, 0] and d4["explanation"] is None
    assert a["totals"] == [1, 1.5]
    assert [(w["daily_salary"], w["pay"]) for w in a["workers"]] == [(1000, 1000), (1000, 1500)]
    assert (a["total_pay"], a["total_pay_words"]) == (2500, "دو هزار و پانصد")


def test_attendance_builder_role_and_default(client):
    seed(client)
    b = get(client, "attendance", role="builder").json()
    assert [w["full_name"] for w in b["workers"]] == ["Hasan"] and b["days"][0]["units"] == [2] and b["totals"] == [1]
    assert get(client, "attendance").json() == get(client, "attendance", role="simple").json()


def test_attendance_empty_month_and_bad_requests(client):
    a = get(client, "attendance").json()
    assert a["workers"] == [] and a["totals"] == [] and len(a["days"]) == 30 and a["days"][0]["units"] == []
    assert get(client, "attendance", role="boss").status_code == 422
    assert client.get(f"{BASE}/attendance", params={"from": "2026-10-24", "to": "2026-10-23"}).status_code == 422
    assert client.get(f"{BASE}/attendance").status_code == 422


def test_half_day_rule_and_pay_are_the_ones_used_by_the_pay_tab(client):
    ali = worker(client, "Ali")
    sheet(client, "2026-10-23", ali, "08:00", "12:00")
    sheet(client, "2026-10-24", ali, "08:00", "13:00")                    # near miss = full day
    a = get(client, "attendance").json()
    assert [d["units"] for d in a["days"][:2]] == [[1], [2]] and a["totals"] == [1.5]
    for salary in (1000, 1_000_001, 1_200_000, 999_999_999_999):          # odd salaries make half-rupee roundings
        client.patch(f"{BASE}/workers/{ali}", json={"daily_salary": salary})
        a = get(client, "attendance").json()
        pay = client.get(f"{BASE}/monthly-salary", params={"year": 1405, "month": 8}).json()
        assert a["workers"][0]["pay"] == a["total_pay"] == pay[0]["salary"], salary
        assert pay[0]["work_days"] == a["totals"][0]


def test_farsi_words():
    from shahran.backend.routes import farsi_words as f
    assert [f(n) for n in (0, 7, 15, 20, 21, 100, 101, 1000, 1001, 2500, 18_000_000, 891_000_000)] == [
        "صفر", "هفت", "پانزده", "بیست", "بیست و یک", "صد", "صد و یک", "هزار", "هزار و یک", "دو هزار و پانصد",
        "هجده میلیون", "هشتصد و نود و یک میلیون"]
    assert f(1_234_567_890) == "یک میلیارد و دویست و سی و چهار میلیون و پانصد و شصت و هفت هزار و هشتصد و نود"


# ---------- the download ----------
def test_attendance_xlsx_layout(client):
    seed(client)
    r = get(client, "export/attendance")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert r.headers["content-disposition"] == 'attachment; filename="shahran-attendance-simple_2026-10-23_2026-11-21.xlsx"'
    rows = xlsx_rows(r)
    assert rows[0] == [TITLE] + [None] * 5                                   # top header
    assert rows[1] == [BOX1, None, None, BOX2, None, BOX3]                   # the three boxes
    assert rows[2] == HEAD                                                   # column headers
    assert rows[3] == ["1405/08/01", time(7, 0), time(16, 0), 1, 0.5, None]
    assert rows[4] == ["1405/08/02", time(6, 30), time(17, 30), "—", 1, None]
    assert rows[5] == ["1405/08/03", "—", "—", "—", "—", "rain"]
    assert rows[-5:] == [
        ["جمع کل کارکرد", 2.5, None, 1, 1.5, None],
        ["دستمزد روزانه", None, None, 1000, 1000, None],
        ["دستمزد قابل پرداخت", None, None, 1000, 1500, None],
        ["جمع دستمزد قابل پرداخت", None, None, 2500, None, None],
        ["مبلغ به حروف", None, None, "دو هزار و پانصد ریال", None, None]] and len(rows) == 3 + 30 + 5

    ws = load_workbook(io.BytesIO(r.content)).active
    last = ws.max_row
    assert sorted(map(str, ws.merged_cells.ranges)) == sorted([
        "A1:F1", "A2:C2", "D2:E2", f"B{last - 4}:C{last - 4}", f"A{last - 3}:C{last - 3}", f"A{last - 2}:C{last - 2}",
        f"A{last - 1}:C{last - 1}", f"D{last - 1}:F{last - 1}", f"A{last}:C{last}", f"D{last}:F{last}"])
    assert ws.sheet_view.rightToLeft is True and ws.freeze_panes == "A4" and ws.print_title_rows == "$1:$3"
    assert ws.page_setup.orientation == "portrait" and int(ws.page_setup.paperSize) == 9 and ws.sheet_properties.pageSetUpPr.fitToPage
    anchors = lambda r: [c for c in ws[r] if type(c).__name__ == "Cell"]                      # (merged cells keep their style in the first cell)
    assert len(anchors(2)) == 3 and all(c.font.b and c.fill.fgColor.rgb.endswith("F4EBE8") for c in anchors(2) + anchors(3))
    assert all(c.font.b for r in range(last - 4, last + 1) for c in anchors(r))
    assert ws.cell(last - 3, 4).number_format == '#,##0" ریال"' and ws.cell(last - 2, 5).number_format == '#,##0" ریال"'
    assert ws.cell(last - 4, 4).number_format == "General"                      # the work-days row is not money
    assert ws["B4"].number_format == "hh:mm" and ws["C4"].number_format == "hh:mm"
    assert ws["E4"].number_format == '[=0.5]"1/2";General' and ws["D4"].number_format == "General"
    for row in ws.iter_rows(min_row=2, max_col=6):                           # same boxed grid as the other sheets
        for c in row:
            if type(c).__name__ != "Cell":                                   # inside a merged box there is no inner line
                continue
            b = c.border
            end = max([m.max_col for m in ws.merged_cells.ranges if c.coordinate in m] or [c.column])   # a merged box ends at its last column
            assert b.left.style == ("medium" if c.column == 1 else "thin") and b.right.style == ("medium" if end == 6 else "thin"), c.coordinate
            assert b.top.style == "thin" and b.bottom.style == ("medium" if c.row == last else "thin"), c.coordinate
    assert all(c.border.top.style == "medium" for c in ws[1])
    assert ws.row_dimensions[1].height == 28 and all(ws.row_dimensions[i].height >= 22 for i in range(1, last + 1))


def test_attendance_xlsx_builder_and_empty_month(client):
    seed(client)
    rows = xlsx_rows(get(client, "export/attendance", role="builder"))
    assert rows[1] == [BOX1, None, None, BOX2, "سمت:بنا"] and rows[2] == ["تاریخ", "ساعت ورود", "ساعت خروج", "Hasan", "توضیحات"]
    assert rows[3] == ["1405/08/01", time(5, 0), time(20, 0), 1, None]
    assert rows[-5:] == [["جمع کل کارکرد", 1, None, 1, None], ["دستمزد روزانه", None, None, 1000, None],
                         ["دستمزد قابل پرداخت", None, None, 1000, None], ["جمع دستمزد قابل پرداخت", None, None, 1000, None],
                         ["مبلغ به حروف", None, None, "هزار ریال", None]]
    client.delete(f"{BASE}/aggregated-work/2026-10-25")
    for w in client.get(f"{BASE}/workers").json():
        for d in ("2026-10-23", "2026-10-24"):
            client.delete(f"{BASE}/time-sheet/{d}/{w['worker_id']}")
    rows = xlsx_rows(get(client, "export/attendance"))                       # nobody: the workers box disappears, nothing breaks
    assert rows[1] == [BOX1, None, None, BOX3] and rows[2] == ["تاریخ", "ساعت ورود", "ساعت خروج", "توضیحات"]
    assert rows[-5:] == [["جمع کل کارکرد", 0, None, None], ["دستمزد روزانه", None, None, None], ["دستمزد قابل پرداخت", None, None, None],
                         ["جمع دستمزد قابل پرداخت", None, None, 0], ["مبلغ به حروف", None, None, "صفر ریال"]] and len(rows) == 3 + 30 + 5


def test_attendance_csv(client):
    seed(client)
    r = get(client, "export/attendance", format="csv")
    assert r.content.startswith(b"\xef\xbb\xbf") and r.headers["content-type"] == "text/csv; charset=utf-8"
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0] == HEAD and len(rows) == 31                               # plain table: no title, boxes or totals
    assert rows[1] == ["1405/08/01", "07:00", "16:00", "1", "0.5", ""]
    assert rows[3] == ["1405/08/03", "—", "—", "—", "—", "rain"]


def test_worker_names_never_run_as_formulas(client):
    w = worker(client, "=1+1")
    sheet(client, "2026-10-23", w)
    assert list(csv.reader(io.StringIO(get(client, "export/attendance", format="csv").text.lstrip("\ufeff"))))[0][3] == "'=1+1"
    ws = load_workbook(io.BytesIO(get(client, "export/attendance").content)).active
    assert ws["D3"].value == "=1+1" and ws["D3"].data_type == "s"


def test_other_exports_unchanged_and_bad_requests(client):
    seed(client)
    assert xlsx_rows(get(client, "export/time-sheet"))[1][0] == "تاریخ"
    assert get(client, "export/aggregated-work").content[:2] == b"PK"
    for params in ({"format": "pdf"}, {"role": "boss"}, {"from": "2026-10-24", "to": "2026-10-23"}):
        assert get(client, "export/attendance", **params).status_code == 422
    assert get(client, "export/workers").status_code == 422