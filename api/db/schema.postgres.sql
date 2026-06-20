-- ============================================================
-- MF Data API — Postgres / Supabase schema
-- NOTE: pg_trgm is pre-enabled on Supabase; on vanilla Postgres you need
--   superuser to run CREATE EXTENSION. Run this file as the project owner.
-- Run once against your Supabase database before migrating data:
--   psql "$DATABASE_URL" -f db/schema.postgres.sql
-- (or paste into the Supabase SQL editor)
--
-- Column types & date storage are kept identical in spirit to the
-- SQLite schema so the same portable queries work on both. nav_date and
-- last_synced_at are stored as TEXT ('YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS')
-- so lexical comparisons and the API response shape match SQLite exactly.
-- ============================================================

CREATE TABLE IF NOT EXISTS fund_houses (
    id    integer PRIMARY KEY,
    name  text    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS scheme_categories (
    id             integer PRIMARY KEY,
    name           text    NOT NULL UNIQUE,
    broad_category text    NOT NULL
);

CREATE TABLE IF NOT EXISTS schemes (
    scheme_code           integer PRIMARY KEY,
    scheme_name           text    NOT NULL,
    fund_house_id         integer REFERENCES fund_houses(id),
    scheme_category_id    integer REFERENCES scheme_categories(id),
    isin_growth           text,
    isin_div_reinvestment text,
    last_synced_at        text    DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS nav_history (
    scheme_code  integer NOT NULL REFERENCES schemes(scheme_code) ON DELETE CASCADE,
    nav_date     date    NOT NULL,
    nav          real    NOT NULL,
    PRIMARY KEY (scheme_code, nav_date)
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_nav_history_scheme_date ON nav_history (scheme_code, nav_date DESC);
CREATE INDEX IF NOT EXISTS idx_schemes_fund_house      ON schemes (fund_house_id);
CREATE INDEX IF NOT EXISTS idx_schemes_category        ON schemes (scheme_category_id);
-- B-tree for ORDER BY scheme_name; GIN trigram for LOWER(...) LIKE '%q%' searches
CREATE INDEX IF NOT EXISTS idx_schemes_name            ON schemes (scheme_name);
CREATE INDEX IF NOT EXISTS idx_schemes_name_trgm       ON schemes USING GIN (lower(scheme_name) gin_trgm_ops);
