# 0007 - BROWSER_EXTENSION_SHIPPED_CLAIM v1 -> v2

Supersession record for the claim, carried in four product documents, that a
canonical browser extension (`picc-overlay`) ships in this repository.

rule: BROWSER_EXTENSION_SHIPPED_CLAIM
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0007-BROWSER_EXTENSION_SHIPPED_CLAIM-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 asserted a shipped artifact that is not in the tracked tree, in four
  documents, and described a runtime contract that exists nowhere in code.
  `git ls-files` returns zero matches for `picc-overlay` and zero for
  `apps/dashboard/extensions`; the only extension in the tree is
  `apps/extension-archived/`, the retired Plasmo skeleton that the same four
  documents also describe as retired. The removal is on the record in this
  repo's own spec registry (`PICC_HEADLESS_CAPTURE_ENGINE | COMPLETE | extension
  leg removed (D1)`) and is machine-enforced:
  `apps/dashboard/server/__tests__/extensionAbsence.test.mjs` pins 25 modules
  free of the extension era and fails the suite if `content.js`, `chrome.*`,
  "the extension", "extension feed" or "extension kill-switch" reappear. v1 was
  therefore not an aspiration in a spec - it was a false statement of fact in
  the documents a user and an operator read, including in a privacy policy that
  described page reads and session-token capture by a component that does not
  ship. v2 replaces the claim with the removal, names the replacement surface
  that carries the same role, and records the D1 provenance rather than
  deleting the history.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016; owner decision D1 (extension clean
  break) as recorded in PICC.md section 10. Findings H1 and H10 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md.
  Sibling records: 0014-F2_CLOSURE_EVIDENCE_CITATION (a closure pinned to a
  test file that never existed), 0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE (what
  the studio browser actually does), 0008-HOSTED_PERSISTENCE_AUTH_CLAIM (the
  other removed subsystem four documents described as live).

## What changed

| Document | v1 claim | v2 |
|---|---|---|
| `PICC.md` §0 mission | "a passive browser sensor (DOM-free MV3 extension relaying broker frames)" | studio browser + headless capture leg; explicit "no browser extension" |
| `PICC.md` §2 | "\| Extension \| MV3 picc-overlay, zero-dep, no build step \|" | "\| Browser extension \| **absent** ... removed end-to-end (D1) \|" |
| `PICC.md` §3.1/§3.2 | diagram node "Browser Extension (MV3, DOM-free sensor)"; "Neither the dashboard, the extension, nor the agents can place orders" | studio browser node; carve-out named inline |
| `PICC.md` §3.2 bullets | "MV3 picc-overlay; passive sensor relay of broker WS frames to /api/extension/ingest" | "Browser extension - removed (D1)", with the absent path and route named as absent |
| `PICC.md` §3.3 | route group "Extension /api/extension/ingest\|heartbeat\|tab-changed\|suggest\|confirm" | removed, and a note records that the family does not exist |
| `PICC.md` §3.4 | the `inject.js` -> `content.js` -> `sanitizeUpstreamFrame` -> `chromeGuard()` chain | replaced by the real capture path, with the deleted contract named as deleted |
| `PICC.md` §6 | a full specification of the MV3 extension's contract and T11 status | "REMOVED (D1), replaced by the Studio Browser", with what replaced it and what enforces the absence |
| `PICC.md` §12.1 F1 | "canonical = picc-overlay" | "there is no canonical extension" |
| `PICC.md` §20 item 3 | "apps/extension/ (Plasmo) is archived - canonical is picc-overlay" | "No browser extension ships", with the real path and the removal |
| `README.md` intro | "a passive browser sensor (a DOM-free MV3 extension ...)" | studio browser; replacement named |
| `README.md` directory table | a row for `apps/dashboard/extensions/picc-overlay` | row deleted; the archived row no longer claims it was "superseded by picc-overlay" |
| `README.md` feature 7 | "Browser extension - passive, DOM-free sensor relay ... offline queue" | "Studio browser + headless capture"; no extension ships |
| `README.md` quick start | "Load unpacked -> apps/dashboard/extensions/picc-overlay/" | block deleted |
| `README.md` architecture | "Browser Extension (MV3) <-- suggestions + live data" | studio browser node |
| `README.md` known issues / roadmap | "the canonical extension is apps/dashboard/extensions/picc-overlay/"; "Extension sensor relay + offline queue + live-probe status \| ✅" | removal stated; roadmap row renamed to the studio browser, still ✅ |
| `PRIVACY.md` overview + "## The browser extension" | an optional extension reading venue pages, capturing the venue session token | "PICC ships no browser extension"; the section is replaced by "## The studio browser (and the removed extension)" |
| `PRIVACY.md` data-location | "The browser extension (picc-overlay) keeps its own small state in browser extension storage" | "There is no extension state to describe" |
| `CHANGELOG.md` 2026-08-23 Phase 1 | "apps/dashboard/extensions/picc-overlay/ is the canonical extension" | entry preserved verbatim, annotated with a dated supersession note |

The CHANGELOG entry is the one place v1 text is left in place. A dated
historical entry is a record of what a phase did, and rewriting it would
destroy the very history the changelog exists to keep. The annotation states
what the entry no longer describes, and it is the annotation - not the
original sentence - that a reader now gets as the current fact.

## What was deliberately not done

- The archived extension was not deleted, and `apps/extension-archived/` was
  not renamed. It is a tracked historical artifact; the correction is about
  what documents *claim*, not about the tree.
- The T11 verification status earned against the extension era was not
  deleted. It is real evidence about code that existed. It is re-labelled as
  history rather than a current guarantee, because a guarantee pinned to a
  removed component is not a guarantee.
- No `docs/archive/*` file was edited. Those are disposition records, and the
  `sanitizeUpstreamFrame` / `chromeGuard` prose they carry is accurate as a
  record of the era.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and argued rather than borrowed. Every sentence v2
changes is prose about what exists in the tree. None of it was read by a
backtest, a sizing formula, a scoring path, a risk gate, an execution path or
a result-interpreting label - the extension's only consumer was the
`/api/extension/ingest` HTTP endpoint, which does not exist, so no frame it
relayed ever reached a feed. Changing what a document says about a component
that no code path consumed cannot change how any past trade, backtest or paper
result was produced or interpreted.

`reinterpret` would require that the superseded text had been load-bearing for
reading a past result; it was not - it was a description in a README, a master
document and a privacy policy. `invalidated` would require that results
computed under the old rule are no longer comparable; no result was computed
under it. The correction is material - a privacy policy describing capture by
an absent component is the most consequential instance of this defect class in
the repository - but materiality to a reader and effect on a past result are
different questions, and only the second one is what this field asks.
