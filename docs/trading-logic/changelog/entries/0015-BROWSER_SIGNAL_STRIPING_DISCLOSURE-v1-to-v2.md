# 0015 - BROWSER_SIGNAL_STRIPING_DISCLOSURE v1 -> v2

Supersession record for the `PICC.md` guardrail that read "no behavioral
camouflage against platform bot-detection" while the shipped code strips
bot-detection signals by default.

rule: BROWSER_SIGNAL_STRIPING_DISCLOSURE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0015-BROWSER_SIGNAL_STRIPING_DISCLOSURE-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 stated a guardrail the code contradicted, and the contradiction was inside
  the guardrail's own scope. The v1 sentence was not "no humanized typing" - it
  was "no behavioral camouflage against platform bot-detection".
  `navigator.webdriver` is the canonical bot-detection signal, and
  `apps/dashboard/server/services/browserBridge.mjs` removes it: the file header
  at `:8-11` says it uses real Chrome "so there is no fingerprint to detect" and
  strips "the automation signals we control (`navigator.webdriver`) to keep the
  page behaving exactly as it would for a human user"; the `if (stealth)` block at `:362-367`
  does it — it pushes `--enable-automation` off the default arg list (`:365`) and adds
  `--disable-blink-features=AutomationControlled` (`:366`), and **`:366` is the flag that
  actually makes `navigator.webdriver` false**; `:363-364` is the code's own comment saying so;
  and it is not a dormant path - `@param stealth` at `:323` and the default at `:335` are both
  `true`. The file can also import a real logged-in browser profile
  (`importRealProfile`, `:288`, called at `:353`; the option is documented at `:329`). Owner
  decision D22 already
  ruled that this is RETAINED as an explicitly disclosed policy, so v2 discloses
  it with its code citations, its default and its opt-out, and stops calling it
  something it is not.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016; owner decision D22, resolved 2026-09-26
  ("KEEP, as an explicitly disclosed policy"). Implementation evidence:
  apps/dashboard/server/services/browserBridge.mjs:7-11,288,317,323,329,335,353,362-367.
  Section 5 item 1 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md,
  which ruled the claim CONTRADICTS and found the "camouflage and signal-stripping
  are different things" defence does not survive the document's own wording.
  Sibling records: 0007-BROWSER_EXTENSION_SHIPPED_CLAIM (the other half of the
  browser surface), 0013-WS7_REGISTRY_ROW_PROGRESS_NOTE (the registry row that
  carried a stale pointer to this guardrail).

## The three claim sites, and a stale pointer that would have missed all of them

v1's claim appeared in three places in `PICC.md`, and the spec's own pointer to
it named none of them. D22 and AC-015 both cite **`PICC.md:30-31`** as the text
to rewrite; post-D19 those lines are the guardrail-1 two-rails table. The real
claim sites are **`:48-49`** (§0 guardrail 2), **`:721`** (§13 non-negotiable
carries) and **`:800`** (§17 decisions register). A fix scoped to the spec's
pointer would have edited the wrong paragraph and left the false claim in place in
all three places it mattered. v2 corrects all three, and the registry row that
repeated the stale pointer now records the correction.

## What changed

