# PICC — Privacy Policy

**Last updated:** September 2026 (F-12 dual-mode rewrite)

## Overview

PICC (Personal Income Command Center) is a self-hosted income/trading dashboard with an
optional browser extension that reads live data from the trading venues you are logged into.
It runs in one of two clearly distinct modes:

| | **Local-only mode** (default) | **Hosted mode** (opt-in) |
|---|---|---|
| Server address | `127.0.0.1` only | Operator-exposed (reverse proxy / TLS) |
| Accounts | Single user, no sign-in | Supabase auth, per-user data scoping |
| Data leaving the machine | Only explicit outbound fetches below | Same + profile/payment rows to your Supabase project |

Everything in this policy is stated per mode. **If a statement does not say "hosted mode", it
applies in both modes.**

## Where your data lives

- Runtime data — trading balances/positions, journal entries, alerts, watchlists, income
  streams, settings — is stored in **local JSON files** under `apps/dashboard/server/data/`
  (overridable via `PICC_TRADING_DATA_DIR`). It never leaves the machine unless you enable the
  hosted-mode integrations described below.
- **Credentials are encrypted at rest.** Broker/venue session tokens, venue tokens, and
  automator credentials are written through an AES-256-GCM vault, never as plaintext JSON. The
  key is either auto-generated per data directory (`picc-vault.key`, mode 0600) or supplied via
  the `PICC_VAULT_KEY` environment variable (recommended for hosted deployments so the key never
  shares a directory with the ciphertext).
- The browser extension (`picc-overlay`) keeps its own small state in browser extension storage.

## The browser extension

- The extension communicates **only with your PICC server over loopback**
  (`http://localhost:*` / `http://127.0.0.1:*`). It has no other network permissions.
- It reads the **active tab only on the trading-venue domains you have registered** (e.g. the
  ExpertOption site), and only what that page renders: prices, candles, and your account
  balance/positions from the venue page you are logged into. It cannot read other tabs or other
  sites, and it never transmits browsing history.
- Captured frames are sent to your PICC server to feed the chart/decision surface. The venue
  session token is captured from **your own logged-in session** and stored encrypted (see above).
- No analytics, tracking pixels, telemetry, or advertising identifiers exist anywhere in the
  extension or the server.

## What leaves the machine (and when)

The following outbound calls happen **only when you configure the relevant key or feature** —
nothing is sent by default in local-only mode:

1. **Market data** — public chart/quote/history endpoints (Yahoo Finance; calendar data from
   public endpoints; read-only public market data via CCXT). No personal data is included.
2. **LLM analysis** — when you add provider keys (Gemini, Groq, Mistral, Cerebras, OpenAI,
   …), analysis prompts are sent to that provider. Prompts can include market data and your
   watchlist/journal context so the analysis is meaningful; **credentials are never included**.
   Those requests are subject to the provider's own privacy policy.
3. **Webhooks** — the alert notifier can POST to webhook URLs that **you** configure (e.g. a
   personal notification bridge). You choose the endpoint and the payload.
4. **Hosted mode only — Supabase**: with `VITE_SUPABASE_URL`/keys configured, sign-in,
   profile, payment/billing, and income-classification rows are stored in **your** Supabase
   project under the schema in `infra/supabase/`. The data goes to your project, not to PICC.

## Data we do not collect

- Browsing history, personal identification details, payment card numbers, or location data.
- Usage analytics or telemetry of any kind.
- We do not sell, rent, or share your data with third parties for any purpose.

## Data retention and deletion

- **Local mode:** deleting the JSON stores under your PICC data directory (or uninstalling the
  extension) removes the data. Deleting the vault key file makes the encrypted stores
  unrecoverable — export anything you need first.
- **Hosted mode:** profile/payment rows live in your Supabase project; remove them there (the
  schema in `infra/supabase/` documents the tables). Deleting your local data dir does not
  delete Supabase rows.

## PDPA note (Singapore Personal Data Protection Act)

Your personal data is limited to what you actively provide: trading balances and venue session
state for the venues you connect, plus (hosted mode) your profile/payment records. Purpose is
limited to operating the dashboard you run; you remain in control of every external
integration, and each can be disabled without affecting the rest of the system.

## Changes to this policy

Updates are tracked in this repository with the date above. The previous single-mode draft
(which claimed all data stays local in every configuration) was replaced because the app grew
an opt-in hosted mode — the local-only default described there still holds in local-only mode.
