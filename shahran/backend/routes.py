"""shahran API: workers, daily time sheet (attendance), aggregated daily counts and monthly pay."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from psycopg import sql
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db import db

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


@router.get("/time-sheet", response_model=list[SheetOut])
def list_time_sheet(rng: tuple[date, date] = Depends(date_range)):
    """Rows from `from` to `to` inclusive, with each worker's name."""
    return run(
        """SELECT t.*, w.full_name FROM shahran.daily_time_sheet t
           JOIN shahran.workers w USING (worker_id)
           WHERE t.work_day BETWEEN %s AND %s ORDER BY t.work_day, w.full_name""",
        rng,
    )


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


@router.get("/aggregated-work", response_model=list[DayOut])
def aggregated_work(rng: tuple[date, date] = Depends(date_range)):
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


# ---------- monthly pay ----------
class SalaryOut(BaseModel):
    worker_id: int
    full_name: str
    work_days: int
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