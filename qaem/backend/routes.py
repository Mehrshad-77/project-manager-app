"""qaem API: daily service counts per truck."""
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from app.db import db
from app.export import export_file

router = APIRouter(prefix="/api/qaem", tags=["qaem"])

INT_MAX = 2_147_483_647  # PostgreSQL INTEGER limit
MAX_RANGE_DAYS = 400
TruckId = Field(strict=True, gt=0, le=INT_MAX)
Count = Field(strict=True, ge=0, le=INT_MAX)
COLUMNS = "service_day, truck_id, truck_service_count"


def today() -> date:
    return datetime.now(ZoneInfo("Asia/Tehran")).date()


MIN_DAY = date(1921, 3, 21)  # Solar 1300-01-01, start of the range the calendar code is verified for


def check_not_future(d: date) -> date:
    if d > today():
        raise ValueError("service_day cannot be in the future")
    if d < MIN_DAY:
        raise ValueError(f"service_day cannot be before {MIN_DAY}")
    return d


class ServiceOut(BaseModel):
    service_day: date
    truck_id: int
    truck_service_count: int


class ServiceIn(BaseModel):
    service_day: date
    truck_id: int = TruckId
    truck_service_count: int = Count

    _no_future = field_validator("service_day")(check_not_future)


class CountIn(BaseModel):
    truck_service_count: int = Count


class ServicePatch(BaseModel):
    service_day: date | None = None
    truck_id: int | None = Field(default=None, strict=True, gt=0, le=INT_MAX)
    truck_service_count: int | None = Field(default=None, strict=True, ge=0, le=INT_MAX)

    @field_validator("service_day")
    @classmethod
    def _no_future(cls, v):
        return v if v is None else check_not_future(v)

    @model_validator(mode="after")
    def _at_least_one(self):
        if self.service_day is None and self.truck_id is None and self.truck_service_count is None:
            raise ValueError("send at least one field to change")
        return self


class DayTotal(BaseModel):
    service_day: date
    day_total: int
    month_total: int


def date_range(date_from: date = Query(alias="from"), date_to: date = Query(alias="to")):
    if date_to < date_from:
        raise HTTPException(422, "'to' must not be before 'from'")
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(422, f"range is limited to {MAX_RANGE_DAYS} days")
    return date_from, date_to


DayPath = Path(description="Gregorian date, YYYY-MM-DD")
TruckPath = Path(gt=0, le=INT_MAX)


@router.post("/services", status_code=201, response_model=ServiceOut)
def create_service(body: ServiceIn):
    """Add a row. Fails with 409 if that truck already has a row for that day."""
    with db() as conn:
        try:
            return conn.execute(
                f"INSERT INTO qaem.daily_truck_services ({COLUMNS}) VALUES (%s, %s, %s) RETURNING {COLUMNS}",
                (body.service_day, body.truck_id, body.truck_service_count),
            ).fetchone()
        except psycopg.errors.UniqueViolation:
            raise HTTPException(409, "a row for this truck and day already exists")


@router.put("/services/{service_day}/{truck_id}", response_model=ServiceOut)
def set_service(service_day: date = DayPath, truck_id: int = TruckPath, *, body: CountIn):
    """Set a truck's count for a day: creates the row, or replaces the existing count."""
    try:
        check_not_future(service_day)
    except ValueError as e:
        raise HTTPException(422, str(e))
    with db() as conn:
        return conn.execute(
            f"""INSERT INTO qaem.daily_truck_services ({COLUMNS}) VALUES (%s, %s, %s)
                ON CONFLICT (service_day, truck_id)
                DO UPDATE SET truck_service_count = EXCLUDED.truck_service_count
                RETURNING {COLUMNS}""",
            (service_day, truck_id, body.truck_service_count),
        ).fetchone()


@router.patch("/services/{service_day}/{truck_id}", response_model=ServiceOut)
def patch_service(service_day: date = DayPath, truck_id: int = TruckPath, *, body: ServicePatch):
    """Change only the fields sent. The row must already exist."""
    with db() as conn:
        try:
            row = conn.execute(
                f"""UPDATE qaem.daily_truck_services
                    SET service_day = COALESCE(%s::date, service_day),
                        truck_id = COALESCE(%s::integer, truck_id),
                        truck_service_count = COALESCE(%s::integer, truck_service_count)
                    WHERE service_day = %s AND truck_id = %s
                    RETURNING {COLUMNS}""",
                (body.service_day, body.truck_id, body.truck_service_count, service_day, truck_id),
            ).fetchone()
        except psycopg.errors.UniqueViolation:
            raise HTTPException(409, "a row for that truck and day already exists")
    if row is None:
        raise HTTPException(404, "row not found")
    return row


@router.delete("/services/{service_day}/{truck_id}", status_code=204)
def delete_service(service_day: date = DayPath, truck_id: int = TruckPath):
    with db() as conn:
        deleted = conn.execute(
            "DELETE FROM qaem.daily_truck_services WHERE service_day = %s AND truck_id = %s RETURNING 1",
            (service_day, truck_id),
        ).fetchone()
    if deleted is None:
        raise HTTPException(404, "row not found")
    return Response(status_code=204)


def fetch_services(rng):
    with db() as conn:
        return conn.execute(
            f"""SELECT {COLUMNS} FROM qaem.daily_truck_services
                WHERE service_day BETWEEN %s AND %s ORDER BY service_day, truck_id""",
            rng,
        ).fetchall()


def fetch_totals(rng):
    with db() as conn:
        return conn.execute(
            """SELECT service_day, day_total, month_total FROM qaem.daily_totals
               WHERE service_day BETWEEN %s AND %s ORDER BY service_day""",
            rng,
        ).fetchall()


@router.get("/services", response_model=list[ServiceOut])
def list_services(rng: tuple[date, date] = Depends(date_range)):
    """Rows from `from` to `to` inclusive (use the same date twice for one day)."""
    return fetch_services(rng)


@router.get("/totals", response_model=list[DayTotal])
def totals(rng: tuple[date, date] = Depends(date_range)):
    """day_total = all trucks that day. month_total = running sum within that day's SOLAR month
    (computed by the qaem.daily_totals view, so it is correct even if the range cuts a month)."""
    return fetch_totals(rng)


# ---------- export (Excel .xlsx or CSV) ----------
# table -> (fetch function, Farsi table name, Farsi column headers, the two numeric columns)
EXPORTS = {
    "services": (fetch_services, "سرویس‌های ثبت‌شده", ("شماره کامیون", "تعداد سرویس"), ("truck_id", "truck_service_count")),
    "totals": (fetch_totals, "مجموع سرویس‌ها", ("تعداد سرویس", "مجموع سرویس‌های ماه"), ("day_total", "month_total")),
}


@router.get("/export/{table}")
def export(
    table: Literal["services", "totals"],
    fmt: Literal["xlsx", "csv"] = Query("xlsx", alias="format"),
    rng: tuple[date, date] = Depends(date_range),
):
    """Download one table for a date range as an Excel workbook (.xlsx) or a CSV file that Excel opens."""
    fetch, title, headers, keys = EXPORTS[table]
    rows = [(r["service_day"], *(int(r[k]) for k in keys)) for r in fetch(rng)]
    return export_file("qaem", table, fmt, rng, title, headers, rows)