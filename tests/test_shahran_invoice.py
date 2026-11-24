import io
import json

import pytest
from openpyxl import load_workbook

from shahran.backend.invoice import rial_words

URL = "/api/shahran/export/invoice"
TITLE = "فاکتور شاتکریت کوهسار"
HEAD = ["ردیف", "شرح کالا", "واحد کالا", "تعداد", "مبلغ واحد (ریال)", "مبلغ کل (ریال)", "جمع مالیات و عوارض (ریال)",
        "مبلغ تخفیف", "جمع کل به علاوه مالیات و عوارض (ریال)"]
ITEM = {"description": "اجرای یک لایه مش بلدی و شاتکریت تا ضخامت ۱۰ سانتی متر", "unit": "متر مربع",
        "quantity": "222", "unit_price": 4_500_000, "tax": 0, "discount": 0}
FULL = {
    "number": "4", "date": "1405/09/01",
    "contractor_name": "پیمانکاری اسکندری", "contractor_address": "استان تهران شهرستان تهران", "contractor_economic_no": "411",
    "contractor_postal_code": "1234567890", "contractor_national_id": "22596", "contractor_phone": "09385209890",
    "employer_name": "پروژه دسترسی به آزادراه تهران شمال", "employer_economic_no": "99", "employer_registration_no": "88",
    "employer_address": "تهران", "employer_phone": "021",
    "items": [ITEM], "payment": "cash", "sheba": "IR980150000000300122499259 به نام علی اسکندری",
}


def post(client, data):
    return client.post(URL, data={"data": data if isinstance(data, str) else json.dumps(data)})


def sheet(client, data):
    r = post(client, data)
    assert r.status_code == 200, r.text
    return load_workbook(io.BytesIO(r.content)).active


def rows(ws):
    return [list(r) for r in ws.iter_rows(values_only=True)]


def item(**kw):
    return {**ITEM, **kw}


# ---------- Farsi words ----------
def test_rial_words():
    assert [rial_words(n) for n in (0, 7, 15, 20, 21, 100, 101, 999, 1000, 1001, 2500, 18_000_000, 999_000_000)] == [
        "صفر ریال", "هفت ریال", "پانزده ریال", "بیست ریال", "بیست و یک ریال", "صد ریال", "صد و یک ریال",
        "نهصد و نود و نه ریال", "یک هزار ریال", "یک هزار و یک ریال", "دو هزار و پانصد ریال", "هجده میلیون ریال",
        "نهصد و نود و نه میلیون ریال"]
    assert rial_words(1_234_567_890) == "یک میلیارد و دویست و سی و چهار میلیون و پانصد و شصت و هفت هزار و هشتصد و نود ریال"
    assert rial_words(1_000_000_000_000) == "یک تریلیون ریال"
    assert rial_words(999_999_999_999_999) == ("نهصد و نود و نه تریلیون و نهصد و نود و نه میلیارد و نهصد و نود و نه میلیون و "
                                              "نهصد و نود و نه هزار و نهصد و نود و نه ریال")


# ---------- the sheet, cell by cell (the example from the photo: 222 m2 x 4,500,000 = 999,000,000) ----------
def test_invoice_content_and_order(client):
    ws = sheet(client, FULL)
    assert ws.title == TITLE and ws.sheet_view.rightToLeft is True
    R = rows(ws)
    pad = lambda *v: list(v) + [None] * (9 - len(v))
    assert R[0] == ["شماره: 4", None, None, "فروش کالا و خدمات", None, None, None, "مورخ: 1405/09/01", None]
    assert R[1][0] == "مشخصات پیمانکار" and R[2] == [
        "نام شخص حقوقی: پیمانکاری اسکندری\nنشانی کامل: استان تهران شهرستان تهران", None, None,
        "شماره اقتصادی: 411\nکد پستی: 1234567890", None, None, "شماره ملی: 22596", None, "شماره تماس: 09385209890"]
    assert R[3][0] == "مشخصات کارفرما"
    assert R[4] == ["نام شخص حقیقی/حقوقی: پروژه دسترسی به آزادراه تهران شمال", None, None, None,
                    "شماره اقتصادی: 99", None, None, "شماره ثبت/ملی: 88", None]
    assert R[5] == ["نشانی: تهران", None, None, None, None, None, None, "تلفن: 021", None]
    assert R[6][0] == "مشخصات کالا یا خدمات مورد معامله"
    assert R[7] == HEAD
    assert R[8] == [1, ITEM["description"], "متر مربع", 222, 4_500_000, 999_000_000, 0, 0, 999_000_000]
    assert [r[0] for r in R[9:12]] == [2, 3, 4] and all(v is None for r in R[9:12] for v in r[1:])   # 4 numbered rows always
    assert R[12] == ["جمع کل", None, 999_000_000, None, None, "نهصد و نود و نه میلیون ریال", None, None, None]
    assert R[13] == ["شرایط و نحوه فروش", None, "نقدی", None, "✓", "غیر نقدی", None, None, None]
    assert R[14] == ["شماره شبا", None, FULL["sheba"], None, None, None, None, None, None]
    assert R[15] == ["پیمانکار:", None, "نقشه بردار:", None, "سرپرست اجرا:", None, "سرپرست کارگاه:", None, "مدیریت پروژه:"]
    assert len(R) == 16


