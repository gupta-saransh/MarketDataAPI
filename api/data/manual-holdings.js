/**
 * manual-holdings.js -- hand-curated portfolio allocations.
 *
 * Some funds cannot be described by the upstream holdings feed. A fund-of-funds
 * or offshore feeder reports exactly one line ("JPM US Value I acc USD, 95.55%")
 * plus its cash float, which is technically true and completely useless: what an
 * investor actually owns is whatever the underlying fund owns. Records here fill
 * that in from the underlying fund's own factsheet.
 *
 * Load them with:  npm run holdings:manual        (from api/)
 *
 * Rows written from this file are PINNED -- lib/queries.js getHoldings() serves
 * them regardless of HOLDINGS_TTL_HOURS and never calls upstream for that
 * scheme again. Re-running the seeder is the only thing that replaces them, so
 * edit here and re-run when a new factsheet lands.
 *
 * Weights are the UNDERLYING fund's own, exactly as published, not rescaled by
 * the feeder's holding in it. Say so in `note` so nobody reads them as feeder
 * weights. Percentages that sum to 100.1 are the factsheet's own rounding; they
 * are left alone rather than quietly normalized.
 *
 * Shape:
 *   schemes   scheme_codes this portfolio applies to (every plan of the fund)
 *   as_of     portfolio date, YYYY-MM-DD -- surfaced as `as_of` in the response
 *   note      shown to API and UI callers; explain look-through here
 *   holdings  [name, sector, weightage] -- top N, weight-descending
 *   sectors   [sector, weightage] -- full breakdown
 *   asset_allocation  { equity, debt, cash, other }
 *   market_cap        optional { large, mid, small, others }
 *   concentration     optional; top5/top10/top3-sector are derived when omitted
 */

export default [
  {
    // Edelweiss US Value Equity Offshore Fund (Regular + Direct, both Growth).
    // The feeder holds JPM US Value I acc USD at ~95.6%; these are that fund's
    // holdings. Sector table sums to 100.1% in the source (rounding).
    schemes: [140273, 140274],
    as_of: '2026-07-31',
    note: 'Look-through portfolio. This fund invests in JPM US Value I acc USD; '
        + 'the weights below are that underlying fund\'s own holdings as of '
        + '31 Jul 2026, not rescaled to this feeder.',

    asset_allocation: { equity: 97.4, debt: 0, cash: 2.7, other: 0 },

    holdings: [
      ['Amazon.com',        'Consumer Discretionary', 6.4],
      ['Microsoft',         'Information Technology', 5.3],
      ['Apple',             'Information Technology', 3.9],
      ['Wells Fargo',       'Financials',             2.3],
      ['Bank of America',   'Financials',             2.3],
      ['Johnson & Johnson', 'Health Care',            2.1],
      ['Chevron',           'Energy',                 2.0],
      ['Morgan Stanley',    'Financials',             2.0],
      ['ConocoPhillips',    'Energy',                 1.9],
      ['Citigroup',         'Financials',             1.8],
    ],

    sectors: [
      ['Financials',             21.0],
      ['Information Technology', 17.1],
      ['Health Care',            13.5],
      ['Consumer Discretionary', 12.6],
      ['Industrials',            10.8],
      ['Energy',                  5.3],
      ['Utilities',               3.9],
      ['Materials',               3.5],
      ['Communication Services',  3.4],
      ['Consumer Staples',        3.2],
      ['Real Estate',             3.1],
      ['Cash',                    2.7],
    ],
  },

  {
    // Edelweiss US Technology Equity Fund of Fund (Direct + Regular, both Growth).
    // The feeder holds JPM US Technology I acc USD at ~95.4%; these are that
    // fund's holdings. Sector table sums to exactly 100.0% in the source.
    // Note the sector names are the underlying manager's own tech-specific
    // taxonomy (Semiconductors, Data-Comm/Tele-Comm), not the broad GICS
    // sectors the equity funds use -- kept verbatim rather than remapped.
    schemes: [148063, 148064],
    as_of: '2026-07-31',
    note: 'Look-through portfolio. This fund invests in JPM US Technology I acc USD; '
        + 'the weights below are that underlying fund\'s own holdings as of '
        + '31 Jul 2026, not rescaled to this feeder.',

    asset_allocation: { equity: 98.3, debt: 0, cash: 1.7, other: 0 },

    holdings: [
      ['Alphabet',                      'Internet',             4.7],
      ['Palo Alto Networks',            'Data-Comm/Tele-Comm',  4.1],
      ['Broadcom',                      'Semiconductors',       4.1],
      ['Take-Two Interactive Software', 'Software',             4.0],
      ['Nvidia',                        'Semiconductors',       3.8],
      ['Microsoft',                     'Software',             3.2],
      ['CrowdStrike',                   'Software',             3.1],
      ['Snowflake',                     'Software',             3.1],
      ['Intel',                         'Semiconductors',       2.8],
      ['Cloudflare',                    'Software',             2.8],
    ],

    sectors: [
      ['Software',            35.5],
      ['Semiconductors',      29.7],
      ['Data-Comm/Tele-Comm',  9.9],
      ['Internet',             8.8],
      ['Hardware',             7.3],
      ['IT Services',          3.8],
      ['Service Provider',     3.3],
      ['Cash',                 1.7],
    ],
  },
]
