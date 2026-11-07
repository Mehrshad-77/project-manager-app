import csv
import io
from datetime import date, time

import jdatetime
import pytest
import psycopg
from openpyxl import load_workbook

BASE = "/api/shahran"
ABAN = {"from": "2026-10-23", "to": "2026-11-21"}          # 1 Aban 1405 .. 30 Aban 1405
TITLE = {"time-sheet": "کارکرد روزانه", "aggregated-work": "کارکرد تجمیعی ماهانه"}
HEAD = {
    "time-sheet": ["تاریخ", "کارگر", "ساعت ورود", "ساعت خروج", "اضافه‌کاری", "تعطیلات", "مرخصی", "توضیحات"],
    "aggregated-work": ["تاریخ", "تعداد نفرات", "کارگر ساده", "بنا", "توضیحات"],
}


@pytest.fixture(autouse=True)
def clean_shahran(database):
    with psycopg.connect(pytest.admin_url, autocommit=True) as conn:
        conn.execute("TRUNCATE shahran.daily_time_sheet, shahran.daily_notes, shahran.workers RESTART IDENTITY CASCADE")


def solar(d):
    j = jdatetime.date.fromgregorian(date=date.fromisoformat(d))
    return f"{j.year:04d}/{j.month:02d}/{j.day:02d}"


def worker(client, name, role, salary=1000):
    r = client.post(f"{BASE}/workers", json={"full_name": name, "role": role, "daily_salary": salary})
    assert r.status_code == 201, r.text
    return r.json()["worker_id"]


def sheet(client, day, wid, **kw):
    r = client.post(f"{BASE}/time-sheet", json={"work_day": day, "worker_id": wid, **kw})
    assert r.status_code == 201, r.text


def seed(client):
    ali, hasan = worker(client, "Ali", "simple"), worker(client, "Hasan", "builder")
    sheet(client, "2026-10-23", ali, arrival_time="07:00", exit_time="16:00", overtime=2.5, explanation="late")
    sheet(client, "2026-10-23", hasan, is_off_day=True)
    sheet(client, "2026-10-24", hasan, arrival_time="08:00", exit_time="17:30", is_holiday=True)
    assert client.put(f"{BASE}/aggregated-work/2026-10-25", json={"explanation": "rain"}).status_code == 200


LETTER = {"letter_date": "۱۴۰۵/۰۸/۱۶", "letter_to": "مدیریت محترم پروژه X جناب آقای Y",
          "letter_body": "با سلام, احتراما بدینوسیله به استحضار میرساند نفرات با کارگاه همکاری نمودند"}
OPENING, TOTAL, SIGNATURES = "بسمه تعالی", "جمع", ("نقشه بردار_مسئول اجراء:", "مدیریت کارگاه:")


def xlsx_rows(r):
    return [list(x) for x in load_workbook(io.BytesIO(r.content)).active.iter_rows(values_only=True)]


def csv_rows(r):
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))


def get(client, table, fmt="xlsx", **params):
    return client.get(f"{BASE}/export/{table}", params={**ABAN, "format": fmt, **params})


# ---------- the time sheet (کارکرد روزانه): hand-written expected rows ----------
def test_time_sheet_xlsx_exact_rows(client):
    seed(client)
    r = get(client, "time-sheet")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert r.headers["content-disposition"] == 'attachment; filename="shahran-time-sheet_2026-10-23_2026-11-21.xlsx"'
    rows = xlsx_rows(r)
    assert rows[0] == ["کارکرد روزانه"] + [None] * 7                      # table name as the heading
    assert rows[1] == HEAD["time-sheet"]
    assert "تاریخ میلادی" not in rows[1]
    assert rows[2:] == [
        ["1405/08/01", "Ali", time(7, 0), time(16, 0), 2.5, None, None, "late"],
        ["1405/08/01", "Hasan", None, None, 0, None, "✓", None],
        ["1405/08/02", "Hasan", time(8, 0), time(17, 30), 0, "✓", None, None],
    ]


def test_time_sheet_xlsx_cell_types_and_layout(client):
    seed(client)
    ws = load_workbook(io.BytesIO(get(client, "time-sheet").content)).active
    assert ws.title == "time-sheet" and ws.sheet_view.rightToLeft is True and ws["A1"].font.b
    assert ws["A3"].data_type == "s" and ws["C3"].number_format == "hh:mm" and ws["E3"].data_type == "n"


