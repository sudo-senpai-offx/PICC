# Headless capture venue research (Phase 5, T10)

Research log for the nine non-ExpertOption venues in the headless-capture coverage
matrix (`apps/dashboard/server/services/captureProfiles.mjs`). What a headless engine
needs per venue: a **login page** to drive, a **logged-in signal** to detect, a
**session-token storage surface** to extract, and a **metrics source**. Every claim
below traces to a PRIMARY source (official help center, official developer/API docs,
first-party docs, or a direct observation of the official page on 2026-08-30).
Non-primary sources (reverse-engineered libraries) are flagged as such and are NOT
treated as authoritative.

Spec: `docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md`, T10 (fixtures/replay research).

## Bottom line (read this first)

1. **No non-EO venue can be promoted on documentation alone.** Every venue's official
   docs describe its *external API-key* authentication model, but are silent on the
   **browser session token** — the localStorage/sessionStorage/cookie key that holds a
   logged-in tab's session. `storageScan` for all nine venues requires a **live
   logged-in fixture capture** (drive a real login, inspect the browser storage, record
   the key names + post-login URL/DOM markers). This is the R1 risk the spec predicted.
2. **Metrics** are the one layer documentation genuinely supports for **6 of 9**
   venues: Deriv, Binance, KuCoin, OKX, Bybit, eToro all publish signed
   balance/portfolio APIs. IQ Option, Olymp Trade, and Plus500 (retail) publish **no**
   API — their metrics need reverse engineering.
3. **Deriv is the standout.** It is the ONLY venue with a fully documented login flow
   (OAuth2 + PKCE), documented OAuth helper storage keys (`pkce_code_verifier`,
   `oauth_state`), a documented logged-in redirect (session-token query params), a
   documented metrics API, and an officially sanctioned automation story (Deriv Bot /
   API users terms). Even so, the definitive logged-in session-token key name on
   `home.deriv.com` is undocumented → the reference capture still needs a live fixture
   before any `storageScan` key is trusted.
4. **Compliance flags are real and primary-sourced.** Binance's terms explicitly ban
   bots/crawlers/automated access and VPN geo-circumvention; OKX gates login behind
   reCAPTCHA; IQ Option and Olymp Trade gate login behind CAPTCHA; KuCoin restricts a
   defined country list and locks accounts after repeated failed verification; eToro
   requires KYC for API access. An unattended headless login+capture engine for these
   venues must clear terms/compliance before anything ships — this is a
   product/legal gate, not a code gate.

## Engineering implications (what this changes in the engine)

- `captureProfiles.mjs` rows stay honest: `iqoption/binance/kucoin/okx` remain
  `capture-only` (hook `null` → reports `not-enabled`), the five catalog-only venues
  stay `catalog-only`. **T11's flips are NOT supportable until live fixtures land.**
- The research VERIFIED facts (login URLs, auth flow, documented metrics API surface)
  are recorded per venue below and summarized on each profile row's `capture.note`.
- Any future capture hook for these venues must be built against a **recorded fixture**
  (real session storage keys + post-login DOM/URL), not against this document.

---

## Binary venues

### IQ Option (`iqoption`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://iqoption.com/en/login` (also `login.iqoption.com`, `eu.iqoption.com/en/login`, PWA `iqoption.com/pwa/auth/login`; `/th/login`, `/cn/login`). Observed 2026-08-30: email+password form, Google/Facebook, captcha. |
| authFlow | **VERIFIED** | Email+password + social; CAPTCHA on the login page ("Please complete the captcha verification"). 2FA **NOT-VERIFIED** (no primary source found). Geo-gated: US/CA/EU/UK/AU excluded per official homepage. |
| session mechanics | **NOT-VERIFIED** | No official API docs. Only source in the wild: reverse-engineered `iqoptionapi` (`LuKks/iqoption`) claiming a WS `ssid` session value stored in a cookie named `ssid` — flagged NON-PRIMARY, do not trust. |
| storageScan | **UNKNOWN — live fixture required** | No primary source names any storage key. |
| loginSignal | **PARTIAL** | Official login page renders "You're already logged in… enter the traderoom" for authenticated visitors; `redirect_url=traderoom` appears on the official login route. Exact post-login path needs live confirmation. |
| metrics extractVia | **NOT-VERIFIED** | No documented API. Requires reverse engineering. |

Compliance: CAPTCHA-gated login; geo-restricted (US/CA/EU/UK/AU). No public API → no
documented rate limits.

Sources: iqoption.com/en/login; login.iqoption.com; eu.iqoption.com; iqoption.com
(homepage exclusions); iqoption.com/pwa/auth/login. Non-primary (flagged):
github.com/LuKks/iqoption, iqoptionapi.readthedocs.io.

