# PICC Frontend UI Reskin — Resume pointer

Fresh continuation session: read this file first.

1. `docs/specs/PICC_FRONTEND_UI_RESKIN_execution_handoff.md` — the honest
   verified/unverified split + remaining-slice targets (T8/T9 REQ-D/REQ-E).
2. `docs/specs/PICC_FRONTEND_UI_RESKIN_v1.md` — governing spec, REQ-A..E acceptance.
   NOTE: this repo has multiple unrelated T8/T9 tables in other specs
   (PICC_EXTENSION_ERADICATION, PICC_UNIVERSAL_4FA_ENGINE, PICC_TRADING_SUITE_UPGRADE) —
   scope ONLY the reskin spec's REQ-D hub / REQ-E studio.
3. The pasted-in continuation prompt from the prior session — it names what was
   verified (typecheck exit 0; registry/income 20/20; `Dashboard.tsx:209` brand =
   "Income Command Centre", landed + typechecked) vs must be re-gated fresh
   (full vitest, sw precache==dist audit, build).

Known last-session verified edits: `apps/dashboard/src/pages/Dashboard.tsx:209`
`<h1>Income Command Centre</h1>`. Nothing committed/pushed. Gate fresh, then
execute remaining slices, then ONE commit+push.