def test_columns_are_computed_not_typed(client):
    items = [item(quantity="10", unit_price=1000, tax=250, discount=300),     # 10000, total 10250 (discount only shown)
             item(quantity="2.5", unit_price=3, tax=0),                       # 7.5 -> 8 (half up)
             item(quantity="0.001", unit_price=500),                          # 0.5 -> 1 (half up)
             item(quantity="0", unit_price=999),
             item(quantity="1.125", unit_price=1000, tax=5)]                  # 1125, total 1130
    R = rows(sheet(client, {**FULL, "items": items}))
    assert [(r[3], r[4], r[5], r[6], r[7], r[8]) for r in R[8:13]] == [
        (10, 1000, 10000, 250, 300, 10250), (2.5, 3, 8, 0, 0, 8), (0.001, 500, 1, 0, 0, 1), (0, 999, 0, 0, 0, 0),
        (1.125, 1000, 1125, 5, 0, 1130)]
    assert R[13][2] == 10250 + 8 + 1 + 0 + 1130 == 11389     # جمع کل = sum of the last column
    assert R[13][5] == rial_words(11389) == "یازده هزار و سیصد و هشتاد و نه ریال"


def test_more_than_four_items_and_blank_form(client):
    R = rows(sheet(client, {**FULL, "items": [item(description=f"d{i}") for i in range(7)]}))
    assert [r[0] for r in R[8:15]] == list(range(1, 8)) and R[15][0] == "جمع کل" and R[15][2] == 7 * 999_000_000
    R = rows(sheet(client, {}))                                   # nothing typed: an empty form, total zero
    assert R[0][0] == "شماره:" and R[0][7] == "مورخ:" and R[12][2] == 0 and R[12][5] == "صفر ریال" and len(R) == 16
    assert [r[0] for r in R[8:12]] == [1, 2, 3, 4]


@pytest.mark.parametrize("payment,cash,non_cash", [("cash", "✓", None), ("non_cash", None, "✓"), ("", None, None)])
def test_payment_choice(client, payment, cash, non_cash):
    r = rows(sheet(client, {**FULL, "payment": payment}))[13]
    assert (r[4], r[7]) == (cash, non_cash)


def test_layout_and_print_setup(client):
    ws = sheet(client, FULL)
    last = ws.max_row
    assert sorted(map(str, ws.merged_cells.ranges)) == sorted([
        "A1:C1", "D1:G1", "H1:I1", "A2:I2", "A3:C3", "D3:F3", "G3:H3", "A4:I4", "A5:D5", "E5:G5", "H5:I5", "A6:G6", "H6:I6", "A7:I7",
        "A13:B13", "C13:E13", "F13:I13", "A14:B14", "C14:D14", "F14:G14", "H14:I14", "A15:B15", "C15:I15",
        "A16:B16", "C16:D16", "E16:F16", "G16:H16"])
    assert ws.page_setup.orientation == "landscape" and int(ws.page_setup.paperSize) == 9
    assert ws.sheet_properties.pageSetUpPr.fitToPage and (ws.page_setup.fitToWidth, ws.page_setup.fitToHeight) == (1, 1)
    assert [ws.column_dimensions[c].width for c in "ABCDEFGHI"] == [8, 40, 14, 12, 18, 20, 18, 16, 26]
    assert ws.row_dimensions[last].height == 80 and all(ws.row_dimensions[i].height >= 22 for i in range(1, last + 1))
    # numbers are real numbers with the thousands separator; zero tax / discount show a dash
    assert ws["E9"].number_format == "#,##0" and ws["F9"].number_format == "#,##0" and ws["I9"].number_format == "#,##0"
    assert ws["G9"].number_format == ws["H9"].number_format == '#,##0;-#,##0;"—"'
    assert ws["C13"].number_format == '#,##0" ریال"' and ws["C13"].data_type == "n" and ws["D9"].data_type == "n"
    assert ws["A8"].font.b and ws["A8"].fill.fgColor.rgb.endswith("F4EBE8") and ws["A2"].fill.fgColor.rgb.endswith("F4EBE8")
    # heavy frame around the whole form, thin grid inside, in merged boxes too
    for c in ws[1]:
        assert c.border.top.style == "medium"
    for c in ws[last]:
        assert c.border.bottom.style == "medium"
    for row in ws.iter_rows(min_row=1, max_row=last, max_col=9):
        assert row[0].border.left.style == "medium" and row[8].border.right.style == "medium", row[0].row
    for coord, side in (("A3", "left"), ("C3", "right"), ("D3", "left"), ("F3", "right"), ("I3", "left"), ("I3", "right"), ("C9", "right")):
        assert getattr(ws[coord].border, side).style in ("thin", "medium"), (coord, side)
    assert ws["C3"].border.left.style is None and ws["B3"].border.right.style is None   # no line inside a merged box


