/**
 * openapi.js — Hand-maintained OpenAPI 3.1 description of the public API.
 *
 * Served at GET /openapi.json. The frontend explorer renders this directly,
 * so the docs never drift from the real routes — edit here when routes change.
 */

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Market Data API',
    version: '1.0.0',
    description:
      'Free, public REST API for Indian mutual fund schemes and their NAV history. '
      + 'NAV data is sourced daily from AMFI (Association of Mutual Funds in India). '
      + 'No authentication required.',
  },
  // Relative server — the explorer resolves paths against its configured API base.
  servers: [{ url: '/', description: 'This API' }],
  tags: [
    { name: 'Meta',        description: 'Health & service metadata' },
    { name: 'Fund Houses', description: 'Asset management companies' },
    { name: 'Categories',  description: 'Scheme categories' },
    { name: 'Schemes',     description: 'Mutual fund schemes and NAV history' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Meta'],
        summary: 'Health check',
        description: 'Returns service status and the active database driver.',
        responses: {
          200: {
            description: 'Service is up',
            content: {
              'application/json': {
                example: { status: 'ok', driver: 'postgres' },
              },
            },
          },
        },
      },
    },

    '/fund-houses': {
      get: {
        tags: ['Fund Houses'],
        summary: 'List all fund houses',
        description: 'Returns every fund house (AMC), ordered by name. Use fund_house_id to filter /schemes.',
        responses: {
          200: {
            description: 'List of fund houses',
            content: {
              'application/json': {
                example: { data: [{ fund_house_id: 9, name: 'HDFC Mutual Fund' }] },
              },
            },
          },
        },
      },
    },

    '/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List all scheme categories',
        description: 'Returns every scheme category with its broad category grouping. Use id to filter /schemes.',
        responses: {
          200: {
            description: 'List of categories',
            content: {
              'application/json': {
                example: {
                  data: [
                    { id: 43, name: 'Equity Scheme - Flexi Cap Fund', broad_category: 'Equity Scheme' },
                  ],
                },
              },
            },
          },
        },
      },
    },

    '/schemes': {
      get: {
        tags: ['Schemes'],
        summary: 'Search & filter schemes',
        description:
          'Paginated list of schemes. All filters are optional and combinable. Use q to search by name.',
        parameters: [
          { name: 'q',              in: 'query', description: 'Case-insensitive substring match on scheme name', schema: { type: 'string' } },
          { name: 'fund_house_id',  in: 'query', description: 'Filter by fund house id (from /fund-houses)',     schema: { type: 'integer' } },
          { name: 'category_id',    in: 'query', description: 'Filter by category id (from /categories)',        schema: { type: 'integer' } },
          { name: 'broad_category', in: 'query', description: 'Filter by broad category (e.g. "Equity Scheme")', schema: { type: 'string' } },
          { name: 'page',           in: 'query', description: 'Page number (1-based)',                           schema: { type: 'integer', default: 1 } },
          { name: 'limit',          in: 'query', description: 'Results per page',                                schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: {
            description: 'Paginated scheme list',
            content: {
              'application/json': {
                example: {
                  total: 1,
                  page: 1,
                  limit: 20,
                  data: [{
                    scheme_code: 101762,
                    scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                    fund_house: 'HDFC Mutual Fund',
                    category: 'Equity Scheme - Flexi Cap Fund',
                    broad_category: 'Equity Scheme',
                  }],
                },
              },
            },
          },
        },
      },
    },

    '/schemes/{code}': {
      get: {
        tags: ['Schemes'],
        summary: 'Get scheme details',
        description: 'Full metadata for a single scheme by its scheme code, including latest NAV.',
        parameters: [
          { name: 'code', in: 'path', required: true, description: 'Scheme code', schema: { type: 'integer' }, example: 101762 },
        ],
        responses: {
          200: {
            description: 'Scheme details',
            content: {
              'application/json': {
                example: {
                  data: {
                    scheme_code: 101762,
                    scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                    isin_growth: 'INF179K01608',
                    isin_div_reinvestment: null,
                    last_synced_at: '2026-06-21 08:53:08',
                    fund_house: 'HDFC Mutual Fund',
                    category: 'Equity Scheme - Flexi Cap Fund',
                    broad_category: 'Equity Scheme',
                    nav: 2000.152,
                    nav_date: '2026-06-20',
                  },
                },
              },
            },
          },
          404: { description: 'Scheme not found', content: { 'application/json': { example: { error: 'Scheme not found' } } } },
        },
      },
    },

    '/schemes/isin/{isin}': {
      get: {
        tags: ['Schemes'],
        summary: 'Get scheme by ISIN',
        description: 'Look up a scheme by its ISIN (growth or dividend reinvestment). Returns the same fields as /schemes/{code}.',
        parameters: [
          { name: 'isin', in: 'path', required: true, description: 'ISIN code', schema: { type: 'string' }, example: 'INF179K01608' },
        ],
        responses: {
          200: {
            description: 'Scheme details',
            content: {
              'application/json': {
                example: {
                  data: {
                    scheme_code: 101762,
                    scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                    isin_growth: 'INF179K01608',
                    isin_div_reinvestment: null,
                    last_synced_at: '2026-06-21 08:53:08',
                    fund_house: 'HDFC Mutual Fund',
                    category: 'Equity Scheme - Flexi Cap Fund',
                    broad_category: 'Equity Scheme',
                    nav: 2000.152,
                    nav_date: '2026-06-20',
                  },
                },
              },
            },
          },
          404: { description: 'Scheme not found', content: { 'application/json': { example: { error: 'Scheme not found' } } } },
        },
      },
    },

    '/schemes/{code}/nav': {
      get: {
        tags: ['Schemes'],
        summary: 'Get NAV history',
        description: 'NAV history for a scheme, newest first. Optionally bounded by a date range.',
        parameters: [
          { name: 'code',      in: 'path',  required: true, description: 'Scheme code',                        schema: { type: 'integer' }, example: 101762 },
          { name: 'startDate', in: 'query', description: 'Inclusive lower bound (YYYY-MM-DD)',                 schema: { type: 'string', format: 'date' } },
          { name: 'endDate',   in: 'query', description: 'Inclusive upper bound (YYYY-MM-DD)',                 schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          200: {
            description: 'NAV history (newest first)',
            content: {
              'application/json': {
                example: {
                  scheme_code: 101762,
                  scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                  data: [
                    { nav_date: '2026-06-20', nav: 2000.152 },
                    { nav_date: '2026-06-19', nav: 2001.569 },
                  ],
                },
              },
            },
          },
          404: { description: 'No NAV data found', content: { 'application/json': { example: { error: 'No NAV data found' } } } },
        },
      },
    },

    '/schemes/{code}/nav/latest': {
      get: {
        tags: ['Schemes'],
        summary: 'Get latest NAV',
        description: 'The most recent NAV entry for a scheme.',
        parameters: [
          { name: 'code', in: 'path', required: true, description: 'Scheme code', schema: { type: 'integer' }, example: 101762 },
        ],
        responses: {
          200: {
            description: 'Latest NAV',
            content: {
              'application/json': {
                example: { scheme_code: 101762, scheme_name: 'HDFC Flexi Cap Fund - Growth Plan', nav_date: '2026-06-20', nav: 2000.152 },
              },
            },
          },
          404: { description: 'No NAV data found', content: { 'application/json': { example: { error: 'No NAV data found' } } } },
        },
      },
    },

    '/schemes/{code}/returns': {
      get: {
        tags: ['Schemes'],
        summary: 'Trailing & inception returns',
        description:
          'Point-to-point returns for standard windows (1M/3M/6M/1Y/3Y/5Y) plus since-inception. '
          + 'Absolute for periods up to 1 year, annualized (CAGR) beyond. Periods longer than the '
          + 'available history return null.',
        parameters: [
          { name: 'code', in: 'path', required: true, description: 'Scheme code', schema: { type: 'integer' }, example: 101762 },
        ],
        responses: {
          200: {
            description: 'Returns breakdown',
            content: {
              'application/json': {
                example: {
                  scheme_code: 101762,
                  scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                  as_of: '2026-06-19',
                  latest_nav: 2000.152,
                  returns: {
                    '1M': { return_pct: 3.34, annualized: false, from_date: '2026-05-19', from_nav: 1935.559 },
                    '1Y': { return_pct: 2.56, annualized: false, from_date: '2025-06-19', from_nav: 1950.16 },
                    '3Y': null,
                    inception: { return_pct: 5.89, annualized: true, from_date: '2024-06-20', from_nav: 1784.1 },
                  },
                },
              },
            },
          },
          404: { description: 'No NAV data found', content: { 'application/json': { example: { error: 'No NAV data found' } } } },
        },
      },
    },

    '/schemes/{code}/rolling': {
      get: {
        tags: ['Schemes'],
        summary: 'Rolling returns distribution',
        description:
          'Return over a rolling window stepped daily across all history, summarized as '
          + 'avg/min/max/median and the % of windows that beat a threshold. Annualized (CAGR) for '
          + 'windows of 1 year or more.',
        parameters: [
          { name: 'code',   in: 'path',  required: true, description: 'Scheme code', schema: { type: 'integer' }, example: 101762 },
          { name: 'window', in: 'query', description: 'Window size, e.g. 6M, 1Y, 3Y, 5Y', schema: { type: 'string', default: '3Y' } },
          { name: 'beat',   in: 'query', description: 'Threshold % for the pct_beating stat', schema: { type: 'number', default: 12 } },
        ],
        responses: {
          200: {
            description: 'Rolling-return summary',
            content: {
              'application/json': {
                example: {
                  scheme_code: 101762,
                  scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                  window: '1Y',
                  observations: 248,
                  annualized: false,
                  avg: 7.63, min: -2.51, max: 18.77, median: 7.86,
                  beat_pct: 12,
                  pct_beating: 20.16,
                  best:  { from: '2025-02-28', to: '2026-02-27', return_pct: 18.77 },
                  worst: { from: '2025-06-11', to: '2026-06-11', return_pct: -2.51 },
                },
              },
            },
          },
          400: { description: 'Invalid window', content: { 'application/json': { example: { error: 'Invalid window — use e.g. 1Y, 3Y, 6M' } } } },
          404: { description: 'Insufficient history for this window', content: { 'application/json': { example: { error: 'Insufficient history for this window' } } } },
        },
      },
    },

    '/schemes/{code}/risk': {
      get: {
        tags: ['Schemes'],
        summary: 'Risk metrics',
        description:
          'Annualized volatility (daily-return std × √252), max drawdown (worst peak-to-trough), '
          + 'CAGR and the Sharpe ratio, computed over the full NAV history.',
        parameters: [
          { name: 'code', in: 'path',  required: true, description: 'Scheme code', schema: { type: 'integer' }, example: 101762 },
          { name: 'rf',   in: 'query', description: 'Risk-free rate % for Sharpe', schema: { type: 'number', default: 6 } },
        ],
        responses: {
          200: {
            description: 'Risk metrics',
            content: {
              'application/json': {
                example: {
                  scheme_code: 101762,
                  scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                  annualized_volatility_pct: 11.99,
                  max_drawdown_pct: 13.45,
                  cagr_pct: 5.89,
                  sharpe: -0.01,
                  risk_free_pct: 6,
                  observations: 493,
                  from_date: '2024-06-20',
                  to_date: '2026-06-19',
                },
              },
            },
          },
          404: { description: 'Insufficient NAV history', content: { 'application/json': { example: { error: 'Insufficient NAV history' } } } },
        },
      },
    },

    '/schemes/{code}/sip': {
      get: {
        tags: ['Schemes'],
        summary: 'SIP simulation & XIRR',
        description:
          'Simulates a monthly SIP — investing a fixed amount on the same day each month — buying '
          + 'units at the nearest trading-day NAV. Returns total invested, current value, absolute '
          + 'return and XIRR (annualized money-weighted return).',
        parameters: [
          { name: 'code',   in: 'path',  required: true, description: 'Scheme code', schema: { type: 'integer' }, example: 101762 },
          { name: 'amount', in: 'query', description: 'Monthly investment (₹)', schema: { type: 'number', default: 5000 } },
          { name: 'from',   in: 'query', description: 'Start date (YYYY-MM-DD); defaults to inception', schema: { type: 'string', format: 'date' } },
          { name: 'to',     in: 'query', description: 'End date (YYYY-MM-DD); defaults to latest', schema: { type: 'string', format: 'date' } },
          { name: 'day',    in: 'query', description: 'Day of month to invest (1–28)', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          200: {
            description: 'SIP result',
            content: {
              'application/json': {
                example: {
                  scheme_code: 101762,
                  scheme_name: 'HDFC Flexi Cap Fund - Growth Plan',
                  frequency: 'monthly',
                  sip: {
                    amount: 5000, day: 1, from: '2024-06-20', to: '2026-06-19',
                    installments: 24,
                    total_invested: 120000,
                    units: 62.212,
                    current_value: 124433.52,
                    absolute_return_pct: 3.69,
                    xirr_pct: 3.64,
                  },
                },
              },
            },
          },
          400: { description: 'No installments in range', content: { 'application/json': { example: { error: 'No SIP installments fall within the available data range' } } } },
          404: { description: 'No NAV data found', content: { 'application/json': { example: { error: 'No NAV data found' } } } },
        },
      },
    },
  },
}
