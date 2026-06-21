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
  },
}
