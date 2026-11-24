"""shahran API: workers, daily time sheet, aggregated daily counts, monthly attendance sheet and monthly pay."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import jdatetime
import psycopg
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from psycopg import sql
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db import db
from app.export import XLSX_TYPE, export_file
from shahran.backend.invoice import Invoice, invoice_xlsx

router = APIRouter(prefix="/api/shahran", tags=["shahran"])

INT_MAX = 2_147_483_647  # PostgreSQL INTEGER limit
SALARY_MAX = 10**12
MAX_RANGE_DAYS = 400
MIN_DAY = date(1921, 3, 21)  # Solar 1300-01-01, start of the range the calendar code is verified for
WorkerId = Field(strict=True, gt=0, le=INT_MAX)
RULES = {"both_times_or_none": "arrival_time and exit_time must both be filled or both be empty"}


def today() -> date:
    return datetime.now(ZoneInfo("Asia/Tehran")).date()


def check_day(d: date) -> date:
    if d > today():
        raise ValueError("work_day cannot be in the future")
    if d < MIN_DAY:
        raise ValueError(f"work_day cannot be before {MIN_DAY}")
    return d


def blank_to_none(v):
    return v if v is None or v.strip() else None


# ---------- database helpers ----------
def run(query, params=()):
    """One statement in its own transaction; rows come back as dicts. Database rules become HTTP errors."""
    try:
        with db() as conn:
            return conn.execute(query, params).fetchall()
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "a row with this key already exists")
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(409, "worker does not exist, or the worker still has time sheet rows")
    except psycopg.errors.CheckViolation as e:
        raise HTTPException(422, RULES.get(e.diag.constraint_name, f"rejected by database rule {e.diag.constraint_name}"))


def _where(keys):
    return sql.SQL(" AND ").join(sql.SQL("{}=%s").format(sql.Identifier(k)) for k in keys)


def insert(table, data):
    q = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
        sql.Identifier("shahran", table),
        sql.SQL(",").join(map(sql.Identifier, data)),
        sql.SQL(",").join(sql.Placeholder() * len(data)),
    )
    return run(q, list(data.values()))[0]


def update(table, data, where):
    q = sql.SQL("UPDATE {} SET {} WHERE {} RETURNING *").format(
        sql.Identifier("shahran", table),
        sql.SQL(",").join(sql.SQL("{}=%s").format(sql.Identifier(k)) for k in data),
        _where(where),
    )
    rows = run(q, list(data.values()) + list(where.values()))
    if not rows:
        raise HTTPException(404, "row not found")
    return rows[0]


def delete(table, where):
    q = sql.SQL("DELETE FROM {} WHERE {} RETURNING 1 AS deleted").format(sql.Identifier("shahran", table), _where(where))
    if not run(q, list(where.values())):
        raise HTTPException(404, "row not found")
    return Response(status_code=204)


def changes(body: BaseModel, nullable=()):
    """Only the fields the caller sent. null is accepted just for columns that may be empty."""
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(422, "send at least one field to change")
    for k, v in data.items():
        if v is None and k not in nullable:
            raise HTTPException(422, f"{k} cannot be null")
    return data


def date_range(date_from: date = Query(alias="from"), date_to: date = Query(alias="to")):
    if date_to < date_from:
        raise HTTPException(422, "'to' must not be before 'from'")
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(422, f"range is limited to {MAX_RANGE_DAYS} days")
    return date_from, date_to


DayPath = Path(description="Gregorian date, YYYY-MM-DD")
WorkerPath = Path(gt=0, le=INT_MAX)


def valid_day(d: date) -> date:
    try:
        return check_day(d)
    except ValueError as e:
        raise HTTPException(422, str(e))


# ---------- workers ----------
class WorkerOut(BaseModel):
    worker_id: int
    full_name: str
    role: str
    daily_salary: int


class WorkerIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=100)
    role: Literal["simple", "builder"]  # simple = کارگر ساده, builder = بنا
    daily_salary: int = Field(strict=True, ge=0, le=SALARY_MAX)


class WorkerPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    full_name: str | None = Field(None, min_length=1, max_length=100)
    role: Literal["simple", "builder"] | None = None
    daily_salary: int | None = Field(None, strict=True, ge=0, le=SALARY_MAX)


@router.get("/workers", response_model=list[WorkerOut])
def list_workers():
    return run("SELECT * FROM shahran.workers ORDER BY full_name")


@router.post("/workers", status_code=201, response_model=WorkerOut)
def create_worker(body: WorkerIn):
    """Add a worker. Fails with 409 if the name is already used."""
    return insert("workers", body.model_dump())


@router.patch("/workers/{worker_id}", response_model=WorkerOut)
def patch_worker(worker_id: int = WorkerPath, *, body: WorkerPatch):
    """Change only the fields sent. The worker must already exist."""
    return update("workers", changes(body), {"worker_id": worker_id})


@router.delete("/workers/{worker_id}", status_code=204)
def delete_worker(worker_id: int = WorkerPath):
    """409 while the worker still has time sheet rows."""
    return delete("workers", {"worker_id": worker_id})


# ---------- daily time sheet (کارکرد روزانه) ----------
class SheetOut(BaseModel):
    work_day: date
    worker_id: int
    full_name: str | None = None  # only in the list
    arrival_time: time | None
    exit_time: time | None
    overtime: float  # hours
    is_holiday: bool
    is_off_day: bool
    explanation: str | None


class SheetIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    work_day: date
    worker_id: int = WorkerId
    arrival_time: time | None = None
    exit_time: time | None = None
    overtime: Decimal = Field(Decimal(0), ge=0, le=24, decimal_places=2)
    is_holiday: bool = Field(False, strict=True)
    is_off_day: bool = Field(False, strict=True)
    explanation: str | None = None

    _no_future = field_validator("work_day")(check_day)
    _blank = field_validator("explanation")(blank_to_none)


class SheetPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    work_day: date | None = None
    worker_id: int | None = Field(None, strict=True, gt=0, le=INT_MAX)
    arrival_time: time | None = None
    exit_time: time | None = None
    overtime: Decimal | None = Field(None, ge=0, le=24, decimal_places=2)
    is_holiday: bool | None = Field(None, strict=True)
    is_off_day: bool | None = Field(None, strict=True)
    explanation: str | None = None

    @field_validator("work_day")
    @classmethod
    def _no_future(cls, v):
        return v if v is None else check_day(v)

    _blank = field_validator("explanation")(blank_to_none)


def fetch_time_sheet(rng):
    return run(
        """SELECT t.*, w.full_name FROM shahran.daily_time_sheet t
           JOIN shahran.workers w USING (worker_id)
           WHERE t.work_day BETWEEN %s AND %s ORDER BY t.work_day, w.full_name""",
        rng,
    )


@router.get("/time-sheet", response_model=list[SheetOut])
def list_time_sheet(rng: tuple[date, date] = Depends(date_range)):
    """Rows from `from` to `to` inclusive, with each worker's name."""
    return fetch_time_sheet(rng)


