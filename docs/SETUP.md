# Setup

## Prerequisites

- Node.js 20+ and npm
- Python 3.10+ (optional — only for the CrewAI agents service)

## 1. Install dependencies

```bash
npm install
```

This installs the dashboard workspace (React, Vite, Supabase, plus the server-side `openai`,
`stripe`, `@supabase/supabase-js` packages). The extension installs separately (see step 5) so
Plasmo gets its own dependency tree.

## 2. Environment variables

Create the dashboard env file and fill in the real keys:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
```

The dashboard `.env` is loaded by **both** the Vite dev server and `npm run serve` (production
server). Everything without a `VITE_` prefix stays server-side only — it never reaches the browser.

| Variable | Purpose | Where to get it |
| :-- | :-- | :-- |
| `VITE_SUPABASE_URL` | Auth + persistence | Supabase project → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Auth + persistence | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Billing sync writes to `profiles` (server-only) | Supabase → Settings → API → Service role |
| `GEMINI_API_KEY` | LLM #1 (recommended, most generous free tier) | aistudio.google.com/apikey |
| `GROQ_API_KEY` | LLM #2 (failover) | console.groq.com/keys |
| `MISTRAL_API_KEY` | LLM #3 (failover) | console.mistral.ai |
| `CEREBRAS_API_KEY` | LLM #4 (failover, optional) | cloud.cerebras.ai |
| `LLM_PROVIDERS` | Failover order (default `gemini,groq,mistral,cerebras,openai`) | — |
| `SERPER_API_KEY` | Live Google News/Search research (server-only) | serper.dev |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal checkout (server-only) | developer.paypal.com → Apps & Credentials |
| `PAYPAL_MODE` | `sandbox` (default) or `live` | — |
| `EWALLET_TNG_NUMBER` | Your receiving number for manual e-wallet payments | your Touch 'n Go number |
| `BTCPAY_URL` / `BTCPAY_API_KEY` / `BTCPAY_STORE_ID` | Self-hosted crypto checkout (optional) | your BTCPay instance |
| `SP_AMAZON_CLIENT_ID` / `SP_AMAZON_CLIENT_SECRET` / `SP_AMAZON_REFRESH_TOKEN` | Amazon SP-API app credentials (optional) | Seller Central → Partner Network → Develop Apps |
| `SP_AMAZON_ACCESS_KEY` / `SP_AMAZON_SECRET_KEY` | AWS SigV4 signing for SP-API (optional) | AWS IAM keys for the SP-API role |
| `SP_AMAZON_MARKETPLACE` | Country code for competitor data (default `US`) | e.g. `MY`, `SG`, `GB`, `DE`, `JP`, `AU`, … |
| `STRIPE_SECRET_KEY` | Stripe billing, optional alternative (server-only) | dashboard.stripe.com → Developers |
| `STRIPE_WEBHOOK_SECRET` | Verifies webhook signature (server-only) | `stripe listen` or Stripe dashboard |
| `VITE_STRIPE_PRICE_PRO` | Price ID for the $19/mo plan | Stripe → Products & prices |
| `VITE_STRIPE_PRICE_BUSINESS` | Price ID for the $49/mo plan | Stripe → Products & prices |
| `PICC_AGENTS_URL` | URL of the CrewAI microservice (optional) | `http://localhost:8000` |

**Hybrid cloud LLM (no card needed).** The backend tries every provider you've added a key for, in
order, and fails over automatically on rate limits or outages; if all are down it falls back to the
honest local engine. All four are free to start: Gemini Flash (~1,500 req/day), Groq (~1,000
req/day), Mistral free tier, and Cerebras free tier — none require a credit card. Add just one key
(e.g. `GEMINI_API_KEY`) to go live.

Provider behavior:

- **Yahoo Finance** needs no key — real price history feeds the Monte Carlo engine automatically.
- **Gemini / Groq / Mistral / Cerebras / OpenAI**: when any key is present, that provider joins the
  rotation; when none are present, the app degrades to an honest, clearly-labelled local engine.
