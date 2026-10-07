# Copytrading Research Corpus — Design

**Date**: 2026-10-07
**Status**: proposed
**Author**: agent, with owner approval of the approach
**Supersedes**: nothing. ADR-0006 was withdrawn 2026-10-07 (see below).

---

## 1. Purpose

PICC is a personal command centre whose value rests on being trustworthy. This
subsystem adds evidence about how other market participants behave, so the
decision layer has something to reason against beyond its own history.

It is explicitly **not** a social feature. It is not a place to follow traders,
and it must never produce a claim that another participant's result is
reproducible by the owner.

## 2. What this is not

These are prohibitions, not preferences. Each one would be a way to make PICC
look more useful than it is:

- **No leaderboard.** Ranking participants by realised P&L selects maximally on
  the outcome variable and manufactures survivorship bias.
- **No per-participant P&L display.** See §4.1.
- **No "copy"/"follow"/"inspiring traders" framing.** Inheriting someone's
  entries means inheriting their risk tolerance, leverage and sizing, none of
  which is the owner's. It also reads as investment advice.
- **No scraping of private broker or social-copy account data.** See §3.2.

## 3. Sources

### 3.1 Attribution-capable venues only

Most exchanges expose *market-level* aggregates — who traded what is not public.
This subsystem depends on venues that index **accounts** (currently
Hyperliquid; dYdX-class protocols). That thinness is the root cause of the
survivorship problem in §4, and adding sources will not fix it, because the
sources in the required shape do not exist.

Non-attribution venues may be used for **market structure** (liquidity,
volatility, order book). Do not merge those into the behaviour dataset — they
answer different questions and pooling them would create a dataset whose
provenance is ambiguous.

### 3.2 Legality

Hyperliquid's public on-chain history is readable by anyone and is the intended
source. Reading another venue's or broker's *private* P&L or account history is a
different act and likely violates their terms. This subsystem does not do it, and
a future contributor adding such a source has misread the design.

## 4. The bias, and what we do about it

### 4.1 Survivorship bias cannot be removed

A participant who failed and left is structurally invisible. Only accounts still
present are observable. No quantity of data removes this. Anything claiming
otherwise is selling a backtest curve.

We therefore do three things: **bound** it, **stop amplifying** it, and
**display** it.

### 4.2 Bounds

- **Liquidations are failure data.** A forced liquidation is an observable
  terminal event — the market ending a run. Sampling only active accounts
  samples survivors by construction. Liquidations are first-class data.
- **Dormancy as a soft failure signal.** Accounts with no recent activity may
  have left. Not "dead", but it breaks the assumption that presence implies
  success. Cohort by account age and build survival curves.
- **Condition on state, never on identity.** Ask *"after a drawdown of X%, what
  fraction increased size versus cut it?"* rather than *"what did successful
  traders do?"*. The former conditions on state and generalises; the latter
  selects on the outcome variable and manufactures the bias.

### 4.3 Not amplifying

- **Extract rules, not positions.** A conditional rule ("after two losses,
  halved size") is something the owner can validate against their own capital
  and constraints. Raw entries are not transferable.
- **Split out-of-sample by regime, not by date.** A calendar split silently
  tests on a different market than it trained on.
- **Stratify by regime rather than maximise volume.** A few thousand samples per
  regime beats millions pooled; pooled data is dominated by whichever regime ran
  longest.

## 5. Outputs

Four, deliberately separate. Nothing here aggregates into a single "score".

### 5.1 Cohort survival curves
By account age, over time. Includes dormancy and liquidation counts.

### 5.2 State-conditioned behaviour statistics
Post-drawdown and post-win sizing response. Robust to selection, and evaluable
against the owner's own history.

### 5.3 Regime-stratified aggregates
Bucketed by volatility/trend regime. **No raw per-trade dumps** at this layer.

### 5.4 Bias header
Every statistic in 5.1–5.3 carries, alongside the value:

```
n_accounts_observed · n_dormant · n_liquidated · window_start · window_end
```

A panel reading `confluence 0.72 (n=340, 61 dormant, 12 liquidated)` is
trustworthy in a way that `confluence 0.72` never is. This extends the existing
honest-absence discipline from *missing data* to *biased sampling*.

## 6. Storage and separation

The owner-vs-others separation is an **integrity requirement**, not a display
concern. It must be structurally impossible to read an imported sample as one
the owner produced.

- Separate stores. No shared table, no shared id space.
- Every imported record carries `origin: "external" | "owner"` — set at write,
  never inferred at read.
- No query path may mix the two without an explicit, visible flag.
- Imported data is read-only after ingest.

This mirrors what already separates `ccxt-execution` from paper trading. A soft
label in the UI is insufficient: the boundary has to hold even if someone
ignores the label.

## 7. Sampling and scale

Explicit target: **thousands of samples per regime**, not millions. The marginal
value of sample 500,001 is approximately zero for this purpose. What buys
confidence is regime coverage and tight tail estimates — neither of which scales
with raw volume. Designs that optimise for ingestion throughput will import far
more than this analysis can use and will make the bias harder to see.

## 8. Open questions

1. **Validate own strategy, or describe other participants?** §5.2 serves the
   first well and the second only descriptively. This changes what "success"
   means and should be settled before §5.2's schema is fixed.
2. **Ingest cadence and backfill depth.** Not decided. Depends on the venue's
   API limits and the chosen regime set.
3. **Storage retention.** Imported samples are third-party-derived; a retention
   period should be chosen deliberately rather than by omission.

## 9. Non-goals

- Real-time signals or alerts derived from other participants' activity.
- Any per-participant ranking, score, or recommendation.
- Automated trade replication.
- Any surface that could be read as investment advice.

---

## Note on ADR-0006

An earlier ADR-0006 proposed an asset-alias registry. It was **withdrawn before
shipping**: the market-data bus already had its own symbol/quote matching, so the
alias was redundant and regressed three tests. Recorded here because the numbering
is now free and a future reader may encounter the reference.