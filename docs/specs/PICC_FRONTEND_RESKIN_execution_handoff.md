# PICC Frontend Reskin — Execution Handoff (2026-09-19)

Purpose: let a fresh, clean-sensor session finish Slices 5–7 + final commit/push
without re-deriving anything. **Governs:** `docs/specs/PICC_FRONTEND_UI_RESKIN_v1.md`
(the source of truth for all REQ-A..E acceptance). This handoff overrides nothing;
discrepancies are flagged `<flag>`. Nothing is committed or pushed yet.

---

## 1 · Honesty contract (read first)

- The prior session's tool-observation layer **fused/corrupted repeatedly**
  (a `Dashboard.tsx` read returned registry content; hex totals flipped 113↔88;
  precache coverage reported 0-then-17-missing-then-21-matched; full-suite counts
  conflated 218/2304 with other runs). **Do not trust any subagent or fused number.**
- Everything below marked **VERIFIED** was re-observed via clean single-file reads or
  single-purpose commands **by the executor directly**, never imported from a report.
- Commit + push happens ONCE at the end of all slices (user's explicit rule). Gate
  order before committing: full `npm run typecheck` + full `npx vitest run` + the
  raw-hex + SW-precache audits + `npm run build` — all observed in the SAME session
  that is about to push.

---

## 2 · VERIFIED on disk (stable)

| Item | Evidence |
|---|---|
| `apps/dashboard/src/lib/registry.ts` exists (4,396 B) | exports `FAMILIES[6]`(`crypto/trading`,`dividend/interest/content/agent/uncategorized/earnings`,`defi/p2p/affiliate/rental/nft/intelligence`)… wait — 11 families; `familyEntry`,`familyToSuite`,`suiteToFamilies`,`familyLabel`; consumers: `registry.test.ts`, `IncomeStreams.tsx`, `typecheck` |
| `apps/dashboard/src/pages/Dashboard.tsx` (424 lines) | hub currently: `<h1>Command Centre</h1>` (`:209`), hero Card live `netWorthDisplay`+`incomeMonthly` (`:216-241`), `grid-3` ministry cards with `NavLink` to `/suites/trading|earnings|intelligence` (`:244-347`) |
| `apps/dashboard/src/lib/income.ts` / `streams.ts` | `getStreams`,`getEarnings`,`streamSummary` (incl. `monthly`,`activeCount`) — live client reads |
| `themes.css` + `index.css:root` bridge | REQ-B token slices landed (T4) |
| `npm run typecheck` / `tsc -b --noEmit` | **exit 0** (repeated, incl. same-session) → **VERIFIED** |
| registry(12)+income(8) narrow tests | **20/20 exit 0** (one clean observation) |

## 3 · NOT verified / contradicted — do NOT treat as green

- Full-suite totals (218 files / 2304 tests), raw-hex non-exempt = 0 (totals
  flipped 113 vs 88 across probes), SW precache == dist/assets coverage (0 vs 17
  missing vs matched), PWA chunk sizes (subagent-reported only). **Re-run fresh.**
- No commits, no push. `git status` shows all slices as working-tree changes.

---

## 4 · Next slice — Slice 5 (REQ-D): T8 hub rework + T9 studio universality

**T8 — Hub rework.**
- Files: `src/pages/Dashboard.tsx:206-259` (h1 `:209`, hero `:216-241`, grid-3
  `:244-347` → command-centre totals + per-stream breakdown via registry
  `familyToSuite`), `src/components/IncomeStreams.tsx` (reuse/export per-stream
  breakdown), `src/lib/registry.ts` (in place).
- Acceptance: `/` shows **Income Command Centre** brand `<h1>`; totals = sum over
  `getStreams()` + `getEarnings()` today/month (no fabricated values); each stream
  card links to `familyToSuite(familyId)` route; `npm test` + visual check.
  Connected-room keys/paths are pinned by `IncomeStreams.tsx` consumers — do not
  break the 17-asset code-split or the `/suites/<suite>` ministry link contract.

**T9 — Studio universality.**
- Files: `src/pages/MinistryShell.tsx:4-25` (add `studio` before `settings` in
  INNER_NAV), `src/pages/ministry/MinistryRoom.tsx:14-41` (map `studio` → shared
  StudioRoom per suite), `src/pages/ministry/__tests__/MinistryRoom.studio.test.tsx`
  (:1-77 — REWRITE to assert studio present + per-suite resolution, update header),
  `src/pages/__tests__/suitesLanding.test.tsx:63` (add "Studio" to label list).
- Acceptance: `npm test` — rewritten studio tests green asserting studio per suite;
  `/suites/*/studio` renders the shared Studio surface (REQ-E.3); suitesLanding
  "Studio" present; studio-gating flip shipped in the SAME commit as the spec
  reference reversal (spec REQ-D.2).

## 5 · Remaining—Slice 6 (REQ-E): T10 source-pref persistence + T11 status-chip
accuracy. Slice 7: T12 orphan deletion (verify orphans first; update
`brokerAgnosticLabels.test.ts:14-23` + `MinistryRoom.studio` rewrite in same commit).

## 6 · Red lines (do not violate)

- No fabricated data anywhere (hub totals come from live `getStreams()`/`getEarnings()`).
- Do NOT delete/weaken tests to go green; do NOT commit secrets; `.env` untouched.
- Theme binding `data-theme` on AppShell/Login/MinistryShell per suite must survive
  T7 code-split (hub shell = `income-command-centre`).
- Born honest: every redundant "under development / unavailable" state stays; no
  fake "live" claims.
