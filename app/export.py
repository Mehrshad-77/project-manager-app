"""Shared by every project: turn rows into a downloadable Excel (.xlsx) or CSV response."""
import csv
import io
import math
from datetime import date, time

import jdatetime
from fastapi import Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
THIN, MEDIUM = Side(style="thin", color="000000"), Side(style="medium", color="000000")  # black grid, heavy outer frame
HEAD_FILL = PatternFill("solid", fgColor="F4EBE8")  # same soft tint as the screen's table header
CELL = Alignment(horizontal="center", vertical="center", wrap_text=True)
TEXT = Alignment(vertical="center", wrap_text=True)  # no horizontal setting: Farsi text starts on the right
DAY_HEADERS = ("تاریخ",)  # the Solar date, as text like on screen (1405/08/09 also sorts correctly)
LETTER_OPENING = "بسمه تعالی"
TOTAL_LABEL = "جمع"
SIGNATURES = ("نقشه بردار_مسئول اجراء:", "مدیریت کارگاه:")  # right box, left box (the sheet reads right to left)
WIDTH = 20


def day_cells(d: date) -> list:
    j = jdatetime.date.fromgregorian(date=d)
    return [f"{j.year:04d}/{j.month:02d}/{j.day:02d}"]


def _csv_safe(v):
    """Excel runs text that starts with = + - @ as a formula; a leading quote keeps it text."""
    return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v


def _height(cells, widths, base=22):
    """Row height in points: `base`, plus one line more for every extra line the wrapped text needs."""
    lines = max((sum(max(1, math.ceil(len(p) / max(w - 2, 1))) for p in v.split("\n"))
                 for v, w in zip(cells, widths) if isinstance(v, str)), default=1)
    return base + 16 * (lines - 1)


def export_file(project, table, fmt, rng, title, headers, rows, letter=None):
    """rows: tuples whose first item is the day (a date); the rest follow `headers`.
    xlsx: a boxed table (thin black grid, heavy frame), `title` as a heading above it. With
    letter=(date, addressee, body) it is laid out like a printed letter instead: opening line and typed text
    on top, the table, a totals row, and two empty signature boxes. The CSV is always a plain table."""
    headers = [*DAY_HEADERS, *headers]
    rows = [[*day_cells(r[0]), *r[1:]] for r in rows]
    if fmt == "xlsx":
        wb = Workbook()
        ws = wb.active
        ws.title = table
        ws.sheet_view.rightToLeft = True
        n = len(headers)
        widths = [WIDTH] * (n - 1) + [WIDTH * 2 if letter else WIDTH]  # the last column holds the explanations
        if letter:
            when, to, body = letter
            ws.append([LETTER_OPENING, *[None] * (n - 2), when])
            ws.append([to])
            ws.append([body])
            head = 4
        else:
            ws.append([title])
            head = 2
        ws.append(headers)
        for r in rows:
            ws.append(r)
        if letter:
            sums = [sum(c) if all(type(v) is int for v in c) else None for c in list(zip(*rows))[1:]]
            ws.append([TOTAL_LABEL, *sums])
            half = n - n // 2  # right box covers the first columns, left box the rest
            ws.append([SIGNATURES[0], *[None] * (half - 1), SIGNATURES[1]])
            ws.merge_cells(start_row=ws.max_row, start_column=1, end_row=ws.max_row, end_column=half)
            ws.merge_cells(start_row=ws.max_row, start_column=half + 1, end_row=ws.max_row, end_column=n)
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n - 1)  # opening line; the date stays at the end
            ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n)
            ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=n)
        else:
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n)
        last = ws.max_row
        for row in ws.iter_rows(max_col=n):  # creates the empty cells too, so every one gets its lines
            for c in row:
                r, k = c.row, c.column
                g = THIN if r >= head else None  # grid from the header row down; the heading above it has none
                c.border = Border(
                    left=MEDIUM if k == 1 else g, right=MEDIUM if k == n else g,
                    top=MEDIUM if r == 1 else g, bottom=MEDIUM if r == last else THIN if r == head - 1 else g)
                if c.data_type == "f":  # typed text such as "=1+1" must stay text
                    c.data_type = "s"
                elif isinstance(c.value, time):
                    c.number_format = "hh:mm"
                if r >= head:
                    c.alignment = CELL
        for m in ws.merged_cells.ranges:  # a merged box takes its outline from its first cell: give it the box's right edge
            first = ws.cell(m.min_row, m.min_col)
            first.border = Border(left=first.border.left, top=first.border.top, bottom=first.border.bottom,
                                  right=ws.cell(m.min_row, m.max_col).border.right)
        for c in ws[head]:
            c.font, c.fill = Font(bold=True, color="3B1515"), HEAD_FILL
        centre = Alignment(horizontal="center", vertical="center")
        ws["A1"].alignment = centre
        if letter:
            ws["A1"].font = Font(bold=True, size=12)
            ws.cell(1, n).alignment = centre  # the typed date
            for r in (2, 3):
                ws.cell(r, 1).alignment = TEXT
            for c in ws[last - 1]:  # totals row
                c.font = Font(bold=True)
            for k in (1, half + 1):  # signature boxes: label at the top, space below for the stamp
                ws.cell(last, k).alignment = Alignment(vertical="top", wrap_text=True)
        else:
            ws["A1"].font = Font(bold=True, size=14, color="3B1515")
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        total_w = sum(widths)
        for r in range(1, last + 1):  # taller rows for the printed page; wrapped text gets the extra lines it needs
            cells = [c.value for c in ws[r][:n]]
            if letter and r in (2, 3):
                ws.row_dimensions[r].height = _height(cells[:1], [total_w])
            elif letter and r == last:
                ws.row_dimensions[r].height = 80  # room for the stamp and signature
            else:
                ws.row_dimensions[r].height = _height(cells, widths, 28 if r == 1 else 22)
        # on screen: header stays visible. On paper: A4, whole table one page wide, header repeated on every page.
        if not letter:
            ws.freeze_panes = "A3"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.orientation = "landscape" if n > 5 else "portrait"
        ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
        ws.print_title_rows = f"{head if letter else 1}:{head}"
        ws.print_options.horizontalCentered = True
        ws.oddFooter.center.text = "&P / &N"
        out = io.BytesIO()
        wb.save(out)
        content, media = out.getvalue(), XLSX_TYPE
    else:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(headers)
        for r in rows:
            w.writerow([v.strftime("%H:%M") if isinstance(v, time) else _csv_safe(v) for v in r])
        content, media = buf.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8"  # BOM: Excel reads Farsi correctly
    name = f"{project}-{table}_{rng[0]}_{rng[1]}.{fmt}"
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})