### Olymp Trade (`olymptrade`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://olymptrade.com/login` (also `www.olymp.co/en/login`). Observed: `redirect_url` params on the login page pointing to `/cabinet` and `/platform`. Geo-gated ("Platform unavailable / Registration unavailable" for restricted regions). |
| authFlow | **VERIFIED** | Email+password; 2FA via Google Authenticator or Facebook Messenger (official help center); email verification code on new location/device; reCAPTCHA at login; free $10,000 demo account (official). |
| session mechanics | **NOT-VERIFIED** | No official API docs. Only source: reverse-engineered CHIPa `OlympTradeAPI` claiming the WS `access_token` comes from a cookie after login at `olymptrade.com/platform` — flagged NON-PRIMARY. |
| storageScan | **UNKNOWN — live fixture required** | No primary source names any storage key. |
| loginSignal | **VERIFIED (redirect paths only)** | Documented post-login targets `/cabinet` and `/platform`; `olymptrade.com/platform?account=demo&…` is an official platform URL. Exact logged-in DOM marker needs a live fixture. |
| metrics extractVia | **NOT-VERIFIED** | No documented API. Requires reverse engineering. |

Compliance: reCAPTCHA-gated login; geo-restricted.

Sources: olymptrade.com/login; olymptrade.com/platform?account=demo… ;
plus.olymptrade.com help (2FA, 2FA-via-Google); blog.olymptrade.com login guide
(official blog); olymptrade.com/pages/trading/account; …/free-demo. Non-primary
(flagged): CHIPa `OlympTradeAPI` docs.

### Deriv (`deriv`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://home.deriv.com/dashboard/login` (+ `?return_to`, `?lang`); signup `home.deriv.com/dashboard/signup`, `deriv.com/signup`; OAuth2 authorize `auth.deriv.com/oauth2/auth`. |
| authFlow | **VERIFIED** | Official API docs: OAuth2 Authorization Code + PKCE (web apps) and Personal Access Tokens (PAT). Signup via email or Google/Facebook/Apple. 2FA documented by official community article. |
| session mechanics | **VERIFIED** | OAuth2 bearer tokens for REST; trading WebSockets via OTP-URL flow (`POST /trading/v1/options/accounts/{id}/otp` → WS URL with one-time password); WS timeout 2 min inactivity; OAuth redirect returns per-account session tokens as query params (`token1=…`, `acct1=…`). |
| storageScan | **PARTIAL** | Official OAuth2 dev docs explicitly instruct storing **`pkce_code_verifier`** and **`oauth_state`** in `sessionStorage`. These are the documented OAuth helper keys — NOT necessarily the final logged-in session-token key, which remains **UNKNOWN — live fixture required**. |
| loginSignal | **VERIFIED** | `home.deriv.com/dashboard` = logged-in dashboard vs `/dashboard/login` = login form (official footer links); successful OAuth sign-in redirects with session-token query params. |
| metrics extractVia | **VERIFIED (documented API)** | `balance` WS endpoint + `subscribe:1`; `authorize` API; REST `/wallet/v1/wallets`, `/wallet/v1/transactions` (OAuth `payment` scope); `GET /trading/v1/options/accounts`. |

Compliance (official API users terms): usage limits ("we may block your access"),
24 h content caching, OAuth/PAT tokens stored only as needed, 2-min WS inactivity
timeout. **Automation is officially sanctioned** (Deriv Bot / API) under those limits.

Sources: home.deriv.com/dashboard/login; developers.deriv.com/docs/intro/authentication;
developers.deriv.com/docs/intro/oauth; developers.deriv.com/docs/options/websocket;
developers.deriv.com/docs/account/balance; developers.deriv.com/docs/wallet/;
community.deriv.com 2FA article; deriv.com/terms-and-conditions/api-users;
legacy-docs.deriv.com/docs/oauth.

---

## Spot exchanges

### Binance (`binance`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://accounts.binance.com/en/login` (login subdomain, confirmed by official binance.com web3 page links; `www.binance.com/en/login` is a JS shell — both returned empty bodies to a static fetch, fully client-rendered/geo-gated). |
| authFlow | **VERIFIED** | Email/phone + password; 2FA (Google Authenticator, Binance Authenticator, SMS, email codes); passkeys/FIDO (official help articles). |
| session mechanics | **VERIFIED (API-key model)** | REST signed with HMAC-SHA256 (`signature` + `X-MBX-APIKEY`; security types USER_DATA/USER_STREAM/TRADE/MARKET_DATA); WebSocket API `session.logon` with Ed25519 API key; documented **listenKey** user-data stream (`POST /api/v3/userDataStream`, ~60-min keepalive). **Browser session storage is undocumented.** |
| storageScan | **UNKNOWN — live fixture required** | No primary source names a browser session key. |
| loginSignal | **UNKNOWN — live fixture required** | Global binance.com has no documented post-login dashboard URL/DOM marker (binance.US `/dashboard`/`/wallet` belong to the separate US entity). |
| metrics extractVia | **VERIFIED (documented API)** | `GET /api/v3/account` (signed) returns spot balances; user-data stream events `outboundAccountPosition` / `balanceUpdate`. |

