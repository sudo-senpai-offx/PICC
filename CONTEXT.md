# PICC

PICC is a self-hosted financial management command centre: it runs an income-generation
realm (active and passive streams, deliberately separate from the user's primary-job
income) plus the trading ministry, and administers both with a country-of-ministries
metaphor.

Brand expansion (UI-reskin decision, Q10): PICC is the **Personal Income Command Centre**
(per `PRIVACY.md`; "Passive" wording is deprecated and being swept from the UI). PICC is
used as a standalone name where an expansion does not fit.

## Language

**Ministry**:
A functional department of PICC that owns a defined domain (Trading, Earnings,
Intelligence). Each ministry has its own suite theme and rooms. New ministries are added
over time; none is a catch-all for "everything else".
_Avoid_: suite (implementation alias only), miscellaneous bucket, "Earnings covers the rest".

**Income stream**:
A configured income source — an `IncomeStream` record with category, status, balance,
payout method, and collector ("cashpilot" | "manual"). A stream is data, not a page. Each
stream is classified to exactly one owning ministry through the classification registry.
_Avoid_: "income app", "income service".

**Classification registry**:
The machine-readable mapping of every income source, stream family, and feature to an
owning ministry plus a sub-domain. The frontend derives navigation, hub drill-downs, and
theming from the registry, so adding future suites is a registry entry, not a code
refactor. Out-of-focus stream families are listed as "coming soon" rather than omitted.
Hardware-sharing income sources (DePIN/storage/bandwidth/compute) are excluded from the
registry entirely — they are always unprofitable once electricity, hardware wear, and
external factors are counted (UI-reskin decision, Q11).
_Avoid_: hardcoded nav, per-feature route special-casing.

**Graduation rule**:
The policy encoded in the classification registry: a stream family that proves itself
(earns consistently, reaches its payout threshold) is proclaimed its own ministry.
_Avoid_: hand-moving features between suites on a whim.

**Income Command Centre**:
The app's umbrella identity and theme. The whole chrome (top bar, hub, non-suite pages)
is Income Command Centre themed, and the home hub consolidates cross-suite income at a
glance while launching into each ministry.
_Avoid_: neutral launcher, plain dashboard.

**PICC-as-a-country**:
The governing metaphor: PICC is a country, ministries are its departments, the hub is
the seat of administration, and features are services the country provides. The metaphor
shapes IA and theming; it is not a legal or financial entity.

**In-focus stream families** (UI-reskin decision, Q11):
Trading/crypto, DeFi yield, P2P lending, dividends/interest, content/royalty, and
agent-income are active and receive all updates. Rental and NFTs are marked "coming
soon". Hardware sharing (DePIN/storage/bandwidth/compute) is excluded entirely.

**Family-to-ministry mapping** (UI-reskin decision, registry Q&A):
The classification registry maps every stream family to exactly one owning ministry
(frontend derives nav, hub drill-downs, and theming from it). Locked mapping:
Trading owns `crypto`. Earnings owns `dividend`, `interest`, `content`, `agent`, and
the `uncategorized` fallback. Intelligence owns `defi`, `p2p`, `affiliate`, `rental`,
and `nft` (DeFi/p2p/affiliate are analysis-heavy — forecasting and decision support).
The server's site-category registry (`server/services/suites.mjs`) is the authority
for *browser-site* classification (trading site → trading suite); the frontend
registry in `src/lib/registry.ts` is the authority for *income-stream* families.

**Browser Studio** (UI-reskin decision, studio amendment):
A universal PICC capability, not a routed single-purpose tool. The **headed** studio is
always reachable from the primary sidebar nav and can be opened anywhere; the **headless**
studio can be used from inside any ministry/room for automated capture/collection of data.
When headless operation is impossible (site constraints, CAPTCHA, manual-intervention
breakpoints), a headed tab opens so the user can intervene safely while every PICC feature
stays active. This reverses the SP-1-era gating that kept the studio out of ministry shells;
the gating tests are rewritten deliberately.
_Avoid_: "studio room only in one suite", "studio as a niche tool".