# Passive Income Command Center (PICC)

An AI-assisted **planning** platform for exploring and optimizing passive income streams. PICC combines a **sandbox emulator** (financial what-if simulations) with a **browser overlay** (contextual AI suggestions on the platforms you already use) — it never executes transactions on your behalf. Every AI suggestion is gated behind a mandatory human-review step.

## What's inside

| Directory | What it is | Stack |
| :-- | :-- | :-- |
| `apps/dashboard` | Web dashboard (auth, simulators, trading suite, agents, overlay settings) | React + TypeScript + Vite + Supabase |
| `apps/dashboard/extensions/picc-overlay` | Browser extension — trading dockables, AI signals, autopilot overlay, live data feed | MV3 vanilla JS (no bundler, load unpacked) |
| `apps/extension` | **Deprecated** — Plasmo skeleton, no trading features, superseded by picc-overlay | Plasmo (unused) |
| `agents/picc_agents` | Multi-agent research / content / listing / trading / investment crews | CrewAI (Python) |
| `infra/supabase` | Database schema with Row Level Security | SQL |
| `infra/n8n` | Orchestration (docker-compose + workflow templates) | n8n |

## The Big features

1. **Financial Twin Emulator** — enter capital + risk tolerance, run Monte Carlo simulations over historical data, get a projection report. No trades, no money moved.
2. **Listing Optimizer** — read-only Amazon Seller analysis that suggests listing rewrites the user pastes in themselves.
3. **Content Studio** — AI-generated blog/YouTube/affiliate content with one-click copy, gated by a human-review toggle.
4. **Trading Suite** — multi-model price prediction engine (momentum + mean-reversion + regression + Monte Carlo with honest backtest-damped confidence), paper-trading ledger, and optional read-only ExpertOption balance/candles. Decision-support only — it never places real orders.

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
| Plasmo extension (overlay, timer, popup) | ✅ |
| CrewAI crew (research/analyst/content) | ✅ |
| CrewAI trading + investment (DeFi/staking/NFT) crews | ✅ |
| n8n workflow templates (simulator, listing, content, trading-signal, staking-monitor, depin-aggregator) | ✅ (optional orchestration) |
| Supabase schema + RLS (incl. trading_signals, defi_holdings, depin_holdings) | ✅ |
| v2 schema — income-classification model (financial_accounts, income_streams, nft_holdings, depin_nodes, agent_configs/earnings/bounties, predictions, human_review_logs) | ✅ |
| Trading Suite — multi-model signals, paper ledger, ExpertOption read-only bridge | ✅ |
| MV3 extension — trading dockables, AI signals, autopilot, live data, shadow DOM | ✅ |
| Stream catalog — bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels | ✅ |
| Income classification (Category A passive · B semi-passive · C active) + Interest/Dividend/Rental/Content catalog tabs | ✅ |
| Node backend (same-origin `/api/*`) | ✅ |
| Real Yahoo Finance data → Monte Carlo | ✅ |
| Hybrid cloud LLM (Gemini/Groq/Mistral/Cerebras failover, free) + Serper research | ✅ |
| Stripe billing (checkout, portal, webhook → profile sync) | ✅ (live when keys set) |
| PayPal checkout (server-side capture, individual account) | ✅ (live when keys set) |
| Manual e-wallet (Touch 'n Go) | ✅ (always available) |
| BTCPay Server (self-hosted, no KYC) | ✅ (live when keys set) |
| Vitest unit + integration tests | ✅ |
| Automator — balance collector (Honeygain/Pawns/Traffmonetizer/Repocket) + health alerts + LLM assistant | ✅ |
| Pi Node (infra/pi-node) — one device, every bandwidth provider | ✅ |
| Amazon SP-API (read-only competitor data) | ✅ (live when keys set) |
| Production deployment (Docker · PM2 · systemd + reverse proxy) | ✅ |

## Known issues

- `apps/extension/` (Plasmo) is a deprecated skeleton with no trading features — use
  `apps/dashboard/extensions/picc-overlay/` instead.
- ExpertOption session token is stored in `server/data/trading-credentials.json` (runtime),
  not via environment variables. Use `scripts/capture-eo-session.mjs` or the API to capture it.
