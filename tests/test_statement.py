import io
import json
from urllib.parse import quote

import pytest
from openpyxl import load_workbook

URL = "/api/statement/export"
TITLE = "حساب مالی صورت وضعیت های نهایی شده"
FULL = {
    "send_date": "1405/08/02", "title": "روز مزد مهر ماه ۱۴۰۵",
    "amounts": {"gross": 1_418_000_000, "retention": 0, "goods": 0, "food": 0, "deductions": 0, "net_payable": 1_418_000_000,
                "net_salaries": 1_026_000_000, "net_services": 0, "net_remaining": 392_000_000},
    "notes": {"gross": "یادداشت", "food": "ناهار"},
}


def post(client, data):
    return client.post(URL, data={"data": data if isinstance(data, str) else json.dumps(data)})


def sheet(client, data):
    r = post(client, data)
    assert r.status_code == 200, r.text
    return load_workbook(io.BytesIO(r.content)).active


def rows(ws):
    return [list(r) for r in ws.iter_rows(values_only=True)]


def test_content_matches_the_picture(client):
    r = post(client, FULL)
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert r.headers["content-disposition"] == 'attachment; filename="statement.xlsx"' and r.content[:2] == b"PK"
    ws = load_workbook(io.BytesIO(r.content)).active
    assert rows(ws) == [
        [TITLE, None, None, None],
        [None, None, None, "توضیحات"],
        ["تاریخ ارسال", None, "1405/08/02", None],
        ["عنوان صورت وضعیت", None, "روز مزد مهر ماه ۱۴۰۵", None],
        ["مبلغ ناخالص صورت وضعیت", None, 1_418_000_000, "یادداشت"],
        ["کسورات صورت وضعیت", "حسن انجام کار", 0, None],
        [None, "خدمات و کالا", 0, None],
        [None, "غذا", 0, "ناهار"],
        ["مجموع کسورات", None, 0, None],
        ["مبلغ خالص قابل پرداخت صورت وضعیت", None, 1_418_000_000, None],
        ["مبلغ خالص حقوق و مزایای پرسنل", None, 1_026_000_000, None],
        ["مبلغ خالص خدمات و هزینه‌های جانبی", None, 0, None],
        ["مبلغ خالص مانده پیمانکار", None, 392_000_000, None],
    ]


def test_layout_money_format_and_print_setup(client):
    ws = sheet(client, FULL)
    last = ws.max_row
    assert last == 13 and ws.sheet_view.rightToLeft is True
    assert sorted(map(str, ws.merged_cells.ranges)) == sorted(
        ["A1:D1", "A2:C2", "A3:B3", "A4:B4", "A5:B5", "A6:A8", "A9:B9", "A10:B10", "A11:B11", "A12:B12", "A13:B13"])
    assert all(ws.cell(r, 3).number_format == '#,##0" ریال"' for r in (5, 6, 7, 8, 9, 10, 11, 12, 13))
    assert ws["C5"].data_type == "n" and ws["C3"].data_type == "s"
    assert ws["A1"].font.b and ws["A1"].fill.fgColor.rgb.endswith("F4EBE8") and ws["D2"].font.b
    for row in ws.iter_rows(min_row=1, max_row=last, max_col=4):  # heavy frame all round
        assert row[0].border.left.style == "medium" or type(row[0]).__name__ != "Cell"
    assert all(c.border.top.style == "medium" for c in ws[1]) and all(c.border.bottom.style == "medium" for c in ws[last])
    assert all(ws.cell(r, 4).border.right.style == "medium" for r in range(1, last + 1))
    assert all(ws.cell(r, 1).border.left.style == "medium" for r in range(1, last + 1))
    assert ws["C5"].border.left.style == ws["C5"].border.right.style == "thin"
    assert ws["A6"].border.top.style == "thin" and ws["A8"].border.bottom.style == "thin"   # the box spans its 3 rows
    assert ws.page_setup.orientation == "portrait" and int(ws.page_setup.paperSize) == 9
    assert ws.sheet_properties.pageSetUpPr.fitToPage and (ws.page_setup.fitToWidth, ws.page_setup.fitToHeight) == (1, 1)
    assert all(ws.row_dimensions[i].height >= 28 for i in range(1, last + 1))


def test_blank_form_and_zero_vs_empty(client):
    R = rows(sheet(client, {}))
    assert len(R) == 13 and all(r[2] is None for r in R[2:])          # nothing typed: empty boxes, nothing invented
    R = rows(sheet(client, {"amounts": {"gross": 0, "food": None}}))
    assert R[4][2] == 0 and R[7][2] is None                          # a typed 0 stays 0, an empty box stays empty


def test_typed_text_never_runs_as_a_formula(client):
    ws = sheet(client, {"send_date": "=1+1", "title": '=HYPERLINK("http://evil","x")', "notes": {"gross": "+cmd"}})
    assert [ws[c].data_type for c in ("C3", "C4", "D5")] == ["s", "s", "s"] and ws["C3"].value == "=1+1"


def test_long_text_gets_taller_rows(client):
    ws = sheet(client, {"title": "متن " * 60})
    assert ws.row_dimensions[4].height > ws.row_dimensions[3].height


def test_biggest_amount(client):
    assert sheet(client, {"amounts": {"gross": 10**13}})["C5"].value == 10**13


BAD = [
    "", "not json", "[]", '{"amounts": "x"}',
    json.dumps({"amounts": {"gross": -1}}), json.dumps({"amounts": {"gross": "5"}}), json.dumps({"amounts": {"gross": 1.5}}),
    json.dumps({"amounts": {"gross": 10**13 + 1}}), json.dumps({"amounts": {"title": 5}}), json.dumps({"amounts": {"nope": 5}}),
    json.dumps({"notes": {"nope": "x"}}), json.dumps({"notes": {"gross": "x" * 301}}),
    json.dumps({"send_date": "x" * 31}), json.dumps({"title": "x" * 301}),
]


@pytest.mark.parametrize("data", BAD)
def test_bad_requests_are_422(client, data):
    assert post(client, data).status_code == 422


def test_missing_field_and_get(client):
    assert client.post(URL).status_code == 422
    assert client.post(URL, data={"other": "{}"}).status_code == 422
    assert client.get(URL).status_code == 405


def test_farsi_survives_real_browser_form_encoding(client):
    body = "data=" + quote(json.dumps(FULL, ensure_ascii=False))
    r = client.post(URL, content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 200 and rows(load_workbook(io.BytesIO(r.content)).active)[3][2] == FULL["title"]