Compliance: binomial. ToS + Prohibited Use Policy explicitly ban bots/crawlers/scripts/
automated access, vulnerability probing, and VPN circumvention of geo-restrictions;
US persons excluded.

Sources: accounts.binance.com/en/login; binance.com/en/web3; github.com/binance/
binance-spot-api-docs (rest-api.md, user-data-stream.md, web-socket-api.md);
developers.binance.com WS-API auth; binance.com support FAQ (2FA, passkeys);
bin.bnbstatic.com ToS + Prohibited Use Policy PDFs.

### KuCoin (`kucoin`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://www.kucoin.com/login`. Observed 2026-08-30: real server-rendered form — Email/Phone + QR tabs, "Log In with Passkey". EU variant `kucoin.com/en-eu/…`. |
| authFlow | **VERIFIED** | Email/phone + password, QR-code app login, passkey; 2FA via Google Authenticator/SMS/email code (official support). |
| session mechanics | **VERIFIED (API-key model)** | Private REST headers `KC-API-KEY/KC-API-SIGN/KC-API-TIMESTAMP/KC-API-PASSPHRASE/KC-API-KEY-VERSION`; HMAC-SHA256 signature. **Browser session storage is undocumented.** |
| storageScan | **UNKNOWN — live fixture required** | No primary source names a session key. |
| loginSignal | **UNKNOWN — live fixture required** | No documented post-login dashboard URL/DOM marker (spot trading page observed: `/trade/BTC-USDT`, but that's a public page). |
| metrics extractVia | **VERIFIED (documented API)** | `GET /api/v1/accounts` returns spot account balances (signed). |

Compliance: restricted-location exclusion list (US, Singapore, mainland China, HK,
Malaysia, Ontario/BC, France, Netherlands, parts of Ukraine); 2-hour lockout after 5
wrong verification attempts (official).

Sources: kucoin.com/login (observed); kucoin.com/docs-new/authentication;
github.com/Kucoin/kucoin-api-docs; kucoin.com support articles (Google 2FA, login
guide, passkey, MFA, restricted countries, error codes).

### OKX (`okx`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://www.okx.com/account/login` (not `/login` — that 404s; `en-us` regional variant). Observed 2026-08-30: real form — email/phone password flow, passkey, Google/Apple/Telegram/Wallet social, "protected by reCAPTCHA". |
| authFlow | **VERIFIED** | Password + mandatory 2FA (email/SMS/authenticator, face verification for some flows); passkeys; social login; new-device authorization (official help). |
| session mechanics | **VERIFIED (API-key model)** | Private REST headers `OK-ACCESS-KEY/SIGN/TIMESTAMP/PASSPHRASE`; HMAC-SHA256; private WS `{"op":"login"}`. **Browser session storage is undocumented.** |
| storageScan | **UNKNOWN — live fixture required** | No primary source names a session key. |
| loginSignal | **UNKNOWN — live fixture required** | Portfolio/Assets/Security-Center (`/account/security`) are documented logged-in surfaces but no machine-detectable marker. |
| metrics extractVia | **VERIFIED (documented API)** | `GET /api/v5/account/balance` (signed); private WS position/balance channels. |

Compliance: login behind Google reCAPTCHA; US users expressly barred from global OKX
products (separate OKX INC US entity); Trading Bots are a first-party documented
product (automation as a feature exists, governed by its own terms).

Sources: okx.com/account/login (observed); okx.com/docs-v5/en; my.okx.com/docs-v5/en;
okx.com help (security guide, passkeys, new-device auth, password); okx.com terms
(US trading bots, EEA trading bots, US ToS).

---

## Derivatives / CFD

### Bybit (`bybit`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://www.bybit.com/en/login`. Observed 2026-08-30: server-rendered form — Email / Mobile / QR tabs, Google/Apple social, subaccount login. |
| authFlow | **VERIFIED** | Email/password, mobile, QR, Google/Apple. 2FA: Google Authenticator required for API-key creation (official help). KYC mandatory for full services (Standard/Advanced levels; fiat/Earn + withdrawal limits). |
| session mechanics | **VERIFIED (API-key model)** | V5 API: HMAC-SHA256 (system keys) / RSA-SHA256 (auto keys); headers `X-BAPI-API-KEY/TIMESTAMP/SIGN/RECV-WINDOW`. **Browser session storage is undocumented.** |
| storageScan | **UNKNOWN — live fixture required** | No primary source names a session key. |
| loginSignal | **UNKNOWN — live fixture required** | No documented logged-in redirect/DOM marker. |
| metrics extractVia | **VERIFIED (documented API)** | `GET /v5/account/wallet-balance` (totalEquity/walletBalance/available etc.), `/v5/account/account-info`, `/v5/asset/balance/all-balance`. |

Compliance: KYC mandatory; restricted countries; API terms govern programmatic use.

Sources: bybit.com/en/login (observed); bybit-exchange.github.io/docs/v5 (guide,
wallet-balance); bybit.com help center (KYC FAQ, restricted countries, Paradigm API
2FA, API terms).

### eToro (`etoro`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED** | `https://www.etoro.com/login` (`/login/index.html` renders statically; `/login/` is a JS shell). Observed 2026-08-30: "Username or Email" + "Keep me logged in for 30 days" + "Sign up with Google / Sign in with Google". |
| authFlow | **VERIFIED** | Email/username + password; social sign-in via Apple/Facebook/Google (official help: "You may have created your eToro account using your Apple, Facebook or Google credentials"); 2FA via push/SMS/phone call (official help). |
| session mechanics | **VERIFIED (external API model)** | Public API uses `x-api-key` (app) + `x-user-key` (user) pairs generated in Settings → API Key Management. **The web app's internal session storage is undocumented** — "Keep me logged in for 30 days" implies a persistent client-side session with an undocumented key. |
| storageScan | **UNKNOWN — live fixture required** | No primary source names a session key. |
| loginSignal | **UNKNOWN — live fixture required** | No documented post-login marker. |
| metrics extractVia | **VERIFIED (documented API)** | `GET /api/v1/balances` (aggregated, scope `etoro-public:money.balance:read`), `/api/v1/balances/{accountType}`, `/api/v1/trading/info/portfolio`, `/api/v1/trading/info/real/pnl`. Requires verified account + KYC. |

Compliance: KYC required before API access (official docs: 403 KYC required);
regulated broker.

Sources: etoro.com/login/index.html (observed); help.etoro.com (why-can't-I-log-in,
2FA articles); builders.etoro.com/learn/authentication-and-api-keys;
api-portal.etoro.com (balances, trading--real references).

### Plus500 (`plus500`)

| Field | Status | Notes (source) |
|---|---|---|
| loginPage | **VERIFIED (URL only)** | `https://app.plus500.com/?page=login` (live trading: `app.plus500.com/trade?product=CFD&IsRealMode=True`). The app is fully JS-rendered — a static fetch returns only the title "Plus500 WebTrader"; **no form content observable without a JS browser**. |
| authFlow | **VERIFIED (partial)** | Email/password; 2FA via Settings → Security Settings (official FAQ). Social/Google sign-in **NOT-VERIFIED** — only third-party (non-primary) pages claim it; explicitly excluded. |
| session mechanics | **NOT-VERIFIED** | The retail CFD platform has NO official public API. The only Plus500 API is the separate **US futures** division (T4/CTS platform, `docs.t4login.com`) — a different product; cannot authenticate the CFD web client. |
| storageScan | **UNKNOWN — live fixture required** | Official Cookie Policy names only third-party analytics/consent cookies, no session/auth key. |
| loginSignal | **UNKNOWN — live fixture required** | No documented logged-in marker. |
| metrics extractVia | **NOT-VERIFIED** | Not documented for retail CFD; balance/equity would require reverse-engineering the WebTrader client. |

Compliance: leveraged retail CFD with mandated risk disclosure; account verification
(ID + address + payment + phone SMS) required; JS-gated app shell.

Sources: app.plus500.com (observed); plus500.com FAQ (platform login, 2FA, account
verification); cdn.plus500.com Cookie Policy PDF; docs.t4login.com (T4 futures — noted
as a different product).

---

## Fixture-capture checklist (what a live session must record per venue)

Before any venue is promoted (`capture-only` → capture hook, or `catalog-only` →
`capture-only`), a logged-in fixture must record, for that venue and region:

1. The full set of storage keys written at login: `localStorage`, `sessionStorage`,
   and cookie names+paths+flags (HttpOnly matters — an HttpOnly cookie cannot be read
   by `page.evaluate`; it would need the CDP cookie API).
2. The post-login URL and a stable DOM/URL logged-in marker (`loginSignal`).
3. The exact string that IS the session credential (JWT shape, opaque token, cookie
   value) — so the engine can decide what to persist + how to mask it.
4. For metrics: whether the documented API surfaces (6 venues) or reverse-engineered
   endpoints (IQ Option, Olymp Trade, Plus500) are reachable from the captured session.
5. Region + login method used (password vs passkey vs social vs QR) — findings may
   vary per method, and the engine must not assume one key set for all.

None of these can be produced from documentation; this document does not replace them.