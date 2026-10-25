-- qaem: schema and base table
-- One row per truck per day; daily and monthly totals are computed in a view (002), not stored.

CREATE SCHEMA IF NOT EXISTS qaem;

CREATE TABLE IF NOT EXISTS qaem.daily_truck_services (
    service_day         DATE    NOT NULL,
    truck_id            INTEGER NOT NULL,
    truck_service_count INTEGER NOT NULL CHECK (truck_service_count >= 0),
    PRIMARY KEY (service_day, truck_id)
);
