# Personal Income Command Centre (PICC)

An AI-assisted **planning** platform for exploring and optimizing passive income streams. PICC
combines a **sandbox emulator** (financial what-if simulations), a **studio browser** (real
Chrome/Edge over CDP — a read-only metrics overlay plus the passive headless capture leg that
replaced the old browser extension), an **income connector layer**
(bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels), and a **trading decision
suite** with honest, calibrated, advisory-only signals.

**By default, PICC never executes transactions on your behalf.** Every AI suggestion is gated behind
a mandatory human-review step, and paper trading is the everyday order path. One venue-capable
rail is retained for the sanctioned `trading:ccxt` case: it runs only on the acting human's fresh
per-action click, through a hard-capped consent gate — see [`PICC.md`](PICC.md) §0 guardrail 1.

> **Single source of truth:** [`PICC.md`](PICC.md) is the cumulative, exhaustive master document —
> architecture, service inventory, audit ledger, specs registry, research corpus, compliance,
> validation runbook, and open work. This README is the short entry point; when code and docs
> disagree, **code is truth**.

## What's inside

| Directory | What it is | Stack |
| :-- | :-- | :-- |
| `apps/dashboard` | Web dashboard (auth, simulators, trading suite, finance tracker, income connectors, capture settings) | React + TypeScript + Vite (local JSON data store) |
| `apps/extension-archived` | **Archived** — Plasmo skeleton, no trading features. Nothing superseded it: the extension era was removed end-to-end (D1) | Plasmo (unused, historical) |
| `agents/picc_agents` | Multi-agent research / content / listing / trading / investment crews | CrewAI (Python) |
| `infra/supabase` | **Orphaned** Row Level Security schema (v1 + v2 income-classification model), kept as documentation — no client in the tree, persistence is local JSON | SQL |
| `infra/n8n` | Optional orchestration (docker-compose + workflow templates) | n8n |
| `infra/pi-node` | One-device bandwidth-provider setup | — |

## The big features

1. **Financial Twin Emulator** — capital + risk tolerance → Monte Carlo over real Yahoo Finance
   history → projection report. No trades, no money moved.
2. **Listing Optimizer** — read-only Amazon Seller/SP-API analysis that suggests listing rewrites
   the user pastes in themselves.
3. **Content Studio** — AI-generated blog/YouTube/affiliate content with one-click copy, gated by
   a human-review toggle.
4. **Trading Suite (advisory-only)** — a 7-model technical fusion + statistical ensemble with
   **embargoed walk-forward backtesting** (no model moves weights on fewer than 12 independent
   windows), **split-conformal 80/90% move bands**, calibrated confidence, a paper-trading ledger
   with Kelly sizing, multi-timeframe confluence, U4FA confluence, and an optional read-only
   ExpertOption demo bridge (balance/candles only). Every prediction is tagged with the `engine`
   that produced it.
5. **Income connectors** — bandwidth providers (Honeygain and the CashPilot aggregator) with
   normalized balance snapshots and honest per-provider source labels. The wider six-provider
   bandwidth suite, the `automator` service and its LLM health assist were rejected and removed
   end-to-end (ADR-0002).
6. **Finance Tracker & Holdings** — server-backed accounts/transactions CRUD, computed net worth
   (assets − liabilities), and `nft_holdings`/`depin_nodes` holdings editor.
7. **Studio browser + headless capture** — real Chrome/Edge over CDP with a read-only metrics
   overlay and a per-source headless session engine (login once, then read-only candles/balances).
   There is no browser extension; that era was removed end-to-end (D1).

## Quick start

Full instructions: [`PICC.md`](PICC.md) §18 (setup & deployment), §8.7 (trading runbook).

```bash
npm install
cp apps/dashboard/.env.example apps/dashboard/.env   # add LLM + Serper + payment keys (no database keys)
npm run dev                                          # dev on http://localhost:5173
```

## Architecture

