"""shahran: the Kohsar shotcrete invoice (فاکتور شاتکریت کوهسار) as a print-ready Excel file.
Nothing is stored: the page sends everything the person typed and gets the .xlsx back."""
import io
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.export import CELL, HEAD_FILL, MEDIUM, TEXT, THIN, _height

TITLE = "فاکتور شاتکریت کوهسار"
MONEY_MAX = 10**13  # every amount, and every row total: keeps 30 rows below a quadrillion rials
MAX_ITEMS = 30
MIN_ROWS = 4  # the printed form always shows at least this many numbered rows
WIDTHS = [8, 40, 14, 12, 18, 20, 18, 16, 26]  # the 9 table columns; everything else is merged boxes across them
COLS = len(WIDTHS)
HEADERS = ["ردیف", "شرح کالا", "واحد کالا", "تعداد", "مبلغ واحد (ریال)", "مبلغ کل (ریال)", "جمع مالیات و عوارض (ریال)",
           "مبلغ تخفیف", "جمع کل به علاوه مالیات و عوارض (ریال)"]
SIGNATURES = [("پیمانکار:", 1, 2), ("نقشه بردار:", 3, 4), ("سرپرست اجرا:", 5, 6), ("سرپرست کارگاه:", 7, 8), ("مدیریت پروژه:", 9, 9)]
AMOUNT = "#,##0"
OPTIONAL_AMOUNT = '#,##0;-#,##0;"—"'  # zero tax / discount shows a dash, like the paper form
TOTAL = '#,##0" ریال"'


# ---------- number in Farsi words ----------
ONES = ("", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده", "یازده", "دوازده", "سیزده", "چهارده",
        "پانزده", "شانزده", "هفده", "هجده", "نوزده")