@router.post("/time-sheet", status_code=201, response_model=SheetOut)
def create_time_sheet_row(body: SheetIn):
    """Add a row. 409 if that worker already has a row for that day, or the worker does not exist."""
    return insert("daily_time_sheet", body.model_dump())


@router.patch("/time-sheet/{work_day}/{worker_id}", response_model=SheetOut)
def patch_time_sheet_row(work_day: date = DayPath, worker_id: int = WorkerPath, *, body: SheetPatch):
    """Change only the fields sent (send null to empty a time or the explanation)."""
    data = changes(body, nullable=("arrival_time", "exit_time", "explanation"))
    return update("daily_time_sheet", data, {"work_day": work_day, "worker_id": worker_id})


@router.delete("/time-sheet/{work_day}/{worker_id}", status_code=204)
def delete_time_sheet_row(work_day: date = DayPath, worker_id: int = WorkerPath):
    return delete("daily_time_sheet", {"work_day": work_day, "worker_id": worker_id})


# ---------- aggregated work (کارکرد تجمیعی ماهانه) ----------
# The counts come from the time sheet (view shahran.aggregated_work); only the day's explanation is typed.
class DayOut(BaseModel):
    work_day: date
    total_workers: int
    simple_workers: int
    builders: int
    explanation: str | None


class NoteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    explanation: str = Field(min_length=1)


class NoteOut(BaseModel):
    work_day: date
    explanation: str


def fetch_aggregated(rng):
    """One row for every day from `from` to `to` (zeros on days nobody worked)."""
    found = {
        r["work_day"]: r
        for r in run(
            """SELECT work_day, total_workers, simple_workers, builders, explanation
               FROM shahran.aggregated_work WHERE work_day BETWEEN %s AND %s""",
            rng,
        )
    }
    start, end = rng
    empty = {"total_workers": 0, "simple_workers": 0, "builders": 0, "explanation": None}
    days = (start + timedelta(days=i) for i in range((end - start).days + 1))
    return [found.get(d) or {"work_day": d, **empty} for d in days]


@router.get("/aggregated-work", response_model=list[DayOut])
def aggregated_work(rng: tuple[date, date] = Depends(date_range)):
    """One row for every day from `from` to `to` (zeros on days nobody worked)."""
    return fetch_aggregated(rng)


@router.put("/aggregated-work/{work_day}", response_model=NoteOut)
def set_day_explanation(work_day: date = DayPath, *, body: NoteIn):
    """Set (or replace) the explanation of a day."""
    valid_day(work_day)
    return run(
        """INSERT INTO shahran.daily_notes (work_day, explanation) VALUES (%s, %s)
           ON CONFLICT (work_day) DO UPDATE SET explanation = EXCLUDED.explanation
           RETURNING work_day, explanation""",
        (work_day, body.explanation),
    )[0]


@router.delete("/aggregated-work/{work_day}", status_code=204)
def delete_day_explanation(work_day: date = DayPath):
    return delete("daily_notes", {"work_day": work_day})


# ---------- monthly attendance sheet (حضور و غیاب ماهانه): one column per worker ----------
Role = Literal["simple", "builder"]


class AttendanceWorker(BaseModel):
    worker_id: int
    full_name: str
    daily_salary: int
    pay: int  # work days x daily salary for the range (same rounding as the monthly pay view)


class AttendanceDay(BaseModel):
    work_day: date
    arrival_time: time | None  # earliest arrival of the people who worked that day
    exit_time: time | None  # latest exit of the people who worked that day
    units: list[int]  # one per worker, same order as `workers`: 2 = full day, 1 = half day, 0 = did not work
    explanation: str | None  # the day's explanation (the same one the aggregated sheet shows)


class AttendanceOut(BaseModel):
    workers: list[AttendanceWorker]
    days: list[AttendanceDay]
    totals: list[float]  # work days per worker (a half day counts 0.5)
    total_pay: int
    total_pay_words: str  # total_pay written in Farsi words (without the unit)


ONES = ("", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده", "یازده", "دوازده", "سیزده", "چهارده",
        "پانزده", "شانزده", "هفده", "هجده", "نوزده")