- **Serper / Stripe / PayPal / BTCPay**: when a key is present, that feature is fully live; when
  absent, it degrades honestly (manual e-wallets need no key at all).

**Amazon competitor intel (optional).** The Listing Optimizer gains a "Competitor intel" panel that
searches for your keyword/ASIN and returns real prices, products, and brands. There are two honest
sources:

- **Free path (no card, no Amazon account) — just add `SERPER_API_KEY`.** The panel uses Google
  Shopping (via Serper) to show live products, prices, and retailers for your keyword. Verified
  live: `yoga mat` → 10 real products with prices (Amazon Basics $10.54, Manduka $144, …).
- **Full path (Amazon's own data)** uses the Selling Partner API: buy-box prices, lowest price, and
  offer counts from the Catalog + Pricing APIs. **Important — Amazon genuinely requires a
  Professional seller account ($39.99/month + a credit card) for SP-API access**; individual/free
  seller accounts are not eligible. If you want this later, register in Seller Central → Partner
  Network → Develop Apps and put the LWA + IAM keys in `apps/dashboard/.env`.

Without either key, PICC shows an honest "not configured" note — it never fabricates competitor data.

**If SP-API's card requirement is a hard blocker, other no-card options** (beyond the free Serper
path above) you can plug in later: Apify's Amazon actor (free tier ≈ 1,666 products/month, no
account/login), Keepa API (free tier), or the Logimu/WDES product APIs (2,500 free credits, no
card). All give real Amazon prices/offers without a seller account.

## 3. Supabase

1. Create a project at supabase.com.
2. Open the SQL editor and run `infra/supabase/schema.sql`.
3. Then run `infra/supabase/v2.sql` to add the income-classification tables
   (financial_accounts, income_streams, nft_holdings, depin_nodes,
   agent_configs/earnings/bounties, predictions, human_review_logs).
4. Enable auth providers (Email/Password, and optionally Google OAuth) in Authentication → Providers.

## 4. Run the dashboard

One command for everything (build if stale, start the server, then a live status
panel covering BTCPay node sync, agents, and the provider matrix):

```bash
npm run start:all
```

Options: `--port 8080`, `--force-build`, `--n8n` (also `docker compose up` the
orchestrator in `infra/n8n`).

For development with hot reload instead:

```bash
npm run dev
```

Open http://localhost:5173. The Vite dev server runs the same `/api/*` backend as production.

## 5. Run the browser extension

The extension has its own `node_modules` (Plasmo requires its own install). From `apps/extension`:

```bash
npm install        # installs plasmo + react in apps/extension
npm run dev        # build in watch mode (dev)
```

Load the generated `build/chrome-mv3-dev` folder via chrome://extensions (Developer mode → Load unpacked).

For production: `npm run build` and load `build/chrome-mv3-prod`. To produce a zip for the store: `npm run package`.

> Note: the repo root uses npm workspaces for the dashboard. The extension is intentionally installed
> separately so Plasmo gets its own dependency tree.

## 6. Payments — no bank, no business needed

PICC takes four payment paths; money lands in **your** wallet directly. No business registration
and no bank verification required. All are optional — enable whatever you want in
`apps/dashboard/.env`:

| Method | Setup | Notes |
| --- | --- | --- |
| **PayPal** | `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` from developer.paypal.com → Apps & Credentials (works on a personal account) | Automated checkout, server-side capture, `PAYPAL_MODE=sandbox\|live` |
| **Touch 'n Go** | `EWALLET_TNG_NUMBER` (your receiving number) | Manual e-wallet: customer sends the exact amount + reference, then enters their confirmation code. No gateway, no fees, no KYC. |
| **BTCPay Server** | `BTCPAY_URL=http://127.0.0.1:23000`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID` | Self-hosted, open-source, no KYC. Invoice status is checked server-side on return. Node status (sync + reachability) is shown on the Dashboard. |
| **Stripe** | `STRIPE_SECRET_KEY` + prices + webhook | Still supported if you prefer it: `stripe listen --forward-to http://localhost:5173/api/stripe/webhook`, create $19/$49 recurring prices, set `VITE_STRIPE_PRICE_*`. Test card `4242 4242 4242 4242`. |

