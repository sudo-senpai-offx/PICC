# PICC Algory Reverse-Engineering — Findings v1

Status: FINDINGS (source of truth for the trading-suite borrow list)
Source: `Algory_Setup_1.5.1.3.3.exe` (248 MB, VAGAFX LTD-signed PyInstaller bundle)
Extraction: `C:\Users\sharv\AppData\Local\Temp\opencode\re\algory-exe\Algory_Setup_1.5.1.3.3.exe_extracted\` (2511 files)
Plan: `docs/specs/PICC_ALGORY_REVERSE_ENGINEERING_v1.md`

Everything below is **observed from the extracted artifacts** — not inferred. Where something is a working hypothesis (strategy semantics, IPC), it is marked `[HYP]`.

---

## 1. What this is

Algory 1.5.1.3.3 is a Windows desktop trading system that drives **MetaTrader 5** (MT5). Three PyInstaller binaries plus a large readable web/UI layer:

| Binary | Size | Role (observed) |
|---|---|---|
| `Algory.exe` | 17.7 MB | Main dashboard (customtkinter desktop UI + bundled `web/` assets) |
| `Engine.exe` | 137.8 MB | Trading engine — the actual strategy execution core |
| `AlgoryHUD.exe` | 16.0 MB | Overlay HUD (WebView2 + pythonnet — hosts `web/algory_hud.html`) |

Runtime: Python 3.13 (python313.dll), PyInstaller ≥ 2.1 style layout, Tcl/Tk 8.6, OpenSSL 3 (libcrypto-3.dll).

**Key license/legal note:** the Python application code is protected by **PyArmor** (`pyarmor_runtime_011532` present in both `_algory/` and `_algoryhud/`). The `.pyc` files in `PYZ.pyz_extracted/` are PyArmor-encrypted — direct decompilation is not possible. All analysis below comes from the **readable residue**: the MQ5 expert advisor source, JSON configs, HTML/JS UI, and binary-level facts (file layout, bundled packages, embedded metadata).

---

## 2. Distribution architecture [HYP]

Three-process split observed from binaries + UI JS:

1. **Algory.exe (dashboard)** — desktop shell. Renders `web/algory_launch.html`, `web/algory_automation.html`, `web/algory_portfolios.html`, etc. via WebView2/customtkinter. Talks to MT5 through the engine and through file-based IPC.
2. **Engine.exe (engine)** — the strategy core. Implements the trade signal/bias/filter model (see §5 taxonomy), risk sizing, plan enforcement, and the MT5 command protocol (see §4). Secrets/keys live in the Python + JS layer (see §7).
3. **AlgoryHUD.exe (overlay)** — WebView2 overlay host. Loads `web/algory_hud.html` + `_hud_chrome.js` (342 KB) for a live terminal overlay showing positions/portfolios/quick-pick.

The `web/` directory (26+ files, 8-language i18n) is shared presentation content — the same pages are reachable from the dashboard and the HUD.

---

## 3. Artifact inventory (top level)

```
Algory.exe / Engine.exe / AlgoryHUD.exe   — 3 binaries
Algory_Pilot.mq5                            — MT5 Expert Advisor source (fully readable, §4)
duka_starter_seeds.json                     — 738 KB, 16 instrument seed families (§5)
factory_config.json                         — MT5 install paths, dev handle "tomre", FTMO Global
algory_version.txt / algory.logo.png / icon.ico / installer_hero.png
installer_setup.pyc / pyiboot01_bootstrap.pyc / pyimod*.pyc   — PyInstaller bootloader
PYZ.pyz (+ _pyz_extracted/)                 — payload bytecode (PyArmor-encrypted)
base_library.zip                            — stdlib
web/                                        — 26+ HTML/JS + 8 i18n json
_algory/        — dashboard deps: customtkinter, MetaTrader5, matplotlib, numpy, PIL,
                  pyarmor_runtime_011532, cryptography, bcrypt, zstandard, tornado, yaml