TENS = ("", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود")
HUNDREDS = ("", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد")
SCALES = ("", "هزار", "میلیون", "میلیارد", "هزار میلیارد", "میلیون میلیارد")


def farsi_words(n: int) -> str:
    """891000000 -> 'هشتصد و نود و یک میلیون'."""
    if n == 0:
        return "صفر"
    parts = []
    for scale in SCALES:
        n, g = divmod(n, 1000)
        if g:
            small = [HUNDREDS[g // 100], ONES[g % 100] if g % 100 < 20 else TENS[g % 100 // 10], ONES[g % 10] if g % 100 >= 20 else ""]
            words = " و ".join(p for p in small if p)
            parts.append("هزار" if (g, scale) == (1, "هزار") else words + (" " + scale if scale else ""))
        if not n:
            break
    return " و ".join(reversed(parts))


def fetch_attendance(rng, role):
    """One row for every day from `from` to `to`; one column for each worker of `role` who has a time sheet row in
    that range. A half day is whatever shahran.half_days says, so pay and this sheet can never disagree."""
    sheet = run(
        """SELECT t.work_day, t.worker_id, w.full_name, w.daily_salary, t.arrival_time, t.exit_time,
                  shahran.half_days(t.arrival_time, t.exit_time) AS units
           FROM shahran.daily_time_sheet t JOIN shahran.workers w USING (worker_id)
           WHERE w.role = %s AND t.work_day BETWEEN %s AND %s
           ORDER BY w.full_name, w.worker_id""",
        (role, *rng),
    )
    names = {}  # worker_id -> (name, daily salary), in name order
    cells = {}  # (day, worker_id) -> row
    for r in sheet:
        names.setdefault(r["worker_id"], (r["full_name"], r["daily_salary"]))
        cells[r["work_day"], r["worker_id"]] = r
    days = []
    for d in fetch_aggregated(rng):  # every day of the range, with its explanation
        rows = [cells.get((d["work_day"], i)) for i in names]
        worked = [r for r in rows if r and r["units"]]
        days.append({
            "work_day": d["work_day"],
            "arrival_time": min((r["arrival_time"] for r in worked), default=None),
            "exit_time": max((r["exit_time"] for r in worked), default=None),
            "units": [r["units"] if r else 0 for r in rows],
            "explanation": d["explanation"],
        })
    units = [sum(day["units"][k] for day in days) for k in range(len(names))]  # half-days per worker
    pay = [(u * s + 1) // 2 for u, (_, s) in zip(units, names.values())]  # units/2 days x salary, halves rounded up
    return {
        "workers": [{"worker_id": i, "full_name": n, "daily_salary": s, "pay": p} for (i, (n, s)), p in zip(names.items(), pay)],
        "days": days, "totals": [u / 2 for u in units], "total_pay": sum(pay), "total_pay_words": farsi_words(sum(pay)),
    }


@router.get("/attendance", response_model=AttendanceOut)
def attendance(rng: tuple[date, date] = Depends(date_range), role: Role = "simple"):
    """The monthly attendance sheet for one role (see fetch_attendance)."""
    return fetch_attendance(rng, role)


# ---------- monthly pay ----------
class SalaryOut(BaseModel):
    worker_id: int
    full_name: str
    work_days: float
    daily_salary: int
    salary: int


@router.get("/monthly-salary", response_model=list[SalaryOut])
def monthly_salary(year: int = Query(ge=1300, le=1479, description="Solar year"), month: int = Query(ge=1, le=12)):
    """work_days x daily_salary per worker for one SOLAR month (computed by the shahran.monthly_salary view)."""
    return run(
        """SELECT worker_id, full_name, work_days, daily_salary, salary FROM shahran.monthly_salary
           WHERE solar_year = %s AND solar_month = %s ORDER BY full_name""",
        (year, month),
    )


# ---------- export (Excel .xlsx or CSV) ----------
def hm(t):
    return t and t.replace(second=0, microsecond=0)  # 07:00:00 -> 07:00


def tick(flag):
    return "✓" if flag else ""  # same marks as the screen


# table -> (fetch function, Farsi table name, [(Farsi column header, how to read it from a row)])
EXPORTS = {
    "time-sheet": (fetch_time_sheet, "کارکرد روزانه", [
        ("کارگر", lambda r: r["full_name"]),
        ("ساعت ورود", lambda r: hm(r["arrival_time"])),
        ("ساعت خروج", lambda r: hm(r["exit_time"])),
        ("اضافه‌کاری", lambda r: float(r["overtime"])),
        ("تعطیلات", lambda r: tick(r["is_holiday"])),
        ("مرخصی", lambda r: tick(r["is_off_day"])),
        ("توضیحات", lambda r: r["explanation"]),
    ]),
    "aggregated-work": (fetch_aggregated, "کارکرد تجمیعی ماهانه", [
        ("تعداد نفرات", lambda r: r["total_workers"]),
        ("کارگر ساده", lambda r: r["simple_workers"]),
        ("بنا", lambda r: r["builders"]),
        ("توضیحات", lambda r: r["explanation"]),
    ]),
}


# ---- the attendance sheet's download: title, three boxes, one column per worker, a totals row ----
SITE = "کارگاه تونل دسترسی تهران_شمال پروژه شهران"
CONTRACTOR = "پیمانکار اسکندری"
ROLE_NAMES = {"simple": "کارگر ساده", "builder": "بنا"}
MONTHS = ("فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند")
FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
DASH = "—"


def whole(x):
    return int(x) if x == int(x) else x  # 12.0 -> 12, 13.5 stays


def export_attendance(fmt, rng, role):
    a = fetch_attendance(rng, role)
    j = jdatetime.date.fromgregorian(date=rng[0])
    title = f"{SITE} ({MONTHS[j.month - 1]} {str(j.year).translate(FA_DIGITS)})"
    one = lambda u: (1 if u == 2 else 0.5) if u else DASH  # full day, half day, not worked
    rows = [(d["work_day"], hm(d["arrival_time"]) or DASH, hm(d["exit_time"]) or DASH, *map(one, d["units"]), d["explanation"])
            for d in a["days"]]
    headers = ["ساعت ورود", "ساعت خروج", *(w["full_name"] for w in a["workers"]), "توضیحات"]
    boxes = [(CONTRACTOR, 3), ("حضور‌غیاب کل‌ماه", len(a["workers"])), (f"سمت:{ROLE_NAMES[role]}", 1)]
    ws = a["workers"]
    totals = [  # work days, then the wage rows (money, with the unit in the cell format)
        [("جمع کل کارکرد", 1), (whole(sum(a["totals"])), 2), *[(whole(t), 1) for t in a["totals"]], (None, 1)],
        [("دستمزد روزانه", 3), *[(w["daily_salary"], 1) for w in ws], (None, 1)],
        [("دستمزد قابل پرداخت", 3), *[(w["pay"], 1) for w in ws], (None, 1)],
        [("جمع دستمزد قابل پرداخت", 3), (a["total_pay"], len(ws) + 1)],
        [("مبلغ به حروف", 3), (f"{a['total_pay_words']} ریال", len(ws) + 1)],
    ]
    return export_file("shahran", f"attendance-{role}", fmt, rng, title, headers, rows,
                       boxes=[b for b in boxes if b[1]], totals=totals)


@router.get("/export/{table}")
def export(
    table: Literal["time-sheet", "aggregated-work", "attendance"],
    fmt: Literal["xlsx", "csv"] = Query("xlsx", alias="format"),
    rng: tuple[date, date] = Depends(date_range),
    letter_date: str = Query("", max_length=30),
    letter_to: str = Query("", max_length=300),
    letter_body: str = Query("", max_length=1000),
    role: Role = "simple",
):
    """Download the time sheet, the aggregated sheet or the attendance sheet (of one `role`) for a date range as .xlsx
    or CSV (same rows as the screen). The aggregated .xlsx is laid out as a letter; its date, addressee and text are
    typed by the person (letter_*)."""
    if table == "attendance":
        return export_attendance(fmt, rng, role)
    fetch, title, columns = EXPORTS[table]
    rows = [(r["work_day"], *(get(r) for _, get in columns)) for r in fetch(rng)]
    letter = tuple(t.strip() for t in (letter_date, letter_to, letter_body)) if table == "aggregated-work" else None
    return export_file("shahran", table, fmt, rng, title, [h for h, _ in columns], rows, letter)


@router.post("/export/invoice")
async def export_invoice(request: Request):
    """Download the Kohsar shotcrete invoice (فاکتور شاتکریت کوهسار) as .xlsx. The page submits an ordinary form with one
    field, `data`, holding the invoice as JSON (see Invoice in invoice.py): a form post is not limited in size like a
    link is, and it downloads the same way the other export buttons do. Nothing is stored."""
    data = parse_qs((await request.body()).decode("utf-8", "replace")).get("data", [""])[0]
    try:
        invoice = Invoice.model_validate_json(data)
    except ValueError as e:  # pydantic's ValidationError
        raise HTTPException(422, str(e))
    return Response(invoice_xlsx(invoice), media_type=XLSX_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="shahran-invoice.xlsx"'})