| Location | v1 | v2 |
|---|---|---|
| `PICC.md` §0 guardrail 2 | "**No behavioral camouflage** against platform bot-detection. No humanized-typing by default (`PICC_HUMANIZE=1` is explicit opt-in for slow reads, never for deception)." | "**Browser automation-signal stripping is RETAINED, and is disclosed here (WS-7 D22, 2026-09-26).**" - states that an earlier version of the line read "no behavioral camouflage" and that the code contradicted it; cites `browserBridge.mjs` `:323,335` (`stealth = true` by default), `:362-367` (the `if (stealth)` block: `:365` drops `--enable-automation`, and `:366` adds `--disable-blink-features=AutomationControlled`, the flag that actually clears `navigator.webdriver`), `:8` and `:11` (the code's own stated reason), `:288,353` (real-profile import); names `stealth: false` as the opt-out; and then, separately, keeps the `PICC_HUMANIZE` typing rule as v1 had it |
| `PICC.md` §13 | "...no behavioral camouflage, no withdrawals." | "...no withdrawals. (Browser automation-signal stripping is retained and disclosed - see guardrail 2, not a "no camouflage" claim.)" |
| `PICC.md` §17 | "- **No behavioral camouflage**; `PICC_HUMANIZE=1` explicit opt-in for pacing, not deception." | "- **Browser automation-signal stripping is retained, disclosed, and default-on** (`navigator.webdriver` + `--enable-automation`, `browserBridge.mjs:362-367`; `stealth = true` at `:335`, pass `stealth: false` to disable); **no humanized-typing by default** - `PICC_HUMANIZE=1` is explicit opt-in for pacing, not deception. See guardrail 2 and §16.1." |
| `PICC.md` §16.1 out-of-scope | "Out of scope: camouflage/ToS-violating automation; withdrawals/transfers anywhere." | "Out of scope: ToS-violating automation **beyond the disclosed automation-signal stripping in guardrail 2**, which D22 retains deliberately; and withdrawals/transfers anywhere." |
| `PICC.md` §10 WS-7 registry row | D22 sub-clause: "...with `PICC.md:30-31` rewritten to match" | "...with **§0 guardrail 2** rewritten to disclose it in full (`PICC.md:30-31` is the stale pointer this row used to carry - post-D19 those lines are the guardrail-1 rails table)" |
| `PRIVACY.md` studio-browser section | did not exist (the section described an extension that does not ship) | the default-on stripping, the code's stated reason, and the `stealth: false` opt-out are disclosed in the privacy policy, alongside the read-only and profile-import facts |

`§16.1` is not one of the three claim sites, and it is included deliberately.
Leaving it would have created a *new* internal contradiction the moment guardrail
2 was corrected - a document that disclosed signal-stripping in one section and
declared it out of scope in another. Correcting the claim without correcting the
cross-reference would have traded one truth problem for another.

`PRIVACY.md` is not one of the three claim sites either. It is included because
the disclosure duty and the data-handling disclosure are the same duty: a reader
of the privacy policy is making a different decision from a reader of the master
document, and the stripping is a fact about how PICC drives a browser, not only
about a product guardrail.

## The alternative that was rejected

The spec's decision 3 is "KEEP, as an explicitly disclosed policy", and the
defensible-looking alternative was to argue that stripping an automation *signal*
is not behavioural *camouflage*, leaving the guardrail intact and disclosing
nothing. Three things rule it out, and they are recorded here because the argument
looks strong enough to be re-raised:

1. **The document defines its own scope.** The guardrail's subject is
   "bot-detection". The code's own comment for the removal is "navigator.webdriver
   is what sites use to fingerprint automation". Same subject, same object.
2. **The `PICC_HUMANIZE` clause is a second clause, not a narrowing.** v1's
   sentence has two halves; the typing half was true and is preserved. The
   bot-detection half was false. Reading the true half as a scope limit on the
   false half inverts the sentence's own structure.
3. **It is on by default.** `stealth = true` at `:335` is not a dormant path
   waiting for an operator to opt in.

The spec had already rejected the camouflage/stripping distinction independently,
by requiring the rewrite in three separate places. A record that documents why the
rejected reading is unavailable is worth more than a record that only says the
wording changed.

## Known gap, recorded and not closed here

D22's disclosure has two halves: rewrite the guardrail, and produce **a dated
policy document** stating the stripping, the rationale, the `stealth` opt-out and
the real-profile import, linked from the guardrail. v2 closes the first half in
four places and states the code citations inline, so the disclosure is complete
and self-contained. The second half is **not** closed: `git ls-files` finds no
camouflage/stealth/automation-signal policy document, and the only markdown files
mentioning `webdriver` are a research archive spec and the WS-7 spec, neither of
which is a product disclosure.

That gap is left open deliberately and is recorded here rather than quietly
omitted, because a guardrail that cites code line numbers is verifiable today and
verifiable forever, while a policy document can drift from the code - which is
the failure mode that produced v1. A future task should extract the dated policy
and link it, and this record is where that work is already described.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and this is the record in the batch where the decision
needed the most care, because the corrected fact is about a behaviour that runs
against a venue rather than about a document.

The stripped signals affect how a *venue* sees PICC's browser. They do not
affect any input to, or output from, the trading suite: the ensemble, the
walk-forward folds, the embargo, the significance floor, the split-conformal
bands, the Kelly sizing, the paper ledger, the risk caps, the consent payload
lock and the audit rows are all untouched by this correction, which changed prose
only. No paper trade, backtest fold or recorded result was computed with or
without `navigator.webdriver` present, so there is no result whose interpretation
depends on the corrected sentence and none to invalidate.

The honest statement of the stakes is this: the correction is materially
important to a user deciding whether PICC's automation is acceptable against a
venue's terms, and that is a compliance question, not a results-reproduction
question. The field asks the second one. `reinterpret` would require a past result
*labelled* under the v1 claim; the labels on PICC's results never referenced
camouflage, because the claim lived in a guardrail, not in a metric. `none` is
the accurate answer, and it is the answer to the question that was asked, not a
way of saying the correction does not matter.