```
User → Dashboard (React) ──same-origin /api/*──▶ Node backend (93 service modules)
                                                  │  Yahoo Finance + CoinGecko (no key)
                                                  │  Hybrid cloud LLM (Gemini → Groq → Mistral →
                                                  │    Cerebras → OpenAI, auto failover, no card)
                                                  │  Serper (live news + search research)
                                                  │  Payments: Touch 'n Go |
                                                  │    BTCPay | Stripe (owner's wallet, no bank)
                                                  │  (optional) CrewAI microservice :8000
Studio browser (real Chrome/Edge over CDP) ◀── read-only capture + metrics ──┘
External platforms (brokers, Amazon, YouTube…) — the user places; PICC's only
  order-capable path is the consent-gated trading:ccxt rail
```

The LLM is a **free hybrid**: add a key for any of Gemini, Groq, Mistral, or Cerebras (all have
card-free free tiers) and the backend fails over between configured providers. When no key is
present or every provider is down, output is labelled `local engine` — never presented as real.
`/api/health` shows exactly which providers are configured.

## Legal posture & honesty

PICC is deliberately a **decision-support tool**, not an automated decision-making system:

- Read-only data connections wherever possible; paper trading is the everyday order path, and the
  one venue-capable rail runs only on fresh per-action human consent.
- Mandatory **5-second human-review timer + confirmation toggle** before any suggestion is
  applied/copied.
- Full audit logging of every AI suggestion and user confirmation.
- Honesty contract: absent → `null`, never fabricated `0`; unconfigured ≠ zero-filled; live labels
  mean observed-live; significance floors before confidence claims.
- Sealed secrets: credential stores encrypted at rest (AES-256-GCM vault); no `VITE_`-prefixed
  secret ever reaches the browser.

Malaysia PDPA 2010 (amendments relevant 30 April 2026 + ADMP guidelines) and AI Governance Bill
considerations are tracked in `PICC.md` §15 — verify with a qualified lawyer before any launch.

## Test & verification status

- **1,622 tests across 161 files green** + clean `tsc -b --noEmit` (verified 2026-09-05;
  `apps/dashboard`). The suite floor never shrinks.
- CI runs a gitleaks secret scan first, then tests; `npm audit` is part of `test:ci`.
- Every auth/payment/vault/broker/ledger diff gets a security-review pass before landing.

## Known issues

- Realtime charts animate while the EO live feed or a live CCXT feed is connected; candles resolve
  by a quality order (liveness > resolution-exactness > freshness > weight > latency) with the
  winner and why named in every response (`PICC.md` §20.2). When no live source is reachable the
  fallback bottoms out at Yahoo **daily** bars and "no new present candles" is designed behavior.
- A shared per-IP rate-limit bucket (60 req/60 s) can 429 a legitimately busy multi-panel suite
  session (`PICC.md` §20.1).
- No browser extension ships. The archived `apps/extension-archived/` Plasmo skeleton is historical
  only; the extension era was removed end-to-end (D1) and its passive sensor role moved to the
  studio browser's headless capture leg.

## Roadmap status (highlights)

| Task | Status |
| :-- | :-- |
| Dashboard, Twin, Listing, Content Studio, CrewAI crews, n8n templates, local JSON data store | ✅ |
| Trading Suite — ensemble, MTF, U4FA, paper ledger, EO demo bridge | ✅ |
| Studio browser + headless capture (replaces the removed extension era) | ✅ |
| Node backend, hybrid LLM failover, Serper | ✅ |
| Payments — TnG · BTCPay · Stripe | ✅ (live when keys set) |
| Income connectors, Stream catalog, classifications | ✅ (bandwidth suite removed — ADR-0002) |
| Finance tracker + Holdings editor | ✅ |
| Production deployment (Docker · PM2 · systemd + reverse proxy) | ✅ |
| **Command Centre Web** — risk-backed autopilot/copilot mode engine (spec committed, `docs/specs/COMMAND_CENTRE_WEB_SPEC.md`) | 🔜 next phase (7 rollout slices) |
| Perps rail closure (a real gated `cancelOrder`) and removal of the approved-but-unlanded ExpertOption leg | 🔜 owner-confirmed scope, envelope $10 / 2 units / −5% daily |

Full detail: `PICC.md` §§10–11.