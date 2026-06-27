# Market Data API — Indian Mutual Funds + NAV History

[![CI](https://github.com/gupta-saransh/MarketDataAPI/actions/workflows/test.yml/badge.svg)](https://github.com/gupta-saransh/MarketDataAPI/actions/workflows/test.yml)
[![API](https://img.shields.io/badge/dynamic/json?url=https://market-data-api-psi.vercel.app/api/health&query=$.status&label=live%20API&color=brightgreen)](https://market-data-api-psi.vercel.app/api/health)
[![License](https://img.shields.io/badge/License-Apache_2.0-D22128?logo=apache&logoColor=white)](LICENSE)


> A free, public REST API for Indian mutual fund schemes and their NAV history, with a
> Swagger-style web explorer — plus an **MCP server** so AI agents can query the data too.
> ~14,583 schemes, multi-year NAV history. Fastify on CockroachDB, one codebase that runs
> unchanged on SQLite (dev) and Postgres (prod).

## Live

| | URL |
|---|---|
| **Explorer** | https://market-data-api-psi.vercel.app/ |
| **API base** | https://market-data-api-psi.vercel.app/api |
| **Health** | https://market-data-api-psi.vercel.app/api/health |
| **OpenAPI 3.1** | https://market-data-api-psi.vercel.app/api/openapi.json |
| **MCP endpoint** | https://market-data-api-psi.vercel.app/api/mcp |

## What you get

- **REST API** — search schemes, scheme/ISIN detail, NAV history + latest NAV.
- **Analytics** — trailing & rolling returns, risk (volatility / drawdown / Sharpe), SIP + XIRR.
- **Web explorer** — pick an endpoint, fill params, run, see the response (renders `/openapi.json`).
- **MCP server** — the same data as 11 tools for AI agents (see [MCP.md](MCP.md)).
- **Google Sheets functions** — `=MF_NAV(101762)` and friends (`frontend/public/excel-addin/google-sheets.js`).

## For AI agents (MCP)

Point any MCP client at `https://market-data-api-psi.vercel.app/api/mcp` (remote, stateless
Streamable HTTP — no install, no auth). With the Claude API connector:

```js
mcp_servers: [{ type: 'url', url: 'https://market-data-api-psi.vercel.app/api/mcp', name: 'market-data-api' }],
tools: [{ type: 'mcp_toolset', mcp_server_name: 'market-data-api' }],
```

Full tool list, design, and testing recipes: **[MCP.md](MCP.md)**.

## Run locally

```bash
# API (SQLite — leave DATABASE_URL unset)
cd api && cp .env.example .env && npm install
npm run seed -- --limit 50      # quick test seed
npm run dev                     # http://localhost:3001

# Explorer
cd frontend && cp .env.example .env && npm install
npm run dev                     # http://localhost:5173 (proxies /api → :3001)
```

## Tech

Node.js 22 ESM · Fastify v4 · CockroachDB Serverless (prod) / `node:sqlite` (dev) ·
React 18 + Vite 5 + TypeScript + Tailwind v3 · deployed on Vercel · `@modelcontextprotocol/sdk`.

## Docs

- **[CLAUDE.md](CLAUDE.md)** — full architecture & developer guide
- **[MCP.md](MCP.md)** — MCP server design, tools, testing
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — deployment / cutover checklist

## License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE). Copyright 2026 Saransh Gupta.
