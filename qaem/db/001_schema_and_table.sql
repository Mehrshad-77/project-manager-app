-- qaem: schema and base table
-- One row per truck per day; daily and monthly totals are computed in a view (002), not stored.

CREATE SCHEMA IF NOT EXISTS qaem;

-- Gregorian date -> Solar (Jalali) year / month / day (33-year arithmetic rule).
CREATE OR REPLACE FUNCTION qaem.solar_date(d date, OUT jy int, OUT jm int, OUT jd int)
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

CREATE TABLE IF NOT EXISTS qaem.daily_truck_services (
    service_day         DATE    NOT NULL,
    truck_id            INTEGER NOT NULL,
    truck_service_count INTEGER NOT NULL CHECK (truck_service_count >= 0),
    PRIMARY KEY (service_day, truck_id)
);
