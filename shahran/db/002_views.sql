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

-- Monthly pay per worker: work days x the worker's fixed daily salary.
CREATE OR REPLACE VIEW shahran.monthly_salary AS
SELECT
    t.worker_id,
    w.full_name,
    j.jy AS solar_year,
    j.jm AS solar_month,
    count(*) FILTER (WHERE t.arrival_time IS NOT NULL AND t.exit_time IS NOT NULL)                       AS work_days,
    w.daily_salary,
    count(*) FILTER (WHERE t.arrival_time IS NOT NULL AND t.exit_time IS NOT NULL) * w.daily_salary      AS salary
FROM shahran.daily_time_sheet t
JOIN shahran.workers w USING (worker_id)
CROSS JOIN LATERAL shahran.solar_date(t.work_day) j
GROUP BY t.worker_id, w.full_name, w.daily_salary, j.jy, j.jm;