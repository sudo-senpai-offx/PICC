# Hyperliquid Connect — Runbook

**Status:** living doc (updated as the onboarding progresses)
**Date:** 2026-09-06
**Author:** PICC executor (steps researched + wizard built + approved in conversation)
**Purpose:** the one place that records *why* and *how* PICC's CCXT rail gets wired to a real
Hyperliquid account — wallet setup, funding, credential provisioning, read-only proof, and the
live verify — so the session-by-session details survive conversation context.

---

## 1. Goal

Stand up real-money (real-money = US$10-scale, gate-checked) spot trading on Hyperliquid through
PICC's Command Centre, using the **wallet-key credential mode** of the ccxt seam:

- `PICC_CCXT_WALLETADDRESS_HYPERLIQUID` + `PICC_CCXT_PRIVATEKEY_HYPERLIQUID` in `apps/dashboard/.env`
- The API wallet has **Reading + Trading on, Withdrawals OFF** (no withdrawal capability in the
  credential PICC holds).

Every gate and honesty label from the Command Centre spec stays in force; nothing is weakened for
this live path. The full 10-gate preposition chain runs before any order; execution only via the
`trading:ccxt` envelope (max US$10 notional; see §5 collision).

## 2. Reference material

| What | Where |
|---|---|
| Command Centre spec (credential lines, gates, proposal flow) | `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` |
| ccxt seam (wallet-key mode, `ccxtKeysForExchange`, `ccxtInstanceFor`) | `apps/dashboard/server/services/ccxtOrdering.mjs` |
| Execution envelope (`trading:ccxt`, `maxExposureUsd: 10`) | `apps/dashboard/server/services/commandCentre/policyGraphCatalog.mjs` |
| Env loading (boot-time, `process.loadEnvFile`) | `apps/dashboard/server/config.mjs` |
| Env template (both credential modes documented) | `apps/dashboard/.env.example` |
| CCXT wallet-mode fixture tests | `apps/dashboard/server/__tests__/ccxtOrdering.test.mjs` |
| Wizard (the interactive walkthrough) | `scripts/hyperliquid-connect.wizard.sh` |

## 3. Wallet topology (decided)

- **Main account** = the vault. Live in **Rabby**, in a **dedicated browser profile** (Rabby's
  pre-signing simulation beats MetaMask for a wallet that will later sign Hyperliquid operations).
  A **hardware wallet (Ledger/Trezor)** is the declared end-state once the envelope grows beyond
  pocket-money size; Rabby pairs with them then.
- **API account** = the only thing PICC ever touches. Created at `https://app.hyperliquid.xyz/API`
  with Reading + Trading enabled, **Withdrawals disabled**. Private key shown once, then pasted
  into `.env`.
- **Rule:** idle crypto never lives in a wallet that has been connected to Hyperliquid or PICC.
  Savings stay in TnG eWallet / a never-connected address. PICC is wallet-agnostic — it only reads
  the two env vars.
- Email-account sign-in exists as an option but is weaker long-term than the vault setup; not used.

## 4. Funding (the only piece left before the wizard)

The deliverable is **native USDC on Arbitrum One** in Rabby. Hyperliquid minimum deposit is
**5 USDC** (below that, not credited). Target wallet balance **~US$12–15** so the venue-minimum
order (~$10) clears comfortably after any fees.

**Decision (2026-09-06, updated evening):** the original Route-B decision (bank rails via MEXC
P2P) is dead — **MEXC refused signup** hours later (region-restriction wall, same class as Bybit).
Two further facts reshaped the map: (1) **Luno confirmed the user is a Malaysian resident** (SC-
registered DAXes serve MY residents only; signup accepted; no VPN involved) — the region question
is resolved; (2) **Luno MY offers no USD stablecoin** (official table: USDC/USDT/PYUSD/EURC all
restricted for MY). Current decision: fund via **Route D (Transak)** — verified end-to-end,
card/Apple Pay/Google Pay → native USDC on Arbitrum — as the default; **Route C via Hata** if
SC-licensed + FPX bank rails matter more (needs in-app confirmation of USDC listing + withdrawal
network). Amount: ~US$12–15 target; if the on-ramp's minimum order is higher, a slightly larger
one-time fund is acceptable — ≥$10 *after fees* is what matters, and the PICC envelope stays at
$10 regardless.

**Platform facts (2026-09-06, evening):**