def test_typed_text_never_runs_as_a_formula(client):
    ws = sheet(client, {**FULL, "sheba": "=1+1", "items": [item(description='=HYPERLINK("http://evil","x")', unit="+cmd")]})
    assert ws["C15"].value == "=1+1" and ws["C15"].data_type == "s"
    assert ws["B9"].data_type == "s" and ws["B9"].value.startswith("=HYPERLINK")


def test_download_headers_and_text_is_trimmed(client):
    r = post(client, {**FULL, "number": "  7  "})
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert r.headers["content-disposition"] == 'attachment; filename="shahran-invoice.xlsx"' and r.content[:2] == b"PK"
    assert rows(load_workbook(io.BytesIO(r.content)).active)[0][0] == "شماره: 7"


def test_biggest_allowed_amounts(client):
    ws = sheet(client, {**FULL, "items": [item(quantity="1", unit_price=10**13, tax=10**13) for _ in range(30)]})
    assert ws["I9"].value == 2 * 10**13 and ws["C39"].value == 60 * 10**13
    assert ws["F39"].value == "ششصد تریلیون ریال"


# ---------- bad requests ----------
BAD = [
    "", "not json", "[]", '{"items": "x"}', json.dumps({**FULL, "payment": "card"}),
    json.dumps({**FULL, "items": [item(description="")]}), json.dumps({**FULL, "items": [item(description="   ")]}),
    json.dumps({**FULL, "items": [item(quantity="-1")]}), json.dumps({**FULL, "items": [item(quantity="1.0001")]}),
    json.dumps({**FULL, "items": [item(quantity="1000001")]}), json.dumps({**FULL, "items": [item(quantity="abc")]}),
    json.dumps({**FULL, "items": [item(unit_price=-1)]}), json.dumps({**FULL, "items": [item(unit_price="5")]}),
    json.dumps({**FULL, "items": [item(unit_price=1.5)]}), json.dumps({**FULL, "items": [item(unit_price=10**13 + 1)]}),
    json.dumps({**FULL, "items": [item(tax=-1)]}), json.dumps({**FULL, "items": [item(discount=10**13 + 1)]}),
    json.dumps({**FULL, "items": [item(quantity="1000000", unit_price=10**13)]}),       # row total above the limit
    json.dumps({**FULL, "items": [item()] * 31}), json.dumps({**FULL, "number": "x" * 31}), json.dumps({**FULL, "sheba": "x" * 201}),
]


@pytest.mark.parametrize("data", BAD)
def test_bad_invoices_are_422(client, data):
    assert post(client, data).status_code == 422


def test_missing_field_and_unknown_get(client):
    assert client.post(URL).status_code == 422
    assert client.post(URL, data={"other": "{}"}).status_code == 422
    assert client.get(URL).status_code == 422          # the invoice is POST only; the table downloads stay as they were
    assert client.get("/api/shahran/export/invoice", params={"from": "2026-10-23", "to": "2026-11-21"}).status_code == 422


def test_farsi_text_survives_the_form_encoding(client):
    # what a browser really sends: UTF-8 percent-encoded form body
    from urllib.parse import quote
    body = "data=" + quote(json.dumps(FULL, ensure_ascii=False))
    r = client.post(URL, content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 200 and rows(load_workbook(io.BytesIO(r.content)).active)[8][1] == ITEM["description"]
