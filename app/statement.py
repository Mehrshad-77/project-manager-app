"""The final-statements financial account (حساب مالی صورت وضعیت های نهایی شده) as a print-ready Excel file.
Shared by every project: one route, nothing stored. The page sends what the person typed and gets the .xlsx back."""
import io
from typing import Annotated
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request, Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.export import CELL, HEAD_FILL, MEDIUM, TEXT, THIN, XLSX_TYPE, _height

router = APIRouter(prefix="/api/statement", tags=["statement"])

TITLE = "حساب مالی صورت وضعیت های نهایی شده"
MONEY_MAX = 10**13
WIDTHS = [22, 20, 28, 32]  # right to left: title box, sub-title, the typed value, توضیحات
COLS = len(WIDTHS)
# (key, Farsi title). The first two values are typed text, the rest are amounts in rials.
ROWS = [("send_date", "تاریخ ارسال"), ("title", "عنوان صورت وضعیت"), ("gross", "مبلغ ناخالص صورت وضعیت"),
        ("retention", "حسن انجام کار"), ("goods", "خدمات و کالا"), ("food", "غذا"),
        ("deductions", "مجموع کسورات"), ("net_payable", "مبلغ خالص قابل پرداخت صورت وضعیت"),
        ("net_salaries", "مبلغ خالص حقوق و مزایای پرسنل"), ("net_services", "مبلغ خالص خدمات و هزینه‌های جانبی"),
        ("net_remaining", "مبلغ خالص مانده پیمانکار")]
KEYS = [k for k, _ in ROWS]
AMOUNT_KEYS = KEYS[2:]
DEDUCTIONS = ("retention", "goods", "food")  # the three small rows beside the box کسورات صورت وضعیت
BOX_TITLE = "کسورات صورت وضعیت"
MONEY = '#,##0" ریال"'
Money = Annotated[int, Field(strict=True, ge=0, le=MONEY_MAX)]


class Statement(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    send_date: str = Field("", max_length=30)
    title: str = Field("", max_length=300)
    amounts: dict[str, Money | None] = {}  # empty box = null
    notes: dict[str, Annotated[str, Field(max_length=300)]] = {}  # توضیحات of each row

    @field_validator("amounts", "notes")
    @classmethod
    def _known_rows(cls, v, info: ValidationInfo):
        unknown = set(v) - set(AMOUNT_KEYS if info.field_name == "amounts" else KEYS)
        if unknown:
            raise ValueError(f"unknown rows: {sorted(unknown)}")
        return v


def statement_xlsx(s: Statement) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "statement"
    ws.sheet_view.rightToLeft = True
    boxes, heights = [], {}  # boxes: (first row, first col, last row, last col); every cell sits in exactly one
    bold, head = Font(bold=True), Font(bold=True, color="3B1515")

    def put(r1, c1, r2, c2, value, align=CELL, font=None, fill=None, fmt=None):
        cell = ws.cell(r1, c1, value)
        if cell.data_type == "f":  # typed text such as "=1+1" must stay text
            cell.data_type = "s"
        cell.alignment = align
        if font:
            cell.font = font
        if fill:
            cell.fill = fill
        if fmt:
            cell.number_format = fmt
        boxes.append((r1, c1, r2, c2))
        for r in range(r1, r2 + 1):
            heights[r] = max(heights.get(r, 0), _height([value], [sum(WIDTHS[c1 - 1:c2])], 28))

    put(1, 1, 1, COLS, TITLE, CELL, Font(bold=True, size=14, color="3B1515"), HEAD_FILL)
    put(2, 1, 2, COLS - 1, None, CELL, fill=HEAD_FILL)
    put(2, COLS, 2, COLS, "توضیحات", CELL, head, HEAD_FILL)
    r = 2
    for key, label in ROWS:
        r += 1
        if key in DEDUCTIONS:
            if key == DEDUCTIONS[0]:
                put(r, 1, r + len(DEDUCTIONS) - 1, 1, BOX_TITLE, CELL, bold)
            put(r, 2, r, 2, label, CELL, bold)
        else:
            put(r, 1, r, 2, label, CELL, bold)
        if key in AMOUNT_KEYS:
            put(r, 3, r, 3, s.amounts.get(key), CELL, fmt=MONEY)
        else:
            put(r, 3, r, 3, getattr(s, key) or None, CELL)
        put(r, 4, r, 4, s.notes.get(key, "").strip() or None, TEXT)
    last = r

    for r1, c1, r2, c2 in boxes:  # thin black grid, heavy frame around the whole table
        if (r1, c1) != (r2, c2):
            ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
        for r in range(r1, r2 + 1):
            for k in range(c1, c2 + 1):
                ws.cell(r, k).border = Border(
                    left=(MEDIUM if k == 1 else THIN) if k == c1 else None,
                    right=(MEDIUM if k == COLS else THIN) if k == c2 else None,
                    top=(MEDIUM if r == 1 else THIN) if r == r1 else None,
                    bottom=(MEDIUM if r == last else THIN) if r == r2 else None)
    for i, w in enumerate(WIDTHS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row, h in heights.items():
        ws.row_dimensions[row].height = h
    ws.page_setup.paperSize = ws.PAPERSIZE_A4  # one portrait A4 page
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_options.horizontalCentered = True
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


@router.post("/export")
async def export_statement(request: Request):
    """Download the statement as .xlsx. The page submits an ordinary form with one field, `data`, holding the
    statement as JSON (see Statement); a form post downloads the same way the other export buttons do."""
    data = parse_qs((await request.body()).decode("utf-8", "replace")).get("data", [""])[0]
    try:
        statement = Statement.model_validate_json(data)
    except ValueError as e:  # pydantic's ValidationError
        raise HTTPException(422, str(e))
    return Response(statement_xlsx(statement), media_type=XLSX_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="statement.xlsx"'})