TENS = ("", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود")
HUNDREDS = ("", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد")
SCALES = ("", "هزار", "میلیون", "میلیارد", "تریلیون")


def rial_words(n: int) -> str:
    """999000000 -> 'نهصد و نود و نه میلیون ریال' (n below a quadrillion)."""
    if n == 0:
        return "صفر ریال"
    parts = []
    for scale in SCALES:
        n, g = divmod(n, 1000)
        if g:
            r = g % 100
            words = [HUNDREDS[g // 100], ONES[r] if r < 20 else TENS[r // 10], ONES[r % 10] if r >= 20 else ""]
            parts.append(" و ".join(w for w in words if w) + (" " + scale if scale else ""))
        if not n:
            break
    return " و ".join(reversed(parts)) + " ریال"


# ---------- what the page sends ----------
class Item(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    description: str = Field(min_length=1, max_length=300)
    unit: str = Field("", max_length=30)
    quantity: Decimal = Field(ge=0, le=10**6, decimal_places=3)
    unit_price: int = Field(strict=True, ge=0, le=MONEY_MAX)
    tax: int = Field(0, strict=True, ge=0, le=MONEY_MAX)
    discount: int = Field(0, strict=True, ge=0, le=MONEY_MAX)  # shown only: the form's last column is total + tax

    @property
    def total(self) -> int:  # تعداد × مبلغ واحد, whole rials (halves round up)
        return int((self.quantity * self.unit_price).quantize(Decimal(1), rounding=ROUND_HALF_UP))

    @property
    def final(self) -> int:  # مبلغ کل + جمع مالیات و عوارض
        return self.total + self.tax


class Invoice(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    number: str = Field("", max_length=30)
    date: str = Field("", max_length=30)  # the Solar date, typed or picked on the page
    contractor_name: str = Field("", max_length=150)
    contractor_address: str = Field("", max_length=300)
    contractor_economic_no: str = Field("", max_length=30)
    contractor_postal_code: str = Field("", max_length=30)
    contractor_national_id: str = Field("", max_length=30)
    contractor_phone: str = Field("", max_length=40)
    employer_name: str = Field("", max_length=150)
    employer_economic_no: str = Field("", max_length=30)
    employer_registration_no: str = Field("", max_length=30)
    employer_address: str = Field("", max_length=300)
    employer_phone: str = Field("", max_length=40)
    items: list[Item] = Field(default_factory=list, max_length=MAX_ITEMS)
    payment: Literal["", "cash", "non_cash"] = ""  # نقدی / غیر نقدی
    sheba: str = Field("", max_length=200)

    @model_validator(mode="after")
    def _row_totals_fit(self):
        for i, it in enumerate(self.items, 1):
            if it.total > MONEY_MAX:
                raise ValueError(f"row {i}: quantity x unit price is above {MONEY_MAX}")
        return self

    @property
    def total(self) -> int:
        return sum(it.final for it in self.items)


# ---------- the workbook ----------
def invoice_xlsx(inv: Invoice) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = TITLE
    ws.sheet_view.rightToLeft = True
    boxes, heights = [], {}  # boxes: (row, first column, last column), every cell of the sheet sits in exactly one

    def put(row, c1, c2, value, align=TEXT, font=None, fill=None, fmt=None, base=22):
        cell = ws.cell(row, c1, value)
        if cell.data_type == "f":  # typed text such as "=1+1" must stay text
            cell.data_type = "s"
        cell.alignment = align
        if font:
            cell.font = font
        if fill:
            cell.fill = fill
        if fmt:
            cell.number_format = fmt
        boxes.append((row, c1, c2))
        heights[row] = max(heights.get(row, 0), _height([value], [sum(WIDTHS[c1 - 1:c2])], base))

    def heading(row, text):
        put(row, 1, COLS, text, CELL, Font(bold=True, color="3B1515"), HEAD_FILL)

    def field(label, value):
        return f"{label}: {value}" if value else f"{label}:"

    bold = Font(bold=True)
    r = 1
    put(r, 1, 3, field("شماره", inv.number), CELL)  # the sheet reads right to left: number at the right, date at the left
    put(r, 4, 7, "فروش کالا و خدمات", CELL, Font(bold=True, size=14, color="3B1515"), base=28)
    put(r, 8, 9, field("مورخ", inv.date), CELL)

    r += 1
    heading(r, "مشخصات پیمانکار")
    r += 1
    put(r, 1, 3, field("نام شخص حقوقی", inv.contractor_name) + "\n" + field("نشانی کامل", inv.contractor_address))
    put(r, 4, 6, field("شماره اقتصادی", inv.contractor_economic_no) + "\n" + field("کد پستی", inv.contractor_postal_code))
    put(r, 7, 8, field("شماره ملی", inv.contractor_national_id))
    put(r, 9, 9, field("شماره تماس", inv.contractor_phone))

    r += 1
    heading(r, "مشخصات کارفرما")
    r += 1
    put(r, 1, 4, field("نام شخص حقیقی/حقوقی", inv.employer_name))
    put(r, 5, 7, field("شماره اقتصادی", inv.employer_economic_no))
    put(r, 8, 9, field("شماره ثبت/ملی", inv.employer_registration_no))
    r += 1
    put(r, 1, 7, field("نشانی", inv.employer_address))
    put(r, 8, 9, field("تلفن", inv.employer_phone))

    r += 1
    heading(r, "مشخصات کالا یا خدمات مورد معامله")
    r += 1
    for k, text in enumerate(HEADERS, 1):
        put(r, k, k, text, CELL, Font(bold=True, color="3B1515"), HEAD_FILL)
    for i in range(max(MIN_ROWS, len(inv.items))):
        r += 1
        it = inv.items[i] if i < len(inv.items) else None
        q = it and (int(it.quantity) if it.quantity == it.quantity.to_integral_value() else float(it.quantity))
        cells = [(i + 1, None), (it and it.description, None), (it and it.unit, None), (q, "General"),
                 (it and it.unit_price, AMOUNT), (it and it.total, AMOUNT), (it and it.tax, OPTIONAL_AMOUNT),
                 (it and it.discount, OPTIONAL_AMOUNT), (it and it.final, AMOUNT)]
        for k, (value, fmt) in enumerate(cells, 1):
            put(r, k, k, value if value != "" else None, CELL, fmt=fmt)

    r += 1  # the total, as a number and in words, in the same row
    put(r, 1, 2, "جمع کل", CELL, bold)
    put(r, 3, 5, inv.total, CELL, bold, fmt=TOTAL)
    put(r, 6, 9, rial_words(inv.total), CELL, bold)

    r += 1
    put(r, 1, 2, "شرایط و نحوه فروش", CELL, bold)
    put(r, 3, 4, "نقدی", CELL)
    put(r, 5, 5, "✓" if inv.payment == "cash" else None, CELL, bold)
    put(r, 6, 7, "غیر نقدی", CELL)
    put(r, 8, 9, "✓" if inv.payment == "non_cash" else None, CELL, bold)

    r += 1
    put(r, 1, 2, "شماره شبا", CELL, bold)
    put(r, 3, 9, inv.sheba, CELL)

    r += 1  # five empty boxes for the stamps and signatures
    for label, c1, c2 in SIGNATURES:
        put(r, c1, c2, label, Alignment(vertical="top", wrap_text=True), bold)
    heights[r] = 80

    last = r
    for row, c1, c2 in boxes:  # thin black grid, heavy frame around the whole form
        if c2 > c1:
            ws.merge_cells(start_row=row, start_column=c1, end_row=row, end_column=c2)
        for k in range(c1, c2 + 1):
            ws.cell(row, k).border = Border(
                left=(MEDIUM if k == 1 else THIN) if k == c1 else None, right=(MEDIUM if k == COLS else THIN) if k == c2 else None,
                top=MEDIUM if row == 1 else THIN, bottom=MEDIUM if row == last else THIN)
    for i, w in enumerate(WIDTHS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row, h in heights.items():
        ws.row_dimensions[row].height = h

    ws.page_setup.paperSize = ws.PAPERSIZE_A4  # one landscape A4 page, like the paper form
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_options.horizontalCentered = True
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
