-- ============================================================
-- MF Data API — SQLite Schema
-- Applied automatically by seed.js on first run
-- ============================================================

CREATE TABLE IF NOT EXISTS fund_houses (
    id    INTEGER  PRIMARY KEY,
    name  TEXT     NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS scheme_categories (
    id             INTEGER  PRIMARY KEY,
    name           TEXT     NOT NULL UNIQUE,
    broad_category TEXT     NOT NULL
);

CREATE TABLE IF NOT EXISTS schemes (
    scheme_code           INTEGER  PRIMARY KEY,
    scheme_name           TEXT     NOT NULL,
    fund_house_id         INTEGER  REFERENCES fund_houses(id),
    scheme_category_id    INTEGER  REFERENCES scheme_categories(id),
    isin_growth           TEXT,
    isin_div_reinvestment TEXT,
    last_synced_at        TEXT     DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nav_history (
    scheme_code  INTEGER  NOT NULL REFERENCES schemes(scheme_code) ON DELETE CASCADE,
    nav_date     TEXT     NOT NULL,   -- stored as YYYY-MM-DD
    nav          REAL     NOT NULL,
    PRIMARY KEY (scheme_code, nav_date)
);

CREATE INDEX IF NOT EXISTS idx_nav_history_scheme_date ON nav_history (scheme_code, nav_date DESC);
CREATE INDEX IF NOT EXISTS idx_schemes_fund_house      ON schemes (fund_house_id);
CREATE INDEX IF NOT EXISTS idx_schemes_category        ON schemes (scheme_category_id);
CREATE INDEX IF NOT EXISTS idx_schemes_name            ON schemes (scheme_name);
