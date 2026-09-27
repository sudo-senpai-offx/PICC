# PICC — Privacy Policy

**Last updated:** September 2026 (F-12 dual-mode rewrite; extension and hosted-database sections
corrected 2026-09-27)

## Overview

PICC (Personal Income Command Centre) is a self-hosted income/trading dashboard. **PICC ships no
browser extension** — the extension era was removed end-to-end, and this policy no longer describes
any data capture by one. What remains is a local dashboard plus an in-app studio browser (real
Chrome/Edge over CDP) that you drive yourself. PICC runs in one of two clearly distinct modes:

| | **Local-only mode** (default) | **Hosted mode** (opt-in) |
|---|---|---|
| Server address | `127.0.0.1` only | Operator-exposed (reverse proxy / TLS) |
| Accounts | Single user, no sign-in | Local `auth.mjs` verifier, per-user data scoping |
| Data leaving the machine | Only explicit outbound fetches below | Same + profile/payment rows, if a hosted store is configured |

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
- **There is no extension state to describe.** PICC ships no browser extension and no
  `/api/extension/*` endpoint, so there is no browser extension storage, no frame-relay queue and
  no per-site content script. Its historical sensor role is served by the studio browser, whose
  sessions and reads are covered by the bullets above and below.

## The studio browser (and the removed extension)

- The studio browser is a real Chrome/Edge instance PICC drives over CDP, and **you** point it at a
  venue. Reads are read-only: candles and balances land in the local feed paths, and PICC never
  submits a trade message from a browser session.
- It launches real Chrome/Edge and, **by default**, strips the automation signals it controls:
  it launches with `--disable-blink-features=AutomationControlled` (which is what makes
  `navigator.webdriver` false) and drops the `--enable-automation` default arg
  (`browserBridge.mjs:362-367`, `stealth = true` at `:335`). The stated reason in the code is
  that "there is no fingerprint to detect". This is disclosed rather than hidden; pass
  `stealth: false` to keep the raw signals.
  PICC can also import a real logged-in browser profile you have used yourself.
- Venue session tokens are captured from **your own logged-in session** and stored encrypted (see
  above). That is the only session material PICC handles.
- No analytics, tracking pixels, telemetry, or advertising identifiers exist anywhere in the app.

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
4. **Hosted mode only — a hosted profile store, if you configure one**: the shipped default is
   fully local, and the previously documented hosted database (its `VITE_SUPABASE_*` variables and
   the `infra/supabase/` schema) has been removed from the app — there is no client in the tree and
   no `package.json` dependency. If an operator wires up their own store, sign-in, profile,
   payment/billing, and income-classification rows go to **that** operator's store under their
   own terms, not to PICC.

## Data we do not collect

- Browsing history, personal identification details, payment card numbers, or location data.
- Usage analytics or telemetry of any kind.
- We do not sell, rent, or share your data with third parties for any purpose.

## Data retention and deletion

- **Local mode:** deleting the JSON stores under your PICC data directory removes the data (there is
  no extension to uninstall). Deleting the vault key file makes the encrypted stores
  unrecoverable — export anything you need first.
- **Hosted mode:** any hosted profile/payment rows live in whatever store the operator configured
  — remove them there. Deleting your local data dir does not delete rows in a store PICC does not
  own. The `infra/supabase/` SQL files are orphaned schema documentation, not a live store.

## PDPA note (Singapore Personal Data Protection Act)

Your personal data is limited to what you actively provide: trading balances and venue session
state for the venues you connect, plus (if an operator configured a hosted store) your
profile/payment records. Purpose is
limited to operating the dashboard you run; you remain in control of every external
integration, and each can be disabled without affecting the rest of the system.

## Changes to this policy

Updates are tracked in this repository with the date above. The previous single-mode draft
(which claimed all data stays local in every configuration) was replaced because the app grew
an opt-in hosted mode — the local-only default described there still holds in local-only mode.
