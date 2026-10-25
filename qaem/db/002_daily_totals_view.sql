-- qaem: daily total across all trucks, and month-to-date running total of day_total.
-- month_total restarts at the first day of each month.

CREATE OR REPLACE VIEW qaem.daily_totals AS
SELECT
    service_day,
    SUM(truck_service_count) AS day_total,
    SUM(SUM(truck_service_count)) OVER (
        PARTITION BY date_trunc('month', service_day)
        ORDER BY service_day
    ) AS month_total
FROM qaem.daily_truck_services
GROUP BY service_day;
