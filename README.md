# Passive Income Command Center (PICC)

An AI-assisted **planning** platform for exploring and optimizing passive income streams. PICC combines a **sandbox emulator** (financial what-if simulations) with a **passive browser sensor** (a DOM-free MV3 extension that relays the live market feed from broker pages you already have open) and a **studio browser** with a built-in read-only metrics overlay — it never executes transactions on your behalf. Every AI suggestion is gated behind a mandatory human-review step.

## What's inside

| Directory | What it is | Stack |
| :-- | :-- | :-- |
| `apps/dashboard` | Web dashboard (auth, simulators, trading suite, agents, overlay settings) | React + TypeScript + Vite + Supabase |
| `apps/dashboard/extensions/picc-overlay` | Browser extension — passive sensor: relays broker feed frames to the local backend (DOM-free, no trading actions) | MV3 vanilla JS (no bundler, load unpacked) |
| `apps/extension-archived` | **Archived** (2026-09-03) — Plasmo skeleton, no trading features, superseded by picc-overlay; kept in-tree as a historical demo | Plasmo (unused) |
| `agents/picc_agents` | Multi-agent research / content / listing / trading / investment crews | CrewAI (Python) |
| `infra/supabase` | Database schema with Row Level Security | SQL |
| `infra/n8n` | Orchestration (docker-compose + workflow templates) | n8n |

## The Big features

1. **Financial Twin Emulator** — enter capital + risk tolerance, run Monte Carlo simulations over historical data, get a projection report. No trades, no money moved.
2. **Listing Optimizer** — read-only Amazon Seller analysis that suggests listing rewrites the user pastes in themselves.
3. **Content Studio** — AI-generated blog/YouTube/affiliate content with one-click copy, gated by a human-review toggle.
4. **Trading Suite** — price-prediction with **two live model brains** (see `docs/ARCHITECTURE.md`): the classic 8-model ensemble (momentum, mean-reversion, trend regression, Monte Carlo, ARIMA, Prophet-style seasonality, LSTM-lite, GARCH-lite) and the 9-model technical fusion. Every prediction and decision is tagged with the `engine` that produced it. Confidence rests on **embargoed walk-forward backtesting** (non-overlapping windows, per-model significance floors — no model moves ensemble weights on fewer than 12 independent windows) and predictions carry a **split-conformal 80/90% move band** when enough residuals exist. Paper-trading ledger + optional read-only ExpertOption balance/candles. Decision-support only — it never places real orders.

## Quick start

See [docs/SETUP.md](docs/SETUP.md) for full instructions. The short version:

```bash
# Dashboard (real data + billing backend included)
npm install
cp apps/dashboard/.env.example apps/dashboard/.env   # add Supabase + LLM + Serper + payment keys
npm run dev

# Browser extension (no build step — load unpacked)
# In Chrome/Edge: chrome://extensions → Developer mode → Load unpacked
# Select: apps/dashboard/extensions/picc-overlay/
```

## Architecture

The dashboard ships with a Node backend (`apps/dashboard/server`) that wires the real providers —
see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

```
User → Dashboard (React) ──same-origin /api/*──▶ Node backend
                                                  │  Yahoo Finance (real drift/vol, no key)
                                                  │  Hybrid cloud LLM (Gemini → Groq → Mistral →
                                                  │    Cerebras → OpenAI, auto failover, no card)
                                                  │  Serper (live news + search research)
                                                  │  Payments: PayPal | Touch 'n Go |
                                                  │    BTCPay | Stripe (no bank, no business)
                                                  │  (optional) CrewAI microservice
Browser Extension (MV3) ◀── suggestions + live data ──┘
External platforms (Amazon, YouTube, brokerages) — user clicks, PICC never does
```

The LLM is a **free hybrid**: add a key for any of Gemini, Groq, Mistral, or Cerebras (all have
card-free free tiers) and the backend uses them in a failover rotation — if one is rate-limited or
down, it moves to the next. Each provider degrades honestly: when a key is missing or a service is
unreachable, the app labels its output `local engine` instead of pretending it's real.
`/api/health` shows which providers are configured.

## Legal posture

PICC is deliberately built as a **decision-support tool**, not an automated decision-making system:

- Read-only data connections where possible
- A mandatory **5-second human-review timer + confirmation toggle** before any suggestion can be copied
- Full audit logging of every AI suggestion and user confirmation
- Never auto-executes trades, purchases, or publishing

See [docs/COMPLIANCE.md](docs/COMPLIANCE.md) for Malaysia PDPA (effective 30 April 2026) and AI Governance Bill considerations.

## Roadmap status

| Task | Status |
| :-- | :-- |
| Dashboard scaffold (auth, routing, dark theme) | ✅ |
| Financial Twin emulator (Monte Carlo) | ✅ |
| Listing Optimizer UI + overlay contract | ✅ |
| Content Studio UI + human-review gate | ✅ |
| Plasmo extension (overlay, timer, popup) | ⚠️ deprecated — superseded by the MV3 extension |
| CrewAI crew (research/analyst/content) | ✅ |
| CrewAI trading + investment (DeFi/staking/NFT) crews | ✅ |
| n8n workflow templates (simulator, listing, content, trading-signal, staking-monitor, depin-aggregator) | ✅ (optional orchestration) |
| Supabase schema + RLS (incl. trading_signals, defi_holdings, depin_holdings) | ✅ |
| v2 schema — income-classification model (financial_accounts, income_streams, nft_holdings, depin_nodes, agent_configs/earnings/bounties, predictions, human_review_logs) | ✅ |
| Trading Suite — multi-model signals, paper ledger, ExpertOption read-only bridge | ✅ |
| MV3 extension — passive sensor relay (broker frames → `/api/extension/ingest`) | ✅ |
| Stream catalog — bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels | ✅ |
| Income classification (Category A passive · B semi-passive · C active) + Interest/Dividend/Rental/Content catalog tabs | ✅ |
| Node backend (same-origin `/api/*`) | ✅ |
| Real Yahoo Finance data → Monte Carlo | ✅ |
| Hybrid cloud LLM (Gemini/Groq/Mistral/Cerebras failover, free) + Serper research | ✅ |
| Stripe billing (checkout, portal, webhook → profile sync) | ✅ (live when keys set) |
| PayPal checkout (server-side capture, individual account) | ✅ (live when keys set) |
| Manual e-wallet (Touch 'n Go) | ✅ (always available) |
| BTCPay Server (self-hosted, no KYC) | ✅ (live when keys set) |
| Vitest unit + integration tests (1,400+, 128 files) | ✅ |
| Automator — balance collector (Honeygain/Pawns/Traffmonetizer/Repocket) + health alerts + LLM assistant | ✅ |
| Pi Node (infra/pi-node) — one device, every bandwidth provider | ✅ |
| Amazon SP-API (read-only competitor data) | ✅ (live when keys set) |
| Production deployment (Docker · PM2 · systemd + reverse proxy) | ✅ |

## Known issues

- `apps/extension/` (Plasmo) is an **archived** deprecated skeleton with no trading features — the canonical
  extension is `apps/dashboard/extensions/picc-overlay/`.
- Secrets (ExpertOption token, broker logins, venue tokens, automator credentials) are stored encrypted at
  rest under `server/data/*.vault.json` with a key file outside the data dir (see
  `apps/dashboard/server/services/vault.mjs` and the F-02 entry in `docs/EXPLICIT_AUDIT_LEDGER.md`).
  Capture an EO session with `scripts/capture-eo-session.mjs` or the API.