When a payment completes, the backend writes `profiles.subscription_tier` / `subscription_status`
and records an audit row in `payment_orders` (Supabase). The `/pricing` page shows only the methods
you configured; manual e-wallets are always available.

**BTCPay wiring for the bundled node.** The dashboard already knows how to create invoices and
verify them on return (`/api/btcpay/*`). To go live with the local node at `http://127.0.0.1:23000`:

1. Open http://127.0.0.1:23000 and log in as the server admin.
2. Create a store (or open the existing one). Copy its **Store ID** (Store Settings → General).
3. Store Settings → Access Tokens → *Create token* with the `btcpay.store.canviewinvoices`
   and `btcpay.store.cancreateinvoice` permissions, then *Request* it. Copy the **API key**.
4. Put both in `apps/dashboard/.env`:
   ```bash
   BTCPAY_URL=http://127.0.0.1:23000
   BTCPAY_API_KEY=your-api-key
   BTCPAY_STORE_ID=your-store-id
   ```
5. Restart the server (`npm run start:all`). The Dashboard's System status card shows the node as
   **synced** and `/pricing` reveals the "Pay with Bitcoin" button.

> The node must be synchronized to the blockchain before invoices can be paid. If the card shows
> "syncing", leave the node running — no action is needed.

## 7. CrewAI agents (optional)

```bash
cd agents/picc_agents
python -m venv .venv
.\.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env            # add OPENAI_API_KEY, SERPER_API_KEY
uvicorn server:app --port 8000  # serve the microservice
```

Then set `PICC_AGENTS_URL=http://localhost:8000` in `apps/dashboard/.env`. The Agents page will
report the crew as online and let you run the live Researcher → Analyst pipeline. Without the
service, the Agents page still works but the "run crew" button is disabled.

Additional crews (same service, no extra setup):

- `PiccTradingCrew` — Trading Suite signal commentary (`POST /run/trading` or `python main.py trading`).
- `PiccInvestmentCrew` — DeFi/staking/NFT strategy (`POST /run/investment` or `python main.py invest`).

## 7b. Trading Suite

The Trading Suite needs **no keys**: the prediction engine runs on public market data.

- **Signals & paper ledger** — works out of the box (multi-model momentum / mean-reversion /
  regression / Monte Carlo ensemble with honest backtest-damped confidence). Persisted server-side
  in `apps/dashboard/server/data/`.
- **ExpertOption bridge (optional)** — read-only WebSocket client that shows your balance, profile,
  and candles for assets you already own on ExpertOption. It never places, modifies, or cancels a
  trade. To enable, set these in `apps/dashboard/.env` (values match your ExpertOption account):
  `EXPERTOPTION_USER_ID`, `EXPERT_OPTION_TOKEN` (a Personal Access Token from your profile). When
  unset, the Trading Suite still works in local/paper mode and labels itself honestly.
- To get AI commentary on a signal, point `PICC_AGENTS_URL` at the agents service and the Trading
  Suite will ask the trading crew (falling back to the local engine when the crew is offline).

## 8. Tests

```bash
npm run test        # vitest — engine, Yahoo stats, API handlers, client fallback
npm run typecheck   # tsc --noEmit
```

## 9. Verify end-to-end

- Dashboard: `npm run dev`, run a Financial Twin simulation — it should show the real fund name,
  last price, and a 5-year sparkline (live Yahoo data). Generate content with `OPENAI_API_KEY` set
  to see live research sources. Open Trading → Predict to see a live multi-model signal.
- Extension: open an Amazon product page, wait for the overlay, exercise the 5-second human-review
  timer and copy button.
- Agents: with the microservice running, Agents → Run research crew produces a CrewAI report; Trading
  Suite → Ask AI returns trading-crew commentary.
