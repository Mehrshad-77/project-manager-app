-- shahran: schema, Solar-date helper and base tables. Safe to re-run.
-- Daily and monthly figures are computed in views (002), not stored.

CREATE SCHEMA IF NOT EXISTS shahran;

-- Gregorian date -> Solar (Jalali) year / month / day (33-year arithmetic rule).
CREATE OR REPLACE FUNCTION shahran.solar_date(d date, OUT jy int, OUT jm int, OUT jd int)
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    gy  int := extract(year  FROM d)::int;
    gm  int := extract(month FROM d)::int;
    gd  int := extract(day   FROM d)::int;
    cum int[] := ARRAY[0,31,59,90,120,151,181,212,243,273,304,334];
    gy2 int;
    n   int;
BEGIN
    gy2 := CASE WHEN gm > 2 THEN gy + 1 ELSE gy END;
    n   := 355666 + 365*gy + (gy2+3)/4 - (gy2+99)/100 + (gy2+399)/400 + gd + cum[gm];
    jy  := -1595 + 33*(n/12053);  n := n % 12053;
    jy  := jy + 4*(n/1461);       n := n % 1461;
    IF n > 365 THEN
        jy := jy + (n-1)/365;     n := (n-1) % 365;
    END IF;
    IF n < 186 THEN
        jm := 1 + n/31;           jd := 1 + n%31;
    ELSE
        jm := 7 + (n-186)/30;     jd := 1 + (n-186)%30;
    END IF;
END $$;

-- Workers. role: simple = کارگر ساده, builder = بنا.
CREATE TABLE IF NOT EXISTS shahran.workers (
    worker_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name    TEXT   NOT NULL UNIQUE CHECK (btrim(full_name) <> ''),
    role         TEXT   NOT NULL CHECK (role IN ('simple', 'builder')),
    daily_salary BIGINT NOT NULL CHECK (daily_salary >= 0)
);

-- کارکرد روزانه: one row per worker per day.
-- A day counts as worked only when both arrival_time and exit_time are filled.
CREATE TABLE IF NOT EXISTS shahran.daily_time_sheet (
    work_day     DATE    NOT NULL,
    worker_id    INTEGER NOT NULL REFERENCES shahran.workers (worker_id),
    arrival_time TIME,                                  -- ساعت ورود
    exit_time    TIME,                                  -- ساعت خروج
    overtime     NUMERIC(4,2) NOT NULL DEFAULT 0
                 CHECK (overtime BETWEEN 0 AND 24),     -- اضافه‌کاری, hours
    is_holiday   BOOLEAN NOT NULL DEFAULT false,        -- تعطیلات
    is_off_day   BOOLEAN NOT NULL DEFAULT false,        -- مرخصی
    explanation  TEXT,                                  -- توضیحات
    PRIMARY KEY (work_day, worker_id),
    CONSTRAINT both_times_or_none CHECK ((arrival_time IS NULL) = (exit_time IS NULL))
);

-- The explanation typed for a whole day on the aggregated sheet.
CREATE TABLE IF NOT EXISTS shahran.daily_notes (
    work_day    DATE PRIMARY KEY,
    explanation TEXT NOT NULL
);