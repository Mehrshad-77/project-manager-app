-- qaem: daily total across all trucks, and month-to-date running total of day_total.
-- month_total restarts at the first day of each SOLAR month.

CREATE OR REPLACE VIEW qaem.daily_totals AS
SELECT
    t.service_day,
    SUM(t.truck_service_count) AS day_total,
    SUM(SUM(t.truck_service_count)) OVER (
        PARTITION BY j.jy, j.jm
        ORDER BY t.service_day
    ) AS month_total
FROM qaem.daily_truck_services t
CROSS JOIN LATERAL qaem.solar_date(t.service_day) j
GROUP BY t.service_day, j.jy, j.jm;