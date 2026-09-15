# Passive Income Command Center (PICC)

An AI-assisted **planning** platform for exploring and optimizing passive income streams. PICC
combines a **sandbox emulator** (financial what-if simulations), a **passive browser sensor** (a
DOM-free MV3 extension that relays the live market feed from broker pages you already have open),
a **studio browser** with a read-only metrics overlay, an **income connector layer**
(bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels), and a **trading decision
suite** with honest, calibrated, advisory-only signals.

**PICC never executes transactions on your behalf.** Every AI suggestion is gated behind a
mandatory human-review step, and the only order path in the codebase is the paper-trading ledger
behind a human-approval gate.

> **Single source of truth:** [`PICC.md`](PICC.md) is the cumulative, exhaustive master document —
> architecture, service inventory, audit ledger, specs registry, research corpus, compliance,
> validation runbook, and open work. This README is the short entry point; when code and docs
> disagree, **code is truth**.

## What's inside

| Directory | What it is | Stack |
| :-- | :-- | :-- |
| `apps/dashboard` | Web dashboard (auth, simulators, trading suite, finance tracker, income connectors, overlay settings) | React + TypeScript + Vite + Supabase |
| `apps/dashboard/extensions/picc-overlay` | Browser extension — passive sensor: relays broker feed frames to the local backend (DOM-free, no trading actions) | MV3 vanilla JS (no bundler, load unpacked) |
| `apps/extension-archived` | **Archived** — Plasmo skeleton, no trading features, superseded by picc-overlay | Plasmo (unused, historical) |
| `agents/picc_agents` | Multi-agent research / content / listing / trading / investment crews | CrewAI (Python) |
| `infra/supabase` | Database schema with Row Level Security (v1 + v2 income-classification model) | SQL |
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
5. **Income connectors & Automator** — bandwidth providers (Honeygain, Pawns, Traffmonetizer,
   Repocket, EarnApp, PacketStream) with normalized balance snapshots, honest per-provider source
   labels, and LLM health assist.
6. **Finance Tracker & Holdings** — server-backed accounts/transactions CRUD, computed net worth
   (assets − liabilities), and `nft_holdings`/`depin_nodes` holdings editor.
7. **Browser extension** — passive, DOM-free sensor relay (broker frames → local backend), with an
   offline queue and honest `online | offline | standby` status.

## Quick start

Full instructions: [`PICC.md`](PICC.md) §18 (setup & deployment), §8.7 (trading runbook).

```bash
npm install
cp apps/dashboard/.env.example apps/dashboard/.env   # add Supabase + LLM + Serper + payment keys
npm run dev                                          # dev on http://localhost:5173
```

Browser extension (no build step — load unpacked):
`chrome://extensions` → Developer mode → Load unpacked →
`apps/dashboard/extensions/picc-overlay/`.

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
Browser Extension (MV3) ◀── suggestions + live data ──┘
External platforms (brokers, Amazon, YouTube…) — user clicks, PICC never executes
```

The LLM is a **free hybrid**: add a key for any of Gemini, Groq, Mistral, or Cerebras (all have
card-free free tiers) and the backend fails over between configured providers. When no key is
present or every provider is down, output is labelled `local engine` — never presented as real.
`/api/health` shows exactly which providers are configured.

## Legal posture & honesty

PICC is deliberately a **decision-support tool**, not an automated decision-making system:

- Read-only data connections wherever possible; the only order path is paper trading.
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

- Realtime charts only animate while the ExpertOption live feed is connected; when it is down the
  fallback is Yahoo **daily** bars and "no new present candles" is designed behavior
  (`PICC.md` §20.2).
- A shared per-IP rate-limit bucket (60 req/60 s) can 429 a legitimately busy multi-panel suite
  session (`PICC.md` §20.1).
- The archived `apps/extension/` Plasmo skeleton is deprecated — the canonical extension is
  `apps/dashboard/extensions/picc-overlay/`.

## Roadmap status (highlights)

| Task | Status |
| :-- | :-- |
| Dashboard, Twin, Listing, Content Studio, CrewAI crews, n8n templates, Supabase v1+v2 | ✅ |
| Trading Suite — ensemble, MTF, U4FA, paper ledger, EO demo bridge | ✅ |
| Extension sensor relay + offline queue + live-probe status | ✅ |
| Node backend, hybrid LLM failover, Serper | ✅ |
| Payments — TnG · BTCPay · Stripe | ✅ (live when keys set) |
| Income connectors, Automator, Stream catalog, classifications | ✅ |
| Finance tracker + Holdings editor | ✅ |
| Production deployment (Docker · PM2 · systemd + reverse proxy) | ✅ |
| **Command Centre Web** — risk-backed autopilot/copilot mode engine (spec committed, `docs/specs/COMMAND_CENTRE_WEB_SPEC.md`) | 🔜 next phase (7 rollout slices) |
| First real-money execution (CCXT sanctioned automation + bandwidth auto-claim, within safety floor) | 🔜 owner-confirmed scope, envelope $10 / 2 units / −5% daily |

Full detail: `PICC.md` §§10–11.