- n8n (optional): after importing the templates in `infra/n8n/workflows/`, POST to `/webhook/trading-signal`
  with `{"asset":"BTC-USD","horizon":"5m"}` — the signal + commentary are written to Supabase.
- Billing: enable PayPal (sandbox) or a manual e-wallet, upgrade to Pro, and check the Profile page
  shows `pro / active`. For e-wallets, complete the "I've paid" step to self-verify.

## 8b. Production deployment

The dashboard ships a real backend: build `dist/` and serve the whole app (SPA + `/api/*`) from
the Node server. A plain static host renders the UI but the `/api` features (simulator, content,
billing, automator) need this server. Three equivalent ways to run it — see
`infra/dashboard/README.md` for the full walkthrough.

**Option 1 — Docker (recommended):**

```bash
npm run build   # optional; the Dockerfile builds it for you
docker compose --env-file apps/dashboard/.env -f infra/dashboard/docker-compose.yml up -d --build
```

Serves on port 3000 (`PICC_PORT` overrides), secrets from `apps/dashboard/.env` (never baked into
the image), and persists runtime data (`server/data/` — automator credentials, agent logs, presence)
in the `picc-data` volume.

**Option 2 — PM2 (bare Node):** `npm run build` then
`pm2 start infra/dashboard/ecosystem.config.cjs` (Node ≥ 22 required).

**Option 3 — systemd (bare Node):** install `infra/dashboard/picc-dashboard.service` and set its
`WorkingDirectory` to the absolute path of `apps/dashboard`.

**Reverse proxy (any option):** put nginx/Caddy in front for TLS; the backend is same-origin only,
so no CORS setup is needed.

Production checklist:

- Stripe (if used): switch to live keys, point the webhook secret at your live endpoint, set
  `PICC_APP_URL` to the production origin, and add the production URL to Stripe's allowed domains.
- Payments: for PayPal set `PAYPAL_MODE=live` with a live REST app; for BTCPay point the URL at your
  VPS instance (expose it on HTTPS).
- Extension: `npm run package` then upload the zip to the Chrome Web Store ($5 one-time developer fee).
  Before going to production, add your real dashboard origin to `host_permissions` in
  `apps/extension/package.json` (the `manifest` field) and set it as the popup's dashboard URL.
- Domain: register via Cloudflare/Namecheap and point at the frontend host.
- Amazon SP-API (optional): without keys the Listing Optimizer uses live Serper Google Shopping
  results (free). For SP-API buy-box data, fill the five `SP_AMAZON_*` vars in `apps/dashboard/.env`
  (Professional seller account required — see the comments in `.env.example`).

## 10. Option A — Mainnet on a free-forever Oracle Cloud VPS

> **Status for this project:** ABANDONED. Your tenancy's home region (Malaysia West 2, Kulai)
> denies Always Free resources (the console estimates ~$15+/mo for a 160 GB boot volume, i.e.
> the free block-storage allotment is not applied there), and the home region is fixed at
> signup. If you ever open a new Oracle account in an Always Free region, everything below
> still applies. **This project uses Option B (§11): the node runs on your own PC.**

