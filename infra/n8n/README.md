# n8n Orchestration (optional)

> Note: the dashboard's built-in Node backend (`apps/dashboard/server`) is now the default
> orchestrator for the `/api/*` endpoints. n8n is an optional alternative/self-hosted coordinator:
> it can receive the same payloads, coordinate AI analysis (CrewAI / LLM nodes), and write results
> to Supabase. To use it instead of the built-in backend, point the dashboard's API requests at
> these webhooks.

## Running

```bash
docker compose up -d
```

Open http://localhost:5678 and set up the owner account. Import the workflow JSONs from `workflows/`.

## Credentials to configure in n8n

- **OpenAI API** (AI Agent / LLM nodes)
- **Supabase** (query/insert results)
- **Serper.dev** (web search for the researcher)

## Webhook contract

The dashboard calls `{N8N_WEBHOOK_BASE}/<workflow-path>` with a JSON body and expects JSON back.
Configure `N8N_WEBHOOK_BASE` on the coordinator to e.g. `http://localhost:5678/webhook`.

### 1. `/simulate` — Financial Twin

Request:
```json
{
  "userId": "uuid",
  "ticker": "VOO",
  "assetClass": "stock",
  "capital": 10000,
  "riskTolerance": "moderate",
  "horizonYears": 10,
  "simulations": 10000
}
```

Response:
```json
{
  "simulationId": "uuid",
  "projection": {
    "medianEnd": 21000,
    "p10": 14500,
    "p90": 31000,
    "annualizedReturn": 0.077,
    "allocation": { "equities": 0.7, "bonds": 0.2, "cash": 0.1 },
    "notes": "AI-generated summary"
  }
}
```

### 2. `/analyze-listing` — Listing Optimizer

Request:
```json
{
  "userId": "uuid",
  "asin": "B0EXAMPLE",
  "currentTitle": "…",
  "currentBullets": ["…"]
}
```

Response:
```json
{
  "analysisId": "uuid",
  "suggestions": [
    { "id": "s1", "title": "Rewrite product title", "body": "…", "confidence": 0.85 }
  ]
}
```

### 3. `/trading-signal` — Trading Suite signal

Request:
```json
{
  "userId": "uuid",
  "asset": "BTC-USD",
  "horizon": "5m"
}
```

Response:
```json
{
  "signal": {
    "asset": "BTC-USD",
    "price": 61000.5,
    "direction": "up",
    "confidence": 0.62,
    "horizon": "5m"
  },
  "commentary": "AI-generated, decision-support only"
}
```

### 4. `/staking-monitor` — Staking / DeFi monitor

Request:
```json
{ "userId": "uuid" }
```

Response:
```json
{
  "count": 5,
  "opportunities": [{ "name": "…", "network": "…", "apy": 0.06, "risk": 3 }],
  "analysis": "AI-generated yield + risk summary"
}
```

### 5. `/depin-aggregator` — DePIN market aggregator

Request:
```json
{ "userId": "uuid" }
```

Response:
```json
{
  "count": 15,
  "projects": [{ "name": "…", "symbol": "…", "price": 1.2, "marketCap": 123, "change24h": 3.1 }],
  "overview": "AI-generated project overview"
}
```

### 6. `/generate-content` — Content Studio

Request:
```json
{
  "userId": "uuid",
  "kind": "youtube_script",
  "topic": "REIT investing in 2026"
}
```

Response:
```json
{
  "draftId": "uuid",
  "draft": {
    "headline": "…",
    "script": "…",
    "tags": ["…"],
    "cta": "…"
  }
}
```

## Workflow templates

Each `workflows/*.json` is an n8n export. Import via **Workflows → ⋮ → Import from File**. The templates use placeholder credential IDs — re-select credentials after import and point the Supabase nodes at your project.

Available templates:

- `picc-simulator.json` — Financial Twin Monte Carlo projection
- `picc-listing-optimizer.json` — Amazon listing suggestions
- `picc-content-studio.json` — Content Studio drafts
- `picc-trading-signal.json` — Trading Suite ensemble signal + AI commentary
- `picc-staking-monitor.json` — Staking/DeFi APY snapshot + AI yield analysis
- `picc-depin-aggregator.json` — DePIN market snapshot + AI overview

The `trading-signal` workflow reads the same ensemble logic (momentum + mean-reversion + linear regression, with honest backtest-style confidence) that the dashboard's built-in engine uses, so either path returns consistent signals.

## Notes

- Workflows are intentionally **decision-support only**: they end at "write to Supabase + return suggestions", never at an execution step.
- For production, enable n8n queue mode with Redis and restrict webhook access (n8n webhook auth or a reverse proxy).