_algoryhud/     — HUD deps: pythonnet (clr_loader), webview (pywebview), MetaTrader5,
                  pyarmor_runtime_011532, numpy, psutil
```

Bundled package versions observed from dist-info: `cryptography-46.0.4`, `numpy-2.2.6`, `markupsafe-3.0.3`.

---

## 4. MT5 integration — the readable spec (Algory_Pilot.mq5)

This is the single most valuable artifact: a complete, commented MT5 Expert Advisor that mediates dashboard ↔ terminal. It **never trades itself** (`"Algory Pilot: opens/closes charts and attaches Algory EAs on command... Never trades itself."`).

### 4.1 File-based IPC protocol

- Commands: one file per command → `MQL5\Files\algory_pilot_cmd_<ms>_<nnn>.txt`
- Status: `algory_pilot_status.txt` refreshed every ~10 s
- Log: append to pilot log; Ledger: `algory_pilot_ledger.txt` scanned every 60 s
- **Write discipline:** temp-then-rename for commands (partial writes must not be read).
- **Read discipline:** command file is deleted **before** executing (`Delete BEFORE executing. If a command crashes the terminal, the command is not re-executed`) — crash safety against bad commands. Fully commented in the source.

### 4.2 Command vocabulary (verbatim from header comments)

```
OPEN|SYMBOL|TF|template.tpl      — open a chart on SYMBOL/TF and attach template.tpl
CLOSE|SYMBOL|TF|ExpertName       — close chart and detach the named EA
```

Sweep timer: 2 s for commands; 10 s status tick (with weekend market-close handling commented); 60 s ledger scan.

### 4.3 Status heartbeat fields (observed in code)

`login`, `live` (1/0), `autotrading` (TERMINAL_TRADE_ALLOWED), `build`, `ts`, `ledger` row count, `ledger_ts`, `balance`, `equity`, `currency`.

This is a clean, auditable bridge. **Borrow for PICC:** the pattern of (a) temp-then-rename command files, (b) delete-before-execute crash safety, (c) a separate status file with observed state (never derived), (d) heartbeat clock decoupled from trade clock. Our trading suite can adopt the exact same protocol shape for any broker adapter, or reuse the MT5 path directly (PICC already owns MetaTrader5 Python bindings in `_algory/`).

### 4.4 Broker facts

`factory_config.json`:
```json
{
  "experts_dir": "C:\\Users\\tomre\\AppData\\Roaming\\MetaQuotes\\Terminal\\81A933A9AFC5DE3C23B15CAB19C63850\\MQL5\\Experts",
  "compiler_path": "C:/Program Files/FTMO Global Markets MT5 Terminal/MetaEditor64.exe",
  "terminal_path": "",
  "terminal_portable": false
}
```
- Dev machine user: `tomre`; broker: **FTMO Global Markets MT5** (proprietary terminal path).
- `experts_dir` is a hardcoded absolute path — the installer must rewrite this or the user must configure it. [HYP: factory_config is a template the installer customizes.]

---

## 5. Strategy seed corpus — duka_starter_seeds.json (738 KB)

16 instrument/timeframe families, each an array of independently-tuned strategy configs:

| Family | TFs | # configs observed |
|---|---|---|
| AUDUSD | H2, H4 | 2 families |
| EURUSD | H2, H4 | 2 |
| GBPUSD | H1, H4 | 2 |
| USDCAD | H1, H2, H4 | 3 |
| USDCHF | H2 | 1 |
| USDJPY | H1, H2, H4 | 3 |
| XAUUSD | H1, H2, H4 | 3 |

Each config (~120 fields) encodes a complete strategy. The taxonomy is the real find:

### 5.1 Taxonomies

**Bias** (directional filters): SMA, RSI, trailing, momentum, chandelier, Donchian mid, market structure, daily mid, VWAP, ADX, EMA, PSAR, HTF — each a boolean `use_bias_*` gate.

**Signals** (entry triggers): MACD, CCI, momentum break, engulfing, inside break, wick rejection, fib, breakout, liqsweep, ATR run, fade, Kalman, VWAP, ORB (opening range breakout), squeeze, three soldiers, stoch, williams, RSI, BB, pin bar — each `use_sig_*`.

**Filters** (blockers): SMA, RSI, Bollinger, CCI, receding, doji, no-open-Friday, volatility, consec (consecutive candles), ADR-exhaust, ADX, Keltner, regime (chop index), event (news/event filter) — each `use_filt_*`.

**Risk/exit:** breakeven, SL reduce, SL lock, ATR trail, partial TP, Friday-close-profit, EOD close, `sl_mult`/`tp_mult` (0.25 → 4.0 observed), `be_trigger_pct`, `trail_k`/`trail_act`, `pt_trigger_pct`/`pt_close_pct`, daily drawdown (`use_daily_dd`, `daily_dd_limit: 4.0`), aggregated risk cap (`use_max_agg_risk`, `max_agg_risk_pct: 4.0`), profit target (`use_profit_target`, `profit_target_pct: 10.0`), slippage/spread caps per asset class (`max_spread_*`, `max_slip_*`).

**Execution:** `exec_mode: "limit"` (limit orders everywhere observed), market2 window/pullback (limit-entry refinement), `limit_offset_atr`, `limit_expiry_bars`, `stop_offset_atr`, `stop_expiry_bars`, scale-in (`scalein_max_adds`, `scalein_step_atr`), trading hours (`start_hour`, `end_hour`, `friday_close`), news filter (`news_mins_before: 30`, `use_no_open_news_day`), symbol lock (`use_symbol_lock`).

### 5.2 The `locked_grade` block — evidence-driven strategy locking

Each config carries a **locked_grade** object — the criteria a strategy had to pass before it could be "locked" (i.e., trusted to run):

```json
"locked_grade": {
  "locked_return": 39.78,
  "locked_trades": 33,
  "beat_random_pct": 100.0,   // % of random strategies it outperformed
  "random_n": 100,
  "oos_trades_floor": 25,      // minimum out-of-sample trades
  "mc_p95_drawdown": 20.54,    // Monte Carlo p95 drawdown
  "plateau_pass_pct": 100.0,   // out-of-sample stability across plateau splits
  "plateau_n": 9,              // number of plateau segments
  "plateau_sigparams": 5,      // significant params count
  "br_required_pct": 85.0,     // "beat random" required rate
  "br_adaptive": true
}
```

Plus `_pg_source: "random"`, `_family_penalty`/`_family_reward: 1.0` — hints of a **genetic/evolutionary strategy search** (`[HYP]: "pg" = program generation / population genetics`) where families evolve, get graded against random baselines on out-of-sample + Monte Carlo + plateau-stability criteria, and only survivors get `locked_grade`.

This is a full **strategy-crafting lab pipeline**. **Borrow for PICC:** the grading criteria set (OOS floor, beat-random %, MC p95 DD, plateau validation) is a concrete, citable acceptance bar we can apply to any strategy we let into live trading — exactly the "trust gate" philosophy in `PICC_SUITE_MINISTRY_MODEL_v1.md`.

---

## 6. Web UI feature map (readable, all HTML/JS)

| File | Size | Feature |
|---|---|---|
| `algory_launch.html` | 230 KB | Main dashboard shell + JS |
| `algory_automation.html` | 105 KB | Automation center |
| `algory_portfolios.html` | 433 KB | Portfolio vault (largest page) |
| `algory_vault.html` | 144 KB | Vault/neural map (`web/algory_brain.html` visualizes it) |
| `algory_hud.html` | 126 KB | HUD overlay page (`algory_hud_poc.html` = proof-of-concept) |
| `algory_campaign.html` | 102 KB | Campaign controls |
| `_hud_chrome.js` | 342 KB | HUD chrome/logic — biggest JS asset |
| `_hud_quickpick.js` | 50 KB | Market/TF picker with plan-enforced caps + POST /setpending |
| `_hud_tutorial.js` | 97 KB | Guided tutorial overlay |
| `_hud_tips.js` / `_hud_diag.js` / `_launch_check.js` / `_port_check.js` | — | Tips, diagnostics, pre-launch / port checks |
| `algory_insights.html`, `algory_trades.html`, `algory_brain.html`, `algory_diagnostics.html`, `algory_disclaimer.html`, `algory_guide.html`, `algory_partners.html` / `partners_page.html`, `algory_marketing_landing*.html`, `algory_vsl_landing.html` | — | Insights, trades list, brain (neural map), diagnostics, disclaimer, guide, partners program, marketing/video-sales-letter pages |
| `{de,es,fr,it,ja,pt,ru,zh}.json` | ~45 KB each | 8-language i18n |

**Plan-token enforcement (`_hud_quickpick.js`):** the picker caps what the user can select based on the signed plan — layer 1 of 2; the engine re-enforces off the signed plan token (`Engine` logic seen in the `app/Algory_Engine_v129.py` reference in the plan doc). Free-plan vs Pro market caps are surfaced in the picker.

**Borrow for PICC:** quick-pick UX (market + timeframe picker with caps), the vault/neural-map visualization idea, and the HUD overlay pattern (floating WebView2 over the trading terminal).

---

## 7. Security observations

- **No crypto keys found in readable residue** — no obvious API keys, MT5 login/password, or wallet seeds in the readable files (`[HYP]` — encrypted .pyc layer likely holds credentials/keys; we cannot confirm).
- PyArmor protects all Python source; the mq5 and web layers are clean.
- Bundle is signed (VAGAFX LTD) with OpenSSL 3 TLS stack — TLS interception would need CA injection; not attempted.
- `cryptography` + `bcrypt` bundled → likely credential at-rest encryption (`[HYP]`).
- **Honesty note:** we verified the *residue*, not the engine's logic. The PyArmored layer is unreadable; everything about engine internals above that isn't a quote from readable files is marked `[HYP]`.

---

## 8. Borrow list → PICC trading suite (prioritized)

1. **MT5 file-bridge pattern** (temp-then-rename, delete-before-execute, separate status file, decoupled clocks) — adopt for our broker adapter layer. (4.1–4.3)
2. **Strategy seed taxonomy** — bias/signal/filter/risk/exit/execution split is a first-class schema for `PICC_TRADING_SUITE_UPGRADE.md` strategy configs. (5.1)
3. **locked_grade acceptance criteria** — OOS floor (25+), beat-random ≥ 85–100%, MC p95 DD, plateau stability — make this the standard strategy admission gate for live trading. (5.2)
4. **Plan-token cap enforcement** — signed-plan caps enforced in UI *and* engine (two layers). Aligns with our RUN/ADVISE+MANUAL gate model — the plan is the constraint, enforced twice. (6)
5. **Per-asset-class spread/slip limits** and **aggregated risk cap (4%) / daily DD (4%) / daily profit target (10%)** — concrete risk budgets to mirror in our risk engine. (5.1)
6. **Quick-pick + HUD overlay UX** — market/TF picker with caps; floating overlay over terminal. (6)

## 9. Unverified / open items

- Engine strategy execution logic (PyArmored) — unreadable.
- Whether `duka_starter_seeds.json` is parsed at runtime or compiled into the engine — `[HYP]` runtime parse (it ships as plain JSON beside the binaries).
- The genetic search pipeline (`_pg_source`, family penalty/reward) — inferred, not observed running.

## 10. Artifact access

Primary copy: `C:\Users\sharv\AppData\Local\Temp\opencode\re\algory-exe\Algory_Setup_1.5.1.3.3.exe_extracted\`
(kept outside the repo — do not commit the 248 MB installer or the extracted tree).