def test_time_sheet_csv_exact_rows(client):
    seed(client)
    r = get(client, "time-sheet", "csv")
    assert r.content.startswith(b"\xef\xbb\xbf") and r.headers["content-type"] == "text/csv; charset=utf-8"
    assert csv_rows(r) == [
        HEAD["time-sheet"],
        ["1405/08/01", "Ali", "07:00", "16:00", "2.5", "", "", "late"],
        ["1405/08/01", "Hasan", "", "", "0.0", "", "✓", ""],
        ["1405/08/02", "Hasan", "08:00", "17:30", "0.0", "✓", "", ""],
    ]


# ---------- the aggregated sheet (کارکرد تجمیعی ماهانه) ----------
def test_aggregated_xlsx_is_a_letter_with_every_day_totals_and_signature_boxes(client):
    seed(client)
    rows = xlsx_rows(get(client, "aggregated-work", **LETTER))
    assert rows[0] == [OPENING, None, None, None, LETTER["letter_date"]]   # opening line, the typed date at the far end
    assert rows[1] == [LETTER["letter_to"]] + [None] * 4                   # typed addressee
    assert rows[2] == [LETTER["letter_body"]] + [None] * 4                 # typed text
    assert rows[3] == HEAD["aggregated-work"]                              # the letter replaces the old title row
    body = rows[4:-2]
    assert len(body) == 30                                                 # every day of Aban, like the screen
    by_day = {r[0]: r[1:] for r in body}
    assert by_day["1405/08/01"] == [1, 1, 0, None]                         # Ali worked; Hasan's off-day row not counted
    assert by_day["1405/08/02"] == [1, 0, 1, None]                         # Hasan (builder) worked on a holiday
    assert by_day["1405/08/03"] == [0, 0, 0, "rain"]                       # 2026-10-25 note only
    assert by_day["1405/08/30"] == [0, 0, 0, None]
    assert body[0][0] == "1405/08/01" and body[-1][0] == "1405/08/30"
    assert rows[-2] == [TOTAL, 2, 1, 1, None]                              # sums of the three number columns
    assert rows[-1] == [SIGNATURES[0], None, None, SIGNATURES[1], None]    # two empty boxes for the stamp and signatures


def test_aggregated_xlsx_letter_layout_and_print_style(client):
    seed(client)
    ws = load_workbook(io.BytesIO(get(client, "aggregated-work", **LETTER).content)).active
    last = ws.max_row
    assert sorted(str(m) for m in ws.merged_cells.ranges) == sorted(["A1:D1", "A2:E2", "A3:E3", f"A{last}:C{last}", f"D{last}:E{last}"])
    assert ws["A1"].font.b and ws["A1"].alignment.horizontal == "center"
    assert ws["A2"].alignment.wrap_text and ws["A3"].alignment.wrap_text
    assert all(c.fill.fgColor.rgb.endswith("F4EBE8") and c.font.b for c in ws[4])           # header row
    assert all(c.font.b for c in ws[last - 1])                                              # totals row
    for row in ws.iter_rows(min_row=4, max_row=last - 1, max_col=5):                        # thin black grid, heavy frame
        for c in row:
            b = c.border
            assert b.left.style == ("medium" if c.column == 1 else "thin") and b.right.style == ("medium" if c.column == 5 else "thin"), c.coordinate
            assert b.top.style == "thin" and b.bottom.style == "thin", c.coordinate
            assert b.left.color.rgb.endswith("000000")
    sig = [ws.cell(last, k).border for k in range(1, 6)]                                    # the two signature boxes
    assert sig[0].left.style == sig[4].right.style == "medium" and sig[2].right.style == sig[3].left.style == "thin"
    assert all(b.bottom.style == "medium" and b.top.style == "thin" for b in sig)
    for r in (1, 2, 3):                                                                     # the letter block: frame only, no grid
        assert ws.cell(r, 1).border.left.style == ws.cell(r, 5).border.right.style == "medium"
        assert ws.cell(r, 3).border.left.style is None and ws.cell(r, 3).border.right.style is None
    assert all(ws.cell(1, k).border.top.style == "medium" for k in range(1, 6))
    assert ws.page_setup.orientation == "portrait" and int(ws.page_setup.paperSize) == 9
    assert ws.sheet_properties.pageSetUpPr.fitToPage and ws.print_title_rows == "$4:$4"
    assert ws.row_dimensions[last].height == 80 and all(ws.row_dimensions[r].height >= 22 for r in range(1, last))


def test_letter_text_is_typed_each_time_and_long_text_gets_room(client):
    seed(client)
    long = "متن " * 60
    ws = load_workbook(io.BytesIO(get(client, "aggregated-work", letter_date="1", letter_to="2", letter_body=long).content)).active
    assert [ws["E1"].value, ws["A2"].value, ws["A3"].value] == ["1", "2", long.strip()]
    assert ws.row_dimensions[3].height > ws.row_dimensions[2].height               # a long paragraph gets taller
    two = load_workbook(io.BytesIO(get(client, "aggregated-work", letter_date="1", letter_to="2", letter_body="خط اول\nخط دوم").content)).active
    assert two.row_dimensions[3].height > two.row_dimensions[2].height               # a manual line break needs room too
    other = load_workbook(io.BytesIO(get(client, "aggregated-work", letter_date="9", letter_to="گیرنده دیگر", letter_body="b").content)).active
    assert [other["E1"].value, other["A2"].value, other["A3"].value] == ["9", "گیرنده دیگر", "b"]


def test_letter_text_never_runs_as_a_formula(client):
    ws = load_workbook(io.BytesIO(get(client, "aggregated-work", letter_date="=1+1", letter_to='=HYPERLINK("http://evil","x")', letter_body="+cmd").content)).active
    assert [ws[c].data_type for c in ("E1", "A2", "A3")] == ["s", "s", "s"] and ws["E1"].value == "=1+1"


def test_letter_applies_only_to_the_aggregated_xlsx(client):
    seed(client)
    ts = xlsx_rows(get(client, "time-sheet", **LETTER))
    assert ts[0] == ["کارکرد روزانه"] + [None] * 7 and ts[1] == HEAD["time-sheet"]  # still a title + table
    assert csv_rows(get(client, "aggregated-work", "csv", **LETTER))[0] == HEAD["aggregated-work"]   # CSV stays a plain table
    for bad in ({"letter_date": "x" * 31}, {"letter_to": "x" * 301}, {"letter_body": "x" * 1001}):
        assert get(client, "aggregated-work", **bad).status_code == 422


def test_aggregated_csv(client):
    seed(client)
    rows = csv_rows(get(client, "aggregated-work", "csv"))
    assert rows[0] == HEAD["aggregated-work"] and len(rows) == 31
    assert rows[1] == ["1405/08/01", "1", "1", "0", ""]
    assert rows[3] == ["1405/08/03", "0", "0", "0", "rain"]


# ---------- the export is exactly what the screen's API returns ----------
def test_matches_api_for_both_tables(client):
    seed(client)
    ts = client.get(f"{BASE}/time-sheet", params=ABAN).json()
    got = xlsx_rows(get(client, "time-sheet"))[2:]
    assert [(r[0], r[1], r[2] and r[2].strftime("%H:%M:%S"), r[3] and r[3].strftime("%H:%M:%S")) for r in got] == \
           [(solar(x["work_day"]), x["full_name"], x["arrival_time"], x["exit_time"]) for x in ts]
    agg = client.get(f"{BASE}/aggregated-work", params=ABAN).json()
    got = xlsx_rows(get(client, "aggregated-work"))[4:-2]
    assert got == [[solar(x["work_day"]), x["total_workers"], x["simple_workers"], x["builders"], x["explanation"]] for x in agg]


def test_solar_dates_match_jdatetime_for_every_exported_day(client):
    days = [x["work_day"] for x in client.get(f"{BASE}/aggregated-work", params=ABAN).json()]
    got = [r[0] for r in xlsx_rows(get(client, "aggregated-work"))[4:-2]]
    assert len(got) == 30 and got == [solar(d) for d in days]


