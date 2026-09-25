# Trading-logic changelog

Durable record of **trading-rule** changes: what a rule was, what superseded it,
and whether historical results are affected. This directory exists because D15
makes Blueprint v4.0 normative and forbids an in-place rule rewrite that erases
how past trades were interpreted.

This is not a commit log. Git records every ordinary change; this records only
changes that alter the *meaning* of a trading rule or a metric.

## Why a rule cannot be edited in place

If a rule changes and the old text is simply overwritten, a historical backtest
or paper-trade result can no longer be reproduced: the result exists, but the
logic that produced it does not. That is a correctness and audit problem, not a
tidiness problem. So a superseded rule is preserved with its replacement and its
historical impact.

## Required fields for a supersession record

Every entry in `entries/` MUST contain all of these, and
`server/__tests__/ws6SafetySeamGuard.test.mjs` asserts the schema exists:

| Field | Meaning |
|---|---|
| `rule` | Stable identifier of the rule being superseded (e.g. `SESSION_ROUTING`). |
| `version` | The version being superseded. |
| `supersededBy` | Version (and record path) that replaces it. Required. |
| `date` | ISO-8601 date the supersession took effect. Required. |
| `historicalTradesAffected` | Whether and how prior results change. Required. |
| `reason` | Why the rule changed. |
| `source` | Where the new rule comes from (spec/ADR/owner decision). |

### `historicalTradesAffected` accepted values

- `none` — the rule change does not alter the interpretation of any past result.
- `reinterpret` — past results remain valid but were labelled under the old
  rule. Record how to re-label them.
- `invalidated` — past results computed under the old rule are no longer
  comparable. Record the affected scope and whether they must be recomputed.

Never leave this field empty. "We did not think about it" is a
`reinterpret`/`invalidated` decision that has not been made yet, and writing it
as such is what prevents a silent answer later.

## Layout

```text
docs/trading-logic/changelog/
  README.md                      # this schema
  blueprint-v4-provenance.md     # provenance status for the owner-supplied blueprint
  entries/                       # one file per supersession
    NNNN-<rule>-vN-to-vM.md
```

## Blueprint provenance

`blueprint-v4-provenance.md` records whether the owner-supplied Blueprint v4.0
is grounded in the repository. Until that document is checked in, its
`provenance:` field reads `UNVERIFIED`, and no implementation may claim the
blueprint was migrated.