- **Bybit and MEXC both refuse this user** (region-restriction walls). Offshore exchanges of the
  SC investor-alert class are **not reliably signup-able from Malaysia in 2026** — do not re-
  recommend this class to this user.
- Region question **resolved**: Luno accepted the signup → the user is a Malaysian resident, no
  VPN. The two blocks are data points about those platforms' MY stances (MEXC's
  "Malaysia-friendly" reviews are stale or wrong), not about the user's location.
- **Luno MY has no USD-pegged stablecoin**: official supported-networks table (2026-09-06) marks
  USDC "Not available in Malaysia" (likewise USDT, PYUSD, EURC). Luno MY *does* sell BTC, ETH,
  SOL, POL, XRP, ADA, LTC (all "Global").
- **Transak serves Malaysia** (official `transak.com/buy/usdc/malaysia`; MYR; card / Apple Pay /
  Google Pay) and **delivers native USDC directly on Arbitrum One** (official Arbitrum chain page;
  corroborated by Eco's USDC-on-Arbitrum guide 2026-05: "MoonPay, Transak, and Coinbase Onramp all
  sell native USDC on Arbitrum directly to a wallet address"). Card cost 2–4% above spot ≈ RM 1–2
  at this size. HYPE is not tradeable on Luno at all (SC approval aside, its table lists HYPE as
  no-send/receive, SA/Nigeria only).
- **MoonPay does not serve Malaysia** ("Coming soon to your region", 2026-09-06) and Coinbase
  Onramp is out (no Coinbase in MY). Of the card on-ramps that sell native USDC on Arbitrum,
  **Transak is the only one listing MY** — it holds even with a system-side KYC queue.

### Route D — Transak on-ramp, straight to Arbitrum (verified; default)

No exchange account — a fiat on-ramp (payment provider with KYC/AML, embedded in major wallets):

1. Open `global.transak.com` (or Rabby's built-in Buy flow if it surfaces Transak/MoonPay) → Buy →
   **USDC** → chain **Arbitrum**.
2. Enter ≈ US$12–15 — the widget shows the true MYR cost before you pay. Payment:
   **credit/debit card, Apple Pay, or Google Pay** (MY-supported methods; note this is *card*
   rails, not FPX — the one deviation from the original bank-rails preference, driven by what
   on-ramps accept for MY).
3. Destination: the **Rabby Arbitrum address** (copy from Rabby with the chain selector on
   Arbitrum). Double-check the chain reads **Arbitrum** before confirming — a mainnet-delivery
   mistake means an extra hop.
4. Verify in Rabby: native USDC on Arbitrum (contract `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`).
   **No Arbitrum ETH needed for the deposit leg.**

Caveats: 2–4% above spot on card; minimum order shown on the widget (some methods start ~$20–30 —
if so, accept the larger one-time fund rather than splitting). Transak is not an SC-registered
DAX — it is a licensed payment provider; funds go straight to your wallet, no exchange custody.

### Route C — SC-registered exchange, no P2P at all (licensing verified; stablecoin availability unverified)

Six SC-registered Malaysian DAXes exist (Dec 2025: Luno, Hata, MX Global, SINEGY, Kinetic/KDX,
Torum). These take direct MYR deposits via **FPX** — no P2P counterparty, local regulatory recourse:

- **Hata** (the primary SC option now) — dual SC + Labuan FSA licence, Bybit-backed; FPX deposit
  ~RM0.80 (instant); 0% maker / 0.10–0.40% taker; Instant Buy 1%. **Check in-app:** (a) is USDC
  live in your market list? (stablecoins "rotate in/out"); (b) which networks can USDC leave on?
  (marketed rails: BEP-20, TRC-20, SOL, Polygon — **Arbitrum not named**); (c) withdrawal min/fee.
  If USDC is live *and* Arbitrum is offered → best of both worlds (SC + FPX + direct delivery).
  If USDC is ERC-20/Polygon-only → an extra CCTP/DEX hop is needed.
- **Luno** — RMO-DAX since 2019; FPX deposit free ≥RM100 (RM1 below); **no USD stablecoin in MY**
  (USDC/USDT/PYUSD/EURC all restricted, official table 2026-09-06). Usable only as the ETH leg of
  the fallback below.

**Fallback (servable once Luno verification clears — Luno MY is itself in a verification queue as
of 2026-09-06; more legs):** buy **ETH on Luno** (available MY) → withdraw
to Rabby on Ethereum mainnet → bridge to **Arbitrum** (canonical bridge) → Rabby holds Arbitrum
ETH → **swap ETH → native USDC** on Uniswap/Camelot (cents of gas on Arbitrum). Fees: Luno 2%
instant-buy (or ~0.25% on the Exchange), Luno's mainnet withdrawal network fee, one DEX swap. More
legs and failure modes than Route D — use only if Routes D and C both fail.

## 5. Collision to decide before the live verify

Hyperliquid's venue-side **minimum order value ≈ US$10**, while PICC's `trading:ccxt` envelope
caps notional at `maxExposureUsd: 10` (`policyGraphCatalog.mjs`). Two carriers:

- **Carrier B (default):** user places the ~$10 order manually on Hyperliquid; PICC read-only
  verifies it. No code change, no collision.
- **Carrier A:** PICC places the order end-to-end. Requires raising `maxExposureUsd` to ~**$15**
  — an owner decision, recorded as the gate-5A note explaining why the envelope exceeds the
  reference exposure.

**Status: deferred to the scaling rung-1 gate (see §10).** The first live verify uses **Carrier B**
(manual placement + read-only verification) to collect baseline evidence; **Carrier A** with the
$15 envelope is rung 2, approved only on clean rung-1 evidence. Deferred, not decided — the owner
can override at any rung.

## 6. Running the wizard

From the repo root, Git Bash:

```bash
./scripts/hyperliquid-connect.wizard.sh
```

Or from PowerShell (note: `bash` on PATH is the WindowsApps WSL shim — always use the Git Bash
path):

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts\hyperliquid-connect.wizard.sh
```

Stages (each gated, reporting observed state):

1. **Fund** — verifies ≥ US$10 USDC reachable for the Hyperliquid deposit (per §4).
2. **API wallet** — create at `https://app.hyperliquid.xyz/API`; Reading + Trading ON,
   Withdrawals OFF; copy the one-time private key.
3. **`.env` health check** — `ENV_FILE=apps/dashboard/.env` (repo-root-relative); sets
   `PICC_CCXT_WALLETADDRESS_HYPERLIQUID` + `PICC_CCXT_PRIVATEKEY_HYPERLIQUID`; refuses half-set
   pairs; confirms sandbox flags are off. Server restart required after edits (config loads `.env`
   at boot).
4. **Read-only proof** — Command Centre proposal for `hyperliquid PURR/USDC` (UI: Command Centre →
   Orders → propose). **Do NOT execute** — this is a gate-check only, venue untouched. Expected:
   green gates with a fresh reference price + equity, and the overview `trading:ccxt` feed gains an
   equity row. If the reference is unpriced/stale, the gate reports the honest block instead.

## 7. After the proof: live verify

Carrier B: user places the ~$10 PURR/USDC order on Hyperliquid manually → PICC read-only verify →
report gate truth. Carrier A per §5 if the owner chooses automation.

## 8. Safety rules (non-negotiable)

- The API-wallet credential PICC holds can **never** withdraw. Re-check the toggle if the wizard
  ever warns about it.
- `.env` is gitignored; never commit credentials, never paste a private key in chat.
- Every execution still goes through the full 10-gate chain + envelope; nothing bypasses it for
  "it's only $10."
- Unconfigured ≠ zero-filled: any status PICC reports is observed state, never a default.

## 9. Current state (2026-09-06)

- ✅ ccxt seam supports Hyperliquid wallet-key mode — probed against installed ccxt 4.5.74
  (`requiredCredentials: walletAddress+privateKey`; `setSandboxMode`, spot, defaultType verified).
- ✅ 4 fixture tests added; suite **1,884 passing / 0 failing** (re-verified 2026-09-06); typecheck clean.
- ✅ Wizard built and syntax-checked (`bash -n`); shellcheck not installed on this machine.
- ✅ Funding research done (evening update): Bybit + MEXC both refuse signup for this user
  (offshore P2P class closed for MY in 2026); Luno MY has **no USD stablecoin** (official table);
  **Transak verified** — MY card/Apple Pay/Google Pay → native USDC on Arbitrum ($2–4%
  card fee). Region question **resolved**: Luno signup accepted ⇒ Malaysian resident confirmed.
- ✅ **User confirmed Route D (2026-09-06):** transak → Arbitrum → ccxt. **Both Transak and Hata
  KYC are now system-side blocked** for this user (docs submitted correctly; support tickets open;
  hours-class response on both). User is waiting on both queues — first to deliver ≥$10 USDC on
  Arbitrum wins; the other ticket gets closed. Failure-signature note: if both vendors' tickets
  name the *same* failing step (liveness / upload / data-match), that is one root cause with one
  fix. **Corrected (2026-09-06):** Luno verification is *also* pending — the "no-queue" claim is
  retracted; and Hyperliquid API-wallet authorization empirically requires a **funded main
  account** (user's result: dead end at API-wallet creation until deposit), so the "front-load"
  advice is retracted too — the wizard's fund-first ordering (§6) is correct and unchanged.
  **MoonPay does not serve MY yet** ("Coming soon to your region", 2026-09-06) — card on-ramp
  class for MY is fully closed except Transak (Coinbase Onramp N/A; MoonPay pending-region).
  The funding map is now fully enumerated; the project is blocked *only* on the three queues
  (Transak / Hata / Luno). First queue to clear wins. Queue-bypass tactics (duplicate on-ramp
  accounts, VPN-region tricks) are off-limits — funds-freeze risk.
- ⚠️ **Updated (2026-09-06, user report):** Transak KYC cleared — but the payment leg is now the
  blocker: the owner's bank **auto-rejects the deposit transaction**, so no card funds can reach
  Rabby via Transak's rail. The "first queue to clear wins" rule no longer closes the map:
  Transak is out unless a different instrument (Apple Pay, another card) passes the bank's filter.
  Hata + Luno tickets stay open — both are MY-local rails, and it is UNKNOWN whether the same
  bank filter applies to them (owner will test one local rail). The live-rails project remains
  blocked on ≥$10 USDC sitting on Arbitrum in Rabby.
- ✅ **Funding route decided (2026-09-06):** Route B — owner's bank account rails for this one-time
  fund (§4). Scaling responsibility delegated to the PICC executor under §10 discipline.
- ✅ **Hata KYC cleared + first funded balance (2026-09-11, user report):** the user deposited via
  **eWallet** (worked flawlessly; the *bank* has issues with it — but the user does not need
  bank↔eWallet transfers, so the bank is out of the loop entirely) and the wallet shows
  **RM60.08**. This is the **first cleared rail** (Transak card rail was bank-blocked; Luno
  verification is still queued). **Correction (2026-09-11):** the earlier claim that "the bank
  accepted the FPX deposit on Hata" is WRONG — the funded rail was the eWallet, not FPX, and the
  Transak-class bank-filter question is moot for funding because eWallet→Hata has no bank in the
  loop. Future top-ups = eWallet deposits (RM2–1k, ~1.5% convenience fee), repeatable and cheap.
- ⚠️ **Hata pair list observed (2026-09-11, user paste): ~90 MYR-fiat pairs, ZERO stablecoins.**
  No USDC, no USDT, no DAI — the full list is XXX/MYR pairs (BTC, ETH, BNB, XRP, SOL, TRX, HYPE,
  DOGE, LINK, ADA, … FIL; HYPE/MYR is listed). Route C's "buy USDC on Hata" branch is therefore
  **dead at the asset level** — stablecoins are not listed at all, not just rotated out.
  What survives is the **ETH-leg fallback on Hata** (buy ETH → withdraw → bridge → swap), which
  becomes the **lead rail**: SC-regulated, eWallet-proven, KYC-clear. A 1% Instant Buy on ETH
  (or 0.40% taker on the Exchange) + the ETH withdrawal network fee + mainnet→Arbitrum bridge
  ($2–6 class via Across/CCTP per 2026 sources) + one Arbitrum DEX swap — see the
  "ETH-leg landing math" entry below for the current numbers.
  Third-party estimate (cryptowisser, 2026) puts Hata crypto-withdrawal fees in a ~$10–20/transaction
  class — treat as an upper-bound caution, verify the actual ETH send fee in-app before buying
  (superseded by in-app observation, see next entry).
- ✅ **Hata ETH send page (2026-09-11, user report):** min withdrawal **0.00398508 ETH**
  (≈ US$8.4), overall network fee **0.00036 ETH** (≈ US$0.76). The fee is far below the
  cryptowisser $10–20 caution — that caution is now superseded for ETH by in-app observation.
- ⚠️ **ETH-leg landing math (2026-09-11):** with RM60.08 (≈ US$12.6) buying ETH at Exchange
  taker 0.40% → ~0.00598 ETH → −0.00036 ETH send fee → ~0.00562 ETH (≈ $11.1) → mainnet→Arbitrum
  bridge + ETH→USDC swap (−$2…−$6) → **lands ~$5–9 native USDC on Arbitrum**. That clears the
  5 USDC Hyperliquid deposit minimum in most fee scenarios but NOT the ~$10 venue-minimum order,
  and leaves only ~2.4× the 0.00398508 ETH min-withdrawal. **Decision: top up ~RM35–40 via
  eWallet to ~RM96–100 total** → ~0.0096 ETH ≈ $20 → lands ~$13–17 → deposit min ✓, venue-min
  order ✓, buffer ✓ (matches §4 target ~US$12–15). Buy at Exchange taker 0.40%, NOT Instant Buy
  1% (2.5× more).
- ✅ **Top-up done (2026-09-11, user report):** balance now **RM100**; step 1 of the blocked list
  below is complete. User confirmed the step-2 route: buy ETH on the Hata **Exchange/spot** at
  taker 0.40% (not Instant Buy 1%), near-full balance (~RM96–99) — orderbook route recorded.
- ✅ **Path 2 chosen (2026-09-11, owner decision):** the owner selected the **read-only proof
  path** — buy ETH → withdraw → bridge → swap to native USDC, then wizard stage-4 read-only
  proof (**propose, do NOT execute**). No live order this round; ~$13–17 stays as USDC on
  Arbitrum; only $2–6 in bridge fees is spent. Live $10 order deferred until losing it is
  comfortable for the owner (their only saved money; rung ladder protects scaling).
- ✅ **Step 2 executed (2026-09-11, observed trade):** spot buy filled on Hata Exchange —
  RM96.50 → **0.00946200 ETH** (display value ≈RM94.75). Effective rate ≈RM10,199/ETH vs the
  ~RM10,004 in-app quote — an **≈1.9% slippage/fee band** (spread + taker; exact decomposition
  UNVERIFIED — no per-line order ticket observed). Clears the 0.00398508 ETH withdrawal minimum
  by >2×. Step 3 next: withdraw 0.00946200 ETH to Rabby Ethereum mainnet (observed send-page
  fee 0.00036 ETH → expect ≈0.009102 ETH landing).
- ✅ **Step 3 landed (2026-09-11, observed):** Rabby wallet shows **$22.44 ≈ 0.0091 ETH** on
  Ethereum mainnet — withdrawal arrived, network fee charged (0.00946200 − 0.00036 ≈ 0.0091 ✓).
  Implied ETH price ≈ $2,466 — above the runbook's conservative assumption, so the landing
  estimate moves up: bridge + swap → **~$16–19 USDC** expected (comfortably above 5 USDC deposit
  min and ~$10 venue-min order).
- ⏳ **Step 4 (2026-09-11, refreshed process):** canonical deposit at **bridge.arbitrum.io**
  (verified 2026-08 docs): Rabby → From Ethereum → To Arbitrum One → ETH → Move funds.
  ⚠️ **Leave ~0.001–0.0015 ETH on mainnet for L1 gas** — the deposit tx is paid in mainnet ETH;
  bridge ~0.0075–0.0081 ETH, keep the rest as the gas reserve. Then on Arbitrum swap ETH →**
  native USDC** (contract `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`) — NOT USDC.e
  (`0xff970a61a04b1ca14834a43f5de4533ebddb5cc8`), per the USDC-on-Arbitrum-One doc.
  **Direction trap (2026-09-11, observed):** Rabby's bridge panel defaulted the owner to
  From=Arbitrum → To=Ethereum+USDC — the reverse of what we need. Use the official bridge
  (bridge.arbitrum.io: From Ethereum → To Arbitrum One, ETH only), then swap on Arbitrum —
  two separate steps so the USDC variant stays controlled.
- ⏳ **Blocked on the owner (2026-09-11):** (4) bridge + swap (above); (5) run the wizard (§6) —
  fund, API wallet, `.env`, read-only proof; (6) execute the rung-1 live verify (Carrier B
  per §5/§10).
- ⚠️ **Scam advisory (2026-09-11, observed):** Rabby received an **unsolicited token** whose
  metadata points at **claim-usd.com** — a zero-footprint "claim USDC" domain (browser-integrity
  wall, no search trail, unannounced). Matches the documented fake-airdrop/dusting + wallet-drainer
  pattern (approve/Permit → sweep; e.g. $908K USDC delayed-drain case). Owner instructed: never
  connect the funded wallet to it, never sign anything there, hide the token in Rabby, and use no
  third-party revoke sites. Receiving the token is harmless; interacting is the entire attack.
- 🔧 **"Must deposit before performing actions" diagnosed (2026-09-11, verified):** API-key
  creation failed; Hyperliquid error cites `0xae1e1cc70f3207f6821f879d25c216f45fc4d6a2`.
  Verified via Hyperliquid info API (spot balances = 0, ledger updates = empty) and Arbitrum RPC
  (nonce = 0x1 = only the ETH→USDC swap; USDC balance 19.063422 present in Rabby). **The deposit
  transaction was never sent** — swap ≠ deposit. Fix: deposit via app.hyperliquid.xyz Deposit
  flow (Arbitrum, native USDC, same wallet), wait ~1 min, then re-create the API wallet. Do NOT
  raw-transfer USDC to the Bridge2 contract address.
- ✅ **Deposit done + API wallet created (2026-09-11, user report):** deposit executed via
  app.hyperliquid.xyz (Arbitrum, native USDC); Rabby address auto-appeared in API wallet
  settings. ⚠️ **API-wallet key TTL = 14 days (observed in app UI)** — the private key
  self-expires; credential renewal (new API wallet → update
  `PICC_CCXT_WALLETADDRESS_HYPERLIQUID`/`PICC_CCXT_PRIVATEKEY_HYPERLIQUID` → restart server)
  is a scheduled ~14-day operation. Safety-positive (stolen keys self-expire), but the server
  cannot run forever on one credential. **If the one-time private key was not captured at
  creation, create a NEW API wallet** — the old key is unrecoverable. Verify Withdrawals = OFF
  before `.env` (non-negotiable, §8).
- 🔧 **"Cannot use existing user address as agent" (2026-09-11, observed):** using the Rabby main
  address as the API-wallet (agent) address is rejected by Hyperliquid **by design** — an API
  wallet is a separately generated keypair. At `app.hyperliquid.xyz/API` click **Generate**: the
  app creates a fresh random agent address (the SDK asserts "you should not create an agent using
  an agent"); copy the one-time private key immediately (shown once, unrecoverable). Any earlier
  row whose "API Wallet Address" column shows your own Rabby address is a failed self-referential
  attempt — revoke it and Generate. `.env` semantics: `PICC_CCXT_WALLETADDRESS_HYPERLIQUID` =
  **main account** address (0xae1e1c…, "the account's public address must be used for info
  requests"), `PICC_CCXT_PRIVATEKEY_HYPERLIQUID` = **agent** private key (view/trade only, never
  withdraw). The Rabby wallet's own private key must never enter `.env` or any server; if it was
  ever pasted anywhere, treat it as exposed.
- ✅ **`.env` credential pair set (2026-09-11, verified):**
  `PICC_CCXT_WALLETADDRESS_HYPERLIQUID` = main account `0xae1e1c…d6a2`;
  `PICC_CCXT_PRIVATEKEY_HYPERLIQUID` = API wallet "PICC" agent key (agent address
  `0xdD49AD…` is NOT stored — ccxt derives the signer from the key; only the main
  account address goes in WALLETADDRESS, per the installed ccxt build where all
  hyperliquid reads default to `this.walletAddress`). Read-only probe passed:
  **equity read ok → 18.86 USDC** (Δ≈0.20 vs 19.0634 recorded right after the swap —
  exact composition UNVERIFIED, no trade witnessed between observations); key derives
  to the pasted agent address ✓. Server restart + wizard stage-4 read-only proof still
  pending. Agent-key authorization on the venue is only provable by a signed write —
  deferred to Carrier B live verify (path 2). **Security note: the agent key was
  pasted into chat (2026-09-11); bounded risk (no-withdraw key, 14-day TTL); owner may
  regenerate free at any time (Generate → update `.env` → restart).**
- 🔲 Slice 7 (ExpertOption ExpertBot demo logic) remains a future post-brainstorm, tracked
  separately from this runbook.

## 10. Scaling path (owner-delegated, discipline-gated)

**2026-09-06:** the owner delegated scaling responsibility to the PICC executor — "scale up with
discipline and everything we have accomplished so far." The delegation is scoped: scaling happens
**only through the existing gated mechanisms**, never by weakening them.

Non-negotiables (unchanged by delegation):

- Every envelope raise is an owner-visible step: `maxExposureUsd` change in `policyGraphCatalog.mjs`,
  a gate-5A note recording why, a CHANGELOG entry, adjusted tests, and a passing security review.
- The full 10-gate chain, honesty labels, and rate limiters are never weakened to enable a rung.
- Every status reports observed state; a rung climbs only on clean evidence from the rung before it.

Proposed ladder (amounts are a starting point, not a promise; the owner approves each rung):

| Rung | Envelope | Gate to climb |
|---|---|---|
| 0 (now) | $10 | Funding done (Route B), wizard stage-4 proof green |
| 1 | $10 | Carrier B live verify: 1 clean manual placement + read-only verify → baseline evidence |
| 2 | $15 | Carrier A (PICC-executed) — envelope must clear venue minimum ~$10; gate-5A note |
| 3 | $25 | Clean rung-2 history (no gate failures, no missed truth), audit trail intact |
| 4 | $50+ | Same, plus venue-level review (sanctioned automation, withdrawal-capable credential policy) |

Venue breadth (slice 7 ExpertOption demo logic, then further streams) is a **separate ladder** with
its own per-stream gates; it does not inherit envelope rungs.

---

## WS-1 perps rail — sandbox E2E

WS-1 appendix (additive): about the perps rail's live-testnet E2E only. It changes nothing stated
in §3/§5/§8/§9 about the spot `trading:ccxt` connect.

**What this is:** `apps/dashboard/server/__tests__/hyperliquidPerps.sandboxE2E.test.mjs` — a live
E2E that calls the REAL Hyperliquid testnet API (`api.hyperliquid-testnet.xyz`) through the perps
venue adapter `server/services/venues/hyperliquidPerps.mjs`. No mocks; orders are real testnet
orders. It is skipped on any machine without the credential pair, so the normal vitest floor stays
green.

**Credentials** — the SAME pair this runbook already documents (§3 API-wallet topology, §9 "`.env`
credential pair set"): `PICC_CCXT_WALLETADDRESS_HYPERLIQUID` = main account,
`PICC_CCXT_PRIVATEKEY_HYPERLIQUID` = API-wallet/agent key (view+trade, withdrawals OFF, ~14-day
TTL — refresh per §9). The perps rail introduces no new credential.

**Sandbox** — `PICC_CCXT_SANDBOX=1` (or `PICC_CCXT_SANDBOX_HYPERLIQUID=1`). The adapter is
testnet-first: without a sandbox flag every perps method returns
`{ok:false, reason:"perps-rail-off: …"}`. The only escape hatch is refusing loudly — never point
the E2E at mainnet values.

**Command**

```bash
cd apps/dashboard
npx vitest run __tests__/hyperliquidPerps.sandboxE2E.test.mjs
```

- With the credential pair + a sandbox flag set: the five steps run live (markets → equity →
  funding → submit+cancel → fill/close) and print `[ok]` / `[skipped: …]` / `[failed: …]` per
  step against `api.hyperliquid-testnet.xyz`.
- Without creds (or creds but no sandbox flag): the whole file skips on one visible reason line
  naming the credential + sandbox vars, and the run still exits green (ADR-0005 honest skip, no
  fabricated pass).

**Skip semantics**

- Full-file skip: creds+sandbox absent ⇒ `describe.skip` naming
  `PICC_CCXT_WALLETADDRESS_HYPERLIQUID` / `PICC_CCXT_PRIVATEKEY_HYPERLIQUID` /
  `PICC_CCXT_SANDBOX(=1)` (ADR-0005).
- Balance 0: the fill/close step reports a step-level `skipped` with the deposit-free string
  (`testnet balance 0 — deposit-free — fill/close not attempted`) and the suite still passes. No
  assertion fabricates a fill — a null `verifyFill` is reported as unobserved, never as filled.

**Mainnet requires the WS-3 ceremony** — `PICC_CCXT_PERPS_MAINNET_ENABLED=1` ALONE is still refused
by this codebase (WS-1 is testnet-only until the WS-3 ceremony enables live perps); the E2E keeps
that refusal and never targets mainnet.