def test_empty_database(client):
    assert xlsx_rows(get(client, "time-sheet")) == [["کارکرد روزانه"] + [None] * 7, HEAD["time-sheet"]]
    assert csv_rows(get(client, "time-sheet", "csv")) == [HEAD["time-sheet"]]
    rows = xlsx_rows(get(client, "aggregated-work"))
    assert len(rows) == 36 and rows[-2] == [TOTAL, 0, 0, 0, None]         # letter (3) + header + 30 zero days + totals + signatures


def test_range_limits_rows(client):
    seed(client)
    r = client.get(f"{BASE}/export/time-sheet", params={"from": "2026-10-24", "to": "2026-10-24", "format": "csv"})
    assert [x[1] for x in csv_rows(r)[1:]] == ["Hasan"]


# ---------- typed text must never turn into a spreadsheet formula ----------
def test_formula_like_text_stays_text(client):
    evil = worker(client, "=1+1", "simple")
    other = worker(client, "-x", "builder")
    sheet(client, "2026-10-23", evil, explanation='=HYPERLINK("http://evil","click")')
    sheet(client, "2026-10-23", other, explanation="+cmd|calc")
    assert client.put(f"{BASE}/aggregated-work/2026-10-23", json={"explanation": "@SUM(1)"}).status_code == 200
    ws = load_workbook(io.BytesIO(get(client, "time-sheet").content)).active
    cells = {c.value: c.data_type for row in ws.iter_rows(min_row=3) for c in row if isinstance(c.value, str)}
    assert cells['=HYPERLINK("http://evil","click")'] == "s" and cells["=1+1"] == "s" and cells["+cmd|calc"] == "s"
    rows = csv_rows(get(client, "time-sheet", "csv"))[1:]
    assert sorted((r[1], r[7]) for r in rows) == [("'-x", "'+cmd|calc"), ("'=1+1", "'=HYPERLINK(\"http://evil\",\"click\")")]
    assert csv_rows(get(client, "aggregated-work", "csv"))[1][4] == "'@SUM(1)"


# ---------- printable layout ----------
def test_time_sheet_xlsx_is_a_clean_printable_table(client):
    seed(client)
    ws = load_workbook(io.BytesIO(get(client, "time-sheet").content)).active
    last = ws.max_row
    assert [str(m) for m in ws.merged_cells.ranges] == ["A1:H1"]                       # title spans the table
    assert ws["A2"].font.b and ws["A2"].fill.fgColor.rgb.endswith("F4EBE8")           # shaded bold header
    for row in ws.iter_rows(min_row=2, max_col=8):                                    # thin black grid inside, heavy frame outside
        for c in row:
            b = c.border
            assert b.left.style == ("medium" if c.column == 1 else "thin") and b.right.style == ("medium" if c.column == 8 else "thin"), c.coordinate
            assert b.top.style == "thin" and b.bottom.style == ("medium" if c.row == last else "thin"), c.coordinate
    assert ws.freeze_panes == "A3" and int(ws.page_setup.paperSize) == 9
    assert ws.page_setup.orientation == "landscape"                                   # more than 5 columns
    assert ws.sheet_properties.pageSetUpPr.fitToPage and (ws.page_setup.fitToWidth, ws.page_setup.fitToHeight) == (1, 0)
    assert ws.print_title_rows == "$1:$2" and ws.print_options.horizontalCentered
    assert ws["H3"].alignment.wrap_text and ws.row_dimensions[3].height >= 22         # long explanations wrap, not cut off


# ---------- bad requests ----------
@pytest.mark.parametrize("table", ["time-sheet", "aggregated-work"])
@pytest.mark.parametrize("params", [
    {"format": "pdf"}, {"format": "XLSX"}, {"from": "2026-10-24", "to": "2026-10-23"},
    {"from": "2020-01-01", "to": "2026-01-01"}, {"from": "x"}, {"to": None},
])
def test_bad_requests_are_422(client, table, params):
    p = {**ABAN, "format": "xlsx", **params}
    p = {k: v for k, v in p.items() if v is not None}
    assert client.get(f"{BASE}/export/{table}", params=p).status_code == 422


def test_unknown_table_and_default_format(client):
    assert client.get(f"{BASE}/export/workers", params=ABAN).status_code == 422
    assert client.get(f"{BASE}/export/monthly-salary", params=ABAN).status_code == 422
    assert client.get(f"{BASE}/export/time-sheet", params=ABAN).content[:2] == b"PK"