This replaces the local **testnet** node with a real **mainnet** node that runs 24/7 on a
free-forever Oracle Cloud **Ampere A1** VM (Always Free: currently **2 OCPU / 12 GB RAM** /
200 GB storage — Oracle reduced the older 4/24 allowance). Costs: **$0/month, forever**. No
domain purchase needed (free DuckDNS subdomain) and HTTPS is automatic (Let's Encrypt). The
Bitcoin node is **pruned to ~100 GB** so it fits the free storage.

Everything needed is in `infra/btcpayserver-vps/` (the deploy script generates the DuckDNS
auto-updater, installs Docker, runs the official BTCPay install, and adds a `dbcache=4096`
tuning fragment so the 12 GB box syncs at a good pace).

> **One honest caveat:** Oracle's signup requires a debit/credit card for *identity verification
> only* — Always Free resources are never charged. There is no free-forever VPS that can run a
> Bitcoin node without this step.

### 10.1 Create the Oracle account (once)

1. Go to **oracle.com/cloud/free** → **Start for free**.
2. Enter your details + email, click the verification link in the email.
3. Verify your phone (OTP).
4. Enter a debit/credit card — used **only** to prove you're human; nothing is charged. A tiny
   temporary hold may appear and is automatically released.
5. **Choose your home region carefully** (it's permanent). Pick one with Ampere A1 capacity — the
   Always Free resources page inside the console shows current availability per region.
6. Sign in to the OCI console.

### 10.2 Create the VM (one-time, ~10 min)

1. Console → **Compute → Instances → Create instance**.
2. **Confirm the region menu (top-left) shows your HOME region** — Always Free compute and
   storage only apply there. Then tick **"Always Free eligible only"** so the dialog only offers
   free resources. The monthly estimate must read **$0.00**; if it shows a fee, stop and fix the
   region/shape/volume (see §10.11) before continuing.
3. Name: `btcpay`. Image: **Ubuntu 24.04 LTS** (or 22.04 LTS).
4. Shape: choose **VM.Standard.A1.Flex** (Ampere ARM). Configure **2 OCPU / 12 GB RAM** — the
   current Always Free maximum after Oracle's limit change (the console will show a banner;
   ignore any "Upgrade" prompt).
5. **Boot volume**: click *Edit* and set size to **160 GB** and performance to **Balanced** — this
   stays within the 200 GB Always Free block-storage allowance and gives the 100 GB-pruned chain
   room to breathe.
6. Networking: accept the default VCN; make sure **"Assign a public IPv4 address"** is on
   (ephemeral is fine — DuckDNS keeps the subdomain updated). *Optional $0 trick:* if Oracle is
   billing you for the public IP, leave it **off** and use `NETWORK_MODE=cloudflare` (§10.12)
   instead.
7. SSH keys: upload your public key (`ssh-keygen` on your PC first if you don't have one).
8. **Create instance** and wait for the *Running* state.

### 10.3 Open the firewall (ports 80 / 443 / 22)

1. In the console: **Networking → Virtual cloud networks** → your VCN → **Security Lists** →
   *Default Security List* → **Add Ingress Rules**.
2. Add three rules, all with Source `0.0.0.0/0`:
   - TCP **22** (SSH — often pre-opened)
   - TCP **80** (HTTP — required for Let's Encrypt)
   - TCP **443** (HTTPS)

(Inbound Bitcoin P2P `8333` is *not* needed for a pruned BTCPay node.)

### 10.4 Create the DuckDNS subdomain (free, ~2 min)

1. duckdns.org → sign in (free; supports OAuth or a plain registration).
2. Click **add domain**, e.g. `sharvin` → you now own `sharvin.duckdns.org`.
3. Copy the **token** shown on the account page.

### 10.5 Deploy (one command on the VPS)

From your PC, copy the kit and log in:

```bash
scp -r infra/btcpayserver-vps ubuntu@<VPS_PUBLIC_IP>:/home/ubuntu/
ssh ubuntu@<VPS_PUBLIC_IP>
sudo cp -r btcpayserver-vps /root/ && cd /root/btcpayserver-vps
sudo nano deploy.sh     # fill in BTCPAY_HOST, LETSENCRYPT_EMAIL, DUCKDNS_DOMAIN, DUCKDNS_TOKEN
sudo bash deploy.sh
```

The script: installs Docker → (duckdns mode) installs the DuckDNS auto-updater (systemd, every
5 min, forever) → clones the official `btcpayserver-docker` → runs its installer with
*mainnet + nginx + Let's Encrypt + pruned node + resource caps* → prints next steps.
Re-running it is safe. For the no-public-IP tunnel setup, set `NETWORK_MODE="cloudflare"` +
`CLOUDFLARE_TUNNEL_TOKEN` in deploy.sh instead (§10.12) — then the firewall section (§10.3) and
DuckDNS (§10.4) are skipped entirely.

### 10.6 Wire up the dashboard (one-time, needs your browser)

1. Open **https://yourname.duckdns.org** (first certificate issue can take a minute or two after DNS
   resolves).
2. First login: create your admin password and **enable 2FA** — this instance is on the public
   internet.
3. **Store Settings → General**: copy the **Store ID**.
4. **Server Settings → Access Tokens → Create API Key**: grant store rights (view invoices +
   create invoice), copy the key.
5. On your PC, replace the placeholders in `apps/dashboard/.env`:
   ```bash
   BTCPAY_URL=https://yourname.duckdns.org
   BTCPAY_API_KEY=<key from step 4>
   BTCPAY_STORE_ID=<store id from step 3>
   ```
6. Restart the dashboard (`npm run start:all`). The System status card shows the node as reachable;
   **synchronized** flips to true when the mainnet sync finishes.

### 10.7 Mainnet sync expectations

**Confirmed: it's a one-time setup.** The initial block download (~600 GB downloaded, pruned to
~100 GB on disk) runs once. After it finishes the node stays current automatically — reboots,
container restarts, and BTCPay updates never re-sync it (data persists in Docker volumes). The
only ways to trigger a fresh sync are deleting the volumes or switching networks. So: one busy
week, then forever.

- On the free A1 VM (2 OCPU/12 GB, dbcache 4096 MB) expect **2–5 days** of initial sync. The
  official installer sets the `assumevalid` checkpoint automatically, so old blocks are trusted
  and validation is fast.
- Progress: `sudo docker exec btcpayserver_bitcoind bitcoin-cli getblockchaininfo`
  (watch `verificationprogress`), or just watch the dashboard card.
- Once `verificationprogress` reaches 1.0, run `sudo bash tune-after-sync.sh` — it drops
  bitcoind's cache to 512 MB and frees ~3.5 GB of RAM permanently.

### 10.8 Stop the old local testnet node (only if you use the VPS)

Not needed for this project (Option B converts the local node to mainnet — see §11). For
completeness, if you ever run the VPS path instead, stop the local testnet stack with:

```bash
docker compose --env-file infra/btcpayserver/.env -f infra/btcpayserver/btcpayserver-docker/Generated/docker-compose.btcpay-server.yml down
```

Keep or delete `infra/btcpayserver/` afterwards; the VPS is now authoritative. Your app data
(auth, profiles, payment orders) lives in Supabase — unaffected by this migration.

### 10.9 Updating / operating the VPS node

```bash
ssh ubuntu@<VPS_PUBLIC_IP>
sudo btcpay-update.sh     # update BTCPay to the latest release
sudo docker ps           # check containers
```

To move the subdomain to a new IP (e.g. after recreating the VM), DuckDNS updates itself via the
systemd timer — no manual step.

### 10.10 Resource optimization (already built into the kit)

The deploy runs the whole stack inside hard budgets so nothing can starve the 2-OCPU/12 GB box:

| Container | Memory cap | CPU cap | Why |
| --- | --- | --- | --- |
| `bitcoind` | 6 GB | 1.5 | IBD cache (`dbcache=4096`) + small `maxmempool=100` |
| `btcpayserver` | 1 GB | 1.0 | web app + invoice engine |
| `nbxplorer` | 768 MB | 0.5 | block explorer |
| `postgres` | 512 MB | 0.5 | BTCPay's DB |
| `nginx` | 256 MB | 0.25 | HTTPS reverse proxy |

Plus: a 4 GB swapfile (`vm.swappiness=10`) as an OOM safety net, and after sync
`tune-after-sync.sh` drops bitcoind's cache to 512 MB to free ~3.5 GB permanently.
If you ever add other apps to the VM, the caps above guarantee they still get CPU/RAM.

### 10.11 The always-free reality (be honest with yourself)

**Oracle Always Free, correctly configured, is the only working "free forever" VPS that can run
a Bitcoin mainnet node.** GCP/AWS/Azure free tiers are far too small (1 GB RAM / 30 GB disk).
Two hard rules decide whether it's $0 or billed:

1. **It must be in the tenancy's HOME region.** Always Free compute AND block storage only apply
   in the home region. A boot volume in any other region is billed at full rates (roughly
   $0.09–0.10/GB/mo → 160 GB ≈ $15+/mo — exactly the jump you saw). If your console shows
   $2.76 with defaults / $15+ at 160 GB, you are almost certainly not in the home region (or the
   free storage is already consumed). Confirm: top-left region menu = your home region.
2. **Shape + storage must be within the limits.** Since 2026-06-15 the free tier gets
   **2 OCPU / 12 GB** on A1.Flex (PAYG tenancies reportedly keep 4/24) and **200 GB** total block
   volume (boot + data combined). Free accounts that exceed these get instances *shut down*
   (not billed); PAYG accounts get billed for the overage.

The reliable gate: in the Create instance dialog enable the **"Always Free eligible only"** filter,
pick the A1.Flex shape at 2 OCPU / 12 GB, boot volume **Balanced** performance at 160 GB, and
verify the monthly estimate reads **$0.00** before clicking Create. If it doesn't, stop — the
region or account state is wrong.

- **Public IPv4 fee**: Oracle now bills public IPv4 addresses. Free-tier instances appear
  (for now) exempt, but the $0-guaranteed setup is a VM with **no public IP** at all, reached via
  a **Cloudflare Tunnel** — see §10.12.
- If Oracle still won't reach $0 for you, there is **no other always-free VPS** for this
  workload. The genuinely-free fallback is your own PC (the node it already runs): $0 forever,
  auto-restarts on reboot, but only runs while the PC is on.

### 10.12 Exposing BTCPay for $0 (the two NETWORK_MODE options)

`deploy.sh` now has `NETWORK_MODE` (default `duckdns`), set at the top of the script:

**`NETWORK_MODE=duckdns`** — the VM has a public IP, `yourname.duckdns.org` points at it, and
Let's Encrypt issues the cert. Simplest; use it once Oracle shows $0.00.

**`NETWORK_MODE=cloudflare`** — the VM has **no public IP** (Oracle cannot charge you for one),
and `cloudflared` runs as a container that connects *outbound* to Cloudflare's edge, serving
`https://your.host`. Free on Cloudflare's free plan + free tunnel. Requirements:
- A domain whose DNS is hosted on Cloudflare (free plan). If you don't already own one, this is
  the one part that isn't free (~$10/yr) — in that case use the Tailscale alternative below.
- A Zero Trust **tunnel** (dashboard → Networks → Tunnels → Create), then set in deploy.sh:
  `NETWORK_MODE="cloudflare"` and `CLOUDFLARE_TUNNEL_TOKEN="<token>"`. Point the tunnel's public
  hostname at `http://nginx:80`.
- In Cloudflare DNS add `CNAME <your.host> <tunnel-id>.cfargotunnel.com`, and set the zone's
  SSL/TLS mode to **Flexible** or **Full** (BTCPay still provisions its own Let's Encrypt cert).
- No security list / ports needed at all (no public IP). SSH still works through Oracle's
  private networking.

**No domain at all?** Use **Tailscale** (free tier) instead: install it on the VM and on your PC,
`tailscale up` both, then access BTCPay over the private tailnet at
`https://<vm>.ts.net` — valid TLS included, $0, no public IP, no domain.

## 11. Option B — Mainnet on your own PC (zero cost, minimal resources)

The stack you already run locally (`infra/btcpayserver`) is switched to **mainnet** and tuned for
a **minimal footprint**, so the node runs quietly in the background of this PC instead of on a
VPS. Costs: **$0 forever** — it's your own hardware. Trade-off: it only runs while this PC is on.

### 11.1 What changed (already applied in this repo)

- `infra/btcpayserver/.env`: `NBITCOIN_NETWORK=mainnet` + `BTCPAYGEN_ADDITIONAL_FRAGMENTS`
  (`opt-save-storage-s;picc-mainnet`) so any future regeneration re-applies the same tuning.
- New fragment `docker-fragments/picc-mainnet.yml`: **mainnet `assumevalid`** (Core v29.2
  checkpoint, block 886157) so the one-time sync is fast, `dbcache=512`, `maxmempool=100`.
- `Generated/docker-compose.btcpay-server.yml`: same tuning baked in (hand-edit survives until
  you regenerate), plus **per-container memory/CPU caps** so the stack never starves the PC:

| Container | Memory cap | CPU cap | Notes |
| --- | --- | --- | --- |
| `bitcoind` | 2 GB | 2.0 | pruned to 50 GB, small mempool + cache |
| `btcpayserver` | 1 GB | 1.0 | web app + invoice engine |
| `nbxplorer` | 768 MB | 0.5 | block explorer |
| `postgres` | 512 MB | 0.5 | BTCPay's DB |
| `clightning_bitcoin` | 512 MB | 0.5 | Lightning (kept — see below) |
| `tor` / `tor-gen` | 256 / 128 MB | 0.25 / 0.1 | onion services |
| `bitcoin_rtl` | 256 MB | 0.25 | Lightning UI |

Why `prune=50000` (50 GB) and not smaller: you run Lightning, and pruning deeper than ~6 months
of blocks (`opt-save-storage-xs`/`xxs`) stops your node from seeing old channel funding
transactions. 50 GB is the smallest prune that keeps Lightning fully functional.

### 11.2 Start the mainnet stack (one command)

```powershell
docker compose --env-file infra/btcpayserver/.env `
  -f infra/btcpayserver/btcpayserver-docker/Generated/docker-compose.btcpay-server.yml `
  up -d
```

Mainnet data lands in a **fresh** area of the same Docker volume (`/data/mainnet`), so your old
testnet data is untouched. The one-time initial block download (≈600 GB downloaded, pruned to
50 GB on disk) takes **~3–7 days** at these minimal settings on an NVMe SSD.

### 11.3 Watch the sync

```powershell
docker exec btcpayserver_bitcoind bitcoin-cli getblockchaininfo
```

Watch `verificationprogress` → 1.0, then `blocks` should track the real chain height.

### 11.4 Finish BTCPay on mainnet + rewire the dashboard (one-time, browser)

Mainnet runs a **fresh BTCPay instance** (new Postgres database) — the testnet admin, store and
API key do not carry over. Do this once, in your browser:

1. Open **http://127.0.0.1:23000** → first login: set your admin password (local only, no 2FA
   strictly needed, but fine to enable).
2. **Store Settings → General**: copy the **Store ID**.
3. **Server Settings → Access Tokens → Create API Key**: grant store rights → copy the key.
4. In `apps/dashboard/.env` set `BTCPAY_API_KEY` and `BTCPAY_STORE_ID` to those two values
   (`BTCPAY_URL=http://127.0.0.1:23000` is already set), then restart the dashboard.
5. The dashboard's BTCPay card turns green once the node is synced (`verificationprogress` 1.0).

### 11.5 Operating the PC node

- **Start/stop**: same `docker compose ... up -d` / `down` commands. Docker Desktop starts the
  containers automatically whenever this PC is on (containers have `restart: unless-stopped`).
- **Updates**: from `infra/btcpayserver/btcpayserver-docker` run `./btcpay-update.sh` (Git Bash /
  WSL) and restart. If you ever **regenerate** the compose, the fragment env in `.env` re-applies
  the tuning automatically.
- **Freeing the testnet data** (optional): the old testnet chain is ~200 MB — leave it or delete
  the volume if you're confident you don't need it.
- **Even lower footprint (optional)**: drop Lightning entirely by regenerating with
  `BTCPAYGEN_LIGHTNING=` empty and pruning to 25 GB (`opt-save-storage-xs`). Only worth it if you
  never take Lightning payments.
