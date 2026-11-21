-- shahran: aggregated daily sheet and monthly pay. Safe to re-run (recreates the views).
-- Months are Solar months, worked out by shahran.solar_date from 001.

-- کارکرد تجمیعی ماهانه: one row per day that has a time sheet row or an explanation.
CREATE OR REPLACE VIEW shahran.aggregated_work AS
WITH days AS (
    SELECT work_day FROM shahran.daily_time_sheet
    UNION
    SELECT work_day FROM shahran.daily_notes
)
SELECT
    d.work_day,
    j.jy AS solar_year,
    j.jm AS solar_month,
    count(*) FILTER (WHERE t.arrival_time IS NOT NULL AND t.exit_time IS NOT NULL)                        AS total_workers,
    count(*) FILTER (WHERE t.arrival_time IS NOT NULL AND t.exit_time IS NOT NULL AND w.role = 'simple')  AS simple_workers,
    count(*) FILTER (WHERE t.arrival_time IS NOT NULL AND t.exit_time IS NOT NULL AND w.role = 'builder') AS builders,
    n.explanation
FROM days d
CROSS JOIN LATERAL shahran.solar_date(d.work_day) j
LEFT JOIN shahran.daily_time_sheet t ON t.work_day = d.work_day
LEFT JOIN shahran.workers w          ON w.worker_id = t.worker_id
LEFT JOIN shahran.daily_notes n      ON n.work_day = d.work_day
GROUP BY d.work_day, j.jy, j.jm, n.explanation;

-- Half-day units worked by one time sheet row: 2 = full day, 1 = half day (08:00-12:00), 0 = not worked.
-- The ONLY place that defines a half day; change the two times here if the rule changes.
CREATE OR REPLACE FUNCTION shahran.half_days(a time, e time) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN a IS NULL OR e IS NULL THEN 0
                WHEN a = '08:00' AND e = '12:00' THEN 1
                ELSE 2 END
$$;

-- Monthly pay per worker: work days (a half day counts 0.5) x the worker's fixed daily salary.
-- Dropped first because work_days is now a decimal and CREATE OR REPLACE VIEW cannot change a column's type.
DROP VIEW IF EXISTS shahran.monthly_salary;
CREATE VIEW shahran.monthly_salary AS
SELECT
    t.worker_id,
    w.full_name,
    j.jy AS solar_year,
    j.jm AS solar_month,
    sum(shahran.half_days(t.arrival_time, t.exit_time)) * 0.5                                   AS work_days,
    w.daily_salary,
    round(sum(shahran.half_days(t.arrival_time, t.exit_time)) * w.daily_salary * 0.5)::bigint   AS salary
FROM shahran.daily_time_sheet t
JOIN shahran.workers w USING (worker_id)
CROSS JOIN LATERAL shahran.solar_date(t.work_day) j
GROUP BY t.worker_id, w.full_name, w.daily_salary, j.jy, j.jm;