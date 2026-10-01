# 0026 - T15_RETENTION_AND_VETO_STORAGE v1 -> v2

Execution record for WS-7 task T15: D8's three retention classes, the 90-day
one-way transform, the persistence layer for veto/score/receipt records, and the
snapshot purge. The **last task of BS-2**, and the only WS-7 task whose normal
operation deletes stored records.

rule: T15_RETENTION_AND_VETO_STORAGE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0026-T15_RETENTION_AND_VETO_STORAGE-v1-to-v2.md)
date: 2026-10-01
historicalTradesAffected: none
source: >-
  WS-7 task T15 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1327-1334`,
  decision D8 (`:157-164`), requirement R11 (`:440-443`) with R11.1 (`:441`),
  R11.2 (`:442`) and R11.3 (`:443`), acceptance criteria AC-033 (`:1029-1035`)
  and AC-034 (`:1037-1043`), the `RetentionClass` union at `:668-671` and the
  contract sentence at `:674`, the module layout at §4.2 (`:564`), the
  `VetoOutcome` annotation at `:601`, the two risks at `:1434-1435`, the freeze
  invariants at `:73` d, the bisect matrix row BS-2 (`:1397`), and plan v1 §3.4
  (`:271-283`).

reason: >-
  T11 built the decision path and deliberately stopped one step short of D8. Its
  `vetoIndex.mjs` stamps every veto record with the literal
  `permanent_append_only` (`:66`, `:133`) and says so at `:26-32` - it knows the
  class and routes to an injected `sink`, and it says in terms that "T15 decides
  what that class means over time and what gets purged". Nothing decided. As of
  `c8896f4` the repository contained a class name and no enforcement of it: no
  store, no aggregate, no purge, and a veto record that existed only in memory
  unless a caller happened to supply a sink.

  The risk T15 accepts is the one D8:162 names. A veto record is the evidence that
  a safety rule worked, and D8:164 requires that "append-only means no update or
  delete path exists". A `store.delete(id)` that throws is not that: it is one
  refactor away from a `store.delete(id)` that succeeds, and that refactor is
  exactly what a future migration or admin endpoint would be. So T15 builds the
  absence rather than the block, and the tests assert the absence rather than the
  block.

## The incident this task actually produced: two comments failed the isolation guard

**T15 shipped a red guard on its first committed run, and the cause was its own
prose.** Recorded first because it is the finding that mattered, not because it was
the hardest.

The repo-wide store-isolation guard (`server/__tests__/ws7TestStoreIsolation.test.mjs`)
discovers unredirectable stores by scanning raw source text for the shape of a
hardcoded `data`-relative URL, and separately scans test files for any `PICC_`-prefixed
path variable they read. **Neither detector strips comments.** Two of T15's own
comments quoted the patterns the guard hunts for:

| File | Comment text | Detector it tripped |
|---|---|---|
| `retentionStore.mjs` (header) | "hardcodes no `new URL("../data")` fallback" | `HARDCODED_DATA_PATH` -> the module was reported as a THIRD unredirectable store |
| `retentionStore.mjs` (`assertRetentionStoreDirAllowed` JSDoc) | "is `process.env.PICC_X_DATA_DIR \|\| <the real server/data>`" | the `PICC_` coverage scan -> a store read that does not exist |
| `retentionStore.test.mjs` | "Every existing per-service store is `process.env.PICC_X_DATA_DIR \|\| ...`" | the test-file `PICC_` read scan |

Six assertions failed across three of the guard's contracts:
`UNREDIRECTABLE_STORES` gained a third member; the "a third unredirectable store is a
finding, not a chore" count went 2 -> 3; the required `UNREDIRECTABLE_REASONS` entry
for the new member was `undefined`; the per-path fallback check rejected the
explanation; and the two `PICC_` coverage contracts each gained a phantom read.

**THE GUARD WAS NOT WEAKENED, NOT EDITED, AND NOT SKIPPED.** Both comment sites were
reworded to describe the forbidden shape without reproducing it - "hardcodes no
`data`-relative URL of its own" instead of the expression - and each site now carries
a note saying why, so the next author does not reintroduce it. The guard file itself
is byte-identical.

**WHY IT WAS INVISIBLE FOR SO LONG, AND WHY THAT MATTERS MORE THAN THE FIX.** The
guard discovers stores through `git ls-files`. T15's four modules were **untracked**
while I developed them, so the scan did not see them - and **two consecutive full
suite runs were completely green.** The guard only fired once `git add` made the files
visible. So:

- A green suite does not prove a new store respects the isolation contract. Until the
  file is tracked, the guard is not looking at it.
- **The verification that matters for a task that adds a store is the one after the
  commit, not the one before it.** Both post-change pre-commit runs were green and the
  post-commit run was red; had the commit been the last thing I did, the defect would
  have shipped and the report would have claimed green.

Recorded rather than quietly fixed, because the generalisable rule is: a guard that
scans text cannot distinguish a comment from code, and a comment that documents a
forbidden pattern is a finding. T15's own header now says so.

## The three classes, as implemented

D8:160 names four kinds across three classes. T15 adds two kinds - `retention_cutover`
and `score_breakdown` is D8's own - and derives every class from the record's
`kind` through one table (`retention.mjs:52-65`).

| Kind | Class | Source |
|---|---|---|
| `veto_decision` | `permanent_append_only` | D8:160 |
| `score_breakdown` | `permanent_append_only` | D8:160 |
| `execution_receipt` | `permanent_append_only` | D8:160 |
| `retention_cutover` | `permanent_append_only` | D8:164 - **T15's addition** |
| `market_snapshot` | `raw_90d_then_aggregated` | D8:160 |
| `daily_aggregate` | `daily_aggregate_permanent` | D8:160, R11.3 (`:443`) |

**THE CLASS IS DERIVED, NEVER PASSED.** There is no `classify(record, class)`
overload and no default branch. A caller cannot route a veto record into the 90-day
window by handing over the other class, because the class is not an input. An
unrecognised kind throws, and `:674` - "the shapes are contracts, not permission to
invent values" - is why: "default to permanent" and "default to 90 days" are both
fabricated classifications.

**A RECORD THAT MISLABELS ITS OWN CLASS IS REFUSED, NOT CORRECTED**
(`retention.mjs:131-143`). `assertRetentionClassConsistent` recomputes the class
and throws on disagreement. Silent coercion would have been defensible - the
derived class is right by construction - but a record whose own label disagrees with
its kind is CORRUPT, and the corrupt records are exactly the ones where guessing is
most expensive. The disagreement is made visible rather than repaired.

**`retention_cutover` is a KIND, not a fifth class.** D8:164 requires "a recorded
cutover" and AC-033:1034 requires "a purge-run test asserting the cutover record".
A cutover that was not itself permanent would be a record the next purge could
remove - the evidence of a purge being the one thing a later purge erases. Mapping
it onto `permanent_append_only` keeps the class union at exactly the three of
`:668-671`.

**IS AN AGGREGATE, AND A CUTOVER, IN THE SAME FILE AS A VETO RECORD.** Both
permanent classes share `copilot-retention-permanent.jsonl`. Three classes over
three files would mean three places to protect; one file means the purge's rewrite
has exactly one target and that target is unambiguously the non-permanent one. The
class still travels on every record, because the class is what a reader filters on -
the file layout is an implementation detail and is not load-bearing for correctness.

## The 90-day transform: what "one-way" means here, and the evidence

`transformExpiredSnapshots` (`retention.mjs:342-416`) takes expired raw snapshots
and returns one permanent daily aggregate per (UTC day, instrument). It reads no
clock and no filesystem - `now` is an argument - and that is the first of three
properties.

**THE LOSS, STATED POSITIVELY.** `RETAINED_SNAPSHOT_FIELDS` (`:229-240`) is the
exact list of snapshot fields the transform reads: `id`, `kind`,
`retentionClass`, `observedAt`, `symbol`, `open`, `high`, `low`, `close`,
`volume`. Anything else a producer puts on a snapshot is dropped at the cutover. The
test seeds a snapshot with `payload`, `source`, `latencyMs`, `tickDirection` and
`spread` and requires that none of them appears anywhere in the serialised
aggregate.

`AGGREGATE_FIELDS` (`:251-264`) is the aggregate's exact key set: `kind`,
`retentionClass`, `aggregateId`, `transformVersion`, `bucket`, `symbol`, `open`,
`high`, `low`, `close`, `volume`, `sampleCount`. There is **no `computedAt`**, so
the aggregate is a pure function of its input and two runs over the same expired day
are byte-identical. There is **no `firstSampleId` / `lastSampleId`**, and no
per-sample list, which is what makes property 1 below true.

### 1. The map is not injective, so it has no inverse

`aggregateId` is derived from `(transformVersion, bucket, symbol)` and **nothing
else** (`retention.mjs:450-452`). So two expired days with **disjoint snapshot id
sets**, different per-sample values and different dropped payloads produce a
**byte-identical** aggregate.

Measured, in `__tests__/retention.test.mjs` ("maps two DISJOINT raw sets to one
byte-identical aggregate - so it is not invertible"):

| Input set A | Input set B |
|---|---|
| `snap-202653-0`, `-1`, `-2`, `-3` | `zz-0001`, `zz-0002`, `zz-0003`, `zz-0004` |
| volumes 10, 5, 15, 10 = 40 | volumes 10, 8, 12, 10 = 40 |
| middle prices 101, 102 | middle prices 100.5, 101.5 |
| payload `{"ticks":…}` x4 | payloads `ALPHA`, `BETA`, `GAMMA`, `DELTA` |

    JSON.stringify(snapshotsA) !== JSON.stringify(snapshotsB)     different raw data
    JSON.stringify(aggregateA) === JSON.stringify(aggregateB)     same aggregate
    serialised aggregate contains neither "snap-202653-0" nor "zz-0004"
    serialised aggregate contains no "payload"

A function with a non-singleton fibre admits no inverse on its image. That is
AC-033:1033's prohibition - "the transform may not be reversible by re-deriving
deleted raw data" - as arithmetic rather than as a promise.

### 2. The intraday path is lost, which is what D8 trades

A separate test holds the snapshot IDs and the timestamps FIXED and varies only the
per-sample values: two different intraday paths through the same day, same open,
high, low, close, volume (40) and sample count (4), produce byte-identical
aggregates. Neither test would prove non-invertibility alone; the first shows the
aggregate carries no identity, the second that it carries no sequence.

### 3. The output is not a valid input

An aggregate is `daily_aggregate_permanent`, which fails the class gate in
`assertTransformable`. So "applying the transform twice" is not a degenerate
operation - it is a refusal, asserted:

    expect(() => transformExpiredSnapshots(aggregates, { now: NOW })).toThrow()

**AND THE PERMANENT CLASS IS REFUSED AT THE SAME GATE.** `AC-033:1033` requires
that "no purge may touch a permanent class". That check is in the transform, not
only in the purge's selector, so the protection does not depend on every future
caller having filtered correctly first. Likewise a snapshot that is not yet 90 days
old is refused by the transform - a transform that could reach a young snapshot
would make the 90-day window advisory.

## AC-034: permanent classes have NO mutating path, structurally

`permanentLedger.mjs` is the only module in the repository permitted to write a
permanent record, and it is built so that it cannot do anything else. Its
`node:fs` import list is asserted by **exact equality** against its own source:

    appendFileSync, existsSync, mkdirSync, readFileSync

There is no `writeFileSync`, `unlinkSync`, `renameSync`, `rmSync`, `truncateSync`,
`copyFileSync`, `statSync`, `open(..., "w")` or `createWriteStream`. Adding one is a
red test rather than a silent capability. `appendFileSync` is used **exactly once**
in the file, asserted by count.

`__tests__/permanentAppendOnlySurface.test.mjs` makes five claims, each with a test
that fails without it:

| # | Claim | Tests |
|---|---|---|
| 1 | CAPABILITY: the ledger may import exactly those four bindings, and calls no filesystem function that can seek, truncate, overwrite, rename or unlink | 3 |
| 2 | SURFACE: no retention module exports a mutation-named symbol, and the live store object carries none | 5 |
| 3 | REACHABILITY: **no other tracked file in `apps/dashboard/server/**` or `scripts/**` names the permanent ledger filename** | 3 |
| 4 | SCOPE: the purge job's whole fs capability is `renameSync` + `writeFileSync`, its only write target is `store.rawSegmentPath`, and it never names the ledger | 2 |
| 5 | RUNTIME: a negative test per mutating method, with the file byte-identical afterwards | 3 |

Plus **2** tests that the detectors themselves are not vacuous - the fs-import
detector is shown catching a synthetic `writeFileSync`, and the mutation-name
detector is shown firing on the verbs it targets while NOT firing on `CUTOVER_TRANSFORM`
(which ends in "form") or `offsetMs` (which contains "set"). 19 in the file.

Claim 3 is AC-034:1041's "no admin or migration path may mutate a permanent class"
as a `git ls-files` scan: the allowlist is `permanentLedger.mjs` and
`retentionStore.mjs` alone, so an admin route or a migration that wanted the
permanent file would have to add itself to that scan's findings. There is no second
door because no second door exists in the tree.

Claim 5 is AC-034:1042's "a negative test per mutating method" taken literally: 25
verbs are each **attempted** (`store.delete("veto_decision", { fired: false })`)
rather than merely checked for absence, so a mutator reachable dynamically would
still be caught. The ledger's bytes are compared before and after. Records and
array views are frozen **on the way out as well as on the way in**, because a caller
holding a mutable veto record could edit it in place and the edit would not reach
the disk - so a reader would believe a change it never persisted.

**THE NAME DETECTOR MATCHES PER WORD, NOT PER SUBSTRING.** An earlier version used
`startsWith`/`endsWith` and flagged `CUTOVER_TRANSFORM`, which ends in "form". A
guard that cries wolf on its own constant gets deleted rather than fixed, so
matching splits on `_`, `-` and camelCase boundaries and compares whole segments -
which also stops `offset` matching `set`. `purge` is deliberately **not** in the verb
list, because two legitimate exports contain it; the purge family gets its own
exact-list assertion instead, which catches `purgePermanent` by naming it in the
expected set rather than by pattern.

### A hash chain is deliberately NOT here

A per-line digest chain would let a reader DETECT truncation after the fact. That is
a weaker claim than the one AC-034 asks for: no path to exist, not a way to notice
one. `shortDigest` (`retention.mjs:427-439`) is an IDENTIFIER, and its JSDoc says so
- it names an aggregate, a cutover and a removed set so two can be compared, and
nothing in D8's guarantee is trusted against tampering by it.

## AC-034: the purge is one-way and RECORDED

The cutover record, as produced by a real run against a fixture:

```json
{
  "kind": "retention_cutover",
  "retentionClass": "permanent_append_only",
  "cutoverId": "cut-42b3e489a880fbab",
  "transform": "one_way_irreversible",
  "transformVersion": "ws7.t15.d8.snapshot-to-daily-aggregate.v1",
  "runId": "e2e-real",
  "bucket": "2026-06-03",
  "symbol": "BTCUSD",
  "windowStart": 1780444800000,
  "windowEnd": 1780452000000,
  "removedCount": 3,
  "removedDigest": "d-180d0861f1f49985",
  "firstSnapshotId": "old-1",
  "lastSnapshotId": "old-3",
  "aggregateId": "agg-ac6d29074e058427",
  "aggregateDigest": "d-f955ad476789c609",
  "retentionDays": 90,
  "recordedAt": 1792065600000
}
```

Count, class, window and an identifier, as AC-034 requires - and **no removed
payload**: the cutover is evidence, and evidence that carries the data it is
evidence about is a second copy of what the purge removed. The test asserts
`serialised` contains neither `"ticks"` nor `"payload"`, and that no `snapshotIds`
key exists.

**THE RECORD SURVIVES THE PURGE.** A cutover is a permanent record in the
append-only ledger, so it is the one artefact the next purge cannot remove. Tested
directly: two consecutive real runs leave the FIRST run's cutover readable.

**THE `removedDigest` NAMES THE SET, NOT THE ORDER.** The ids are sorted before
hashing, so two stores holding the same three expired snapshots in opposite file
order produce the same `removedDigest` and the same `aggregateDigest`, while a store
holding a different set of three collides with neither. Both directions are tested.
Without the sort, a cutover record would be incomparable across any store that was
rebuilt or restored - which is exactly when a reader most wants to compare it.

## The dry-run safety proof

Three independent proofs, because one would be a claim rather than evidence.

**1. BYTE-LEVEL.** A recursive fingerprint - filename, size, **mtime** and content -
of the store directory is identical before and after a dry-run. The mtime assertion
matters: "the records are still there" would pass against a rewrite to identical
content.

**2. SYSCALL-LEVEL.** `appendFileSync`, `writeFileSync`, `renameSync`, `mkdirSync`,
`rmSync` and `unlinkSync` are counted around the run through a `vi.mock` over the
real `node:fs`, and all six are **zero**. This catches what a fingerprint cannot
see: a write-then-restore, or a temp file created and removed inside the run. The
proxy passes everything else through, so the store and the purge run against REAL
filesystem behaviour - a mock that fabricated results would prove nothing.

**3. BY THE CONTRAPOSITIVE.** The same store, the same `now`, under
`dryRun: false` plus the token, **does** change the bytes: 3 removed, 1 retained,
1 aggregate and 1 cutover appended. Without this, the first two proofs would also
pass against a purge that never writes anything at all.

Measured end to end through the CLI against a real fixture on disk:

    1. DRY RUN (no --execute)                exit=0   would remove 3  retain 1
       >>> DRY RUN CHANGED THE STORE?       NO - byte-identical, same mtimes
    2. --execute WITHOUT --confirm          exit=1   refused
       >>> STORE STILL UNCHANGED?           YES
    3. DRY RUN against apps/dashboard/server/data   exit=1   refused by the tree guard
       >>> server/data EXISTS AND IS UNTOUCHED?    yes (pre-existing, untouched)
    4. REAL RUN (--execute --confirm <token>)      exit=0
       wrote  true | removed 3 across 1 window(s) | aggregates appended 1 | cutovers appended 1
       SNAPSHOTS REMAINING:    ["young-1"]
       PERMANENT RECORD KINDS: ["veto_decision","daily_aggregate","daily_aggregate","retention_cutover"]

### What a real invocation would need, and why no test can reach it

**A real purge needs THREE independent grants, and the CLI is the only place all
three can be assembled:**

1. **The store must have been built as a purge target** -
   `createRetentionStore({ dir, purge: true })`. The flag defaults to `false`, and a
   store built without it reports `purgeable: false`, so `planSnapshotPurge` refuses
   it before reading a single record. This is KEY ONE.
2. **The call must pass `dryRun: false` AND the exact confirmation token** -
   `PERMANENTLY_DELETE_EXPIRED_SNAPSHOTS`, compared for exact equality. `dryRun`
   defaults to `true`, so a caller who forgets anything gets the safe behaviour.
   This is KEY TWO.
3. **The store directory must resolve OUTSIDE `apps/dashboard/server/`.**
   `assertPurgeTargetAllowed` refuses the tree, which contains `server/data` - the
   live store this repository has already had an incident with. Ordinary appends and
   reads there are still allowed; only the destructive verb is confined.

**Why no test can trigger it accidentally.** Every test store is a `mkdtempSync`
directory under the OS temp directory, and the helper that removes one refuses any
path it did not mint in this process. Crucially the path is canonicalised **once, at
mint**, and the delete targets that exact string - re-resolving at delete time would
follow any link that appeared in between, which is the failure mode that destroyed
real data twice in this repository's history. The only two tests that pass the token
pass it against a temp fixture, and both are deliberate.

The four tokens that *are* reachable are tested rather than trusted:
`dryRun` set to any of `undefined, null, 0, "", "false", "no", NaN, {}` is a
**dry-run**, because the check is `dryRun !== false`; 13 near-miss spellings of the
token (including a trailing space, a trailing newline, an underscore variant and one
character short) are all **refused**; and `--execute` against a store that was never
granted the purge verb is refused **with the correct token in hand**.

### Stated limits of the destructive path, not hidden

- **A purgeable store cannot live under `apps/dashboard/server/`.** That is a real
  limitation for a production install, recorded rather than papered over: T15 cannot
  distinguish a legitimate future `server/data/copilot-retention/` from a mistake, so
  it refuses the whole tree. Widening it needs a dated owner decision.
- **`rmdir /s /q`, `rm -rf` and `Remove-Item -Recurse -Force` are not used anywhere.**
  The purge's only removal is a `writeFileSync` to a sibling followed by a
  `renameSync` over the target, so a failure part-way leaves the ORIGINAL segment
  intact rather than a half-written one.
- **No `git worktree` was created.**
- **Nothing under `apps/dashboard/server/data/` was read for writing or written.**
  7,678 entries present, 0 modified during this task.

## The write ordering, demonstrated rather than claimed

`runSnapshotPurge` appends the aggregate, then the cutover, and only then rewrites
the raw segment. A returned "steps" array would only be a claim about that, so the
test makes the appends FAIL: the permanent ledger is replaced by a directory, the run
throws, and the three raw snapshots are then checked to still be on disk. The
assertion is that the deletion is the LAST step - which is the recoverable direction,
rather than a purge that destroyed data and recorded nothing.

Relatedly, a purge that cannot verify BOTH segments refuses before doing arithmetic:
`planSnapshotPurge` reads the permanent ledger as well as the raw segment, because a
raw-class row stranded in the permanent ledger is a row the next purge can never
sweep, and a purge that ignored it would report a clean plan while D8's 90-day
window was quietly being violated. A dry-run over such a store **throws** rather
than printing a plan over the half it happened to read.

## T11's existing veto wiring, completed rather than replaced

T11's `createVetoIndex` already accepted a `sink` (`vetoIndex.mjs:106`) and said at
`:26-32` that T15 owns what happens next. The seam is one function,
`store.vetoSink()` (`retentionStore.mjs`):

```js
const store = createRetentionStore({ dir })
const index = createVetoIndex({ sink: store.vetoSink() })
```

T11's veto entries carry `ruleId`, `fired`, `inputs`, `suppressed`, `evaluatedAt`,
`ruleVersion` and T11's own `retentionClass` tag - but no `kind`, because T11
predates D8's routing table. The sink adds `kind: "veto_decision"` and nothing else.
T11's module is **untouched**; its stamped tag is preserved verbatim; the test
asserts the persisted record equals `{ ...entry, kind: "veto_decision" }` and that
`persisted[0].retentionClass === VETO_RETENTION_CLASS`.

Six tests cover the integration: T11's in-memory read still agrees with the durable
copy; all six of T11's rules route to the permanent ledger; six fired and six
un-fired records both survive; a bare T11 entry handed to `append()` is refused with
a message pointing at `vetoSink()`.

**And the two modules are asserted to share ONE string.**
`retentionClassFor("veto_decision") === VETO_RETENTION_CLASS` is asserted in both
`retention.test.mjs` and the store test, so if T11's literal and T15's table ever
drift, a real veto record would be routed by one module's constant and classified by
another module's table, and nothing would notice until a purge ran.

## Why the store has no `PICC_*_DATA_DIR`

Every pre-existing per-service store in this repository is
`process.env.PICC_X_DATA_DIR || <the real server/data>`. That shape is how a
MISSPELLED variable became a real account written into gitignored live data - the
incident `ws7TestStoreIsolation.test.mjs` is built from - and a misspelling is
indistinguishable from an unset variable because both fall through to the default.

So `createRetentionStore` has **no default directory at all**: it throws when `dir`
is absent, empty, relative or not a string. A caller must name a path, so there is
nothing to misspell. Consequences, all deliberate:

- `retentionStore.mjs` reads **no** `process.env.PICC_*` variable and hardcodes **no**
  `new URL("../data")` fallback, so it does not appear in the isolation contract's
  coverage set and the guard is untouched.
- **`testSupport/storeIsolation.mjs` was NOT edited.** Adding a store to
  `ISOLATION_DIRECTORY_VARIABLES` would have required editing a file outside the
  `:73` d file-touch union, and T15 had no need to.
- The tests redirect nothing. A test store is a `mkdtempSync` path handed to the
  constructor.

## The readings T15 had to make, and which text won

1. **The class is derived from `kind`, never passed.** A `retentionClass` parameter
   would make the routing the thing under test into the thing under audit, and the
   tests would still pass. **AC-033:1034's "class-routing test" won.**

2. **A mislabelled record is REFUSED rather than silently corrected.** The derived
   class is right by construction, so coercion would have worked - but a record that
   disagrees with its own kind is corrupt, and coercion hides that. **The honesty
   contract at `:79` won over convenience.**

3. **A cutover is permanent.** The alternative - the cutover in its own mutable file
   - would mean the evidence of a purge is erasable. **D8:164's "recorded cutover"
   won over a tidier file layout.**

4. **Both permanent classes share one file.** Simpler to protect, and it makes the
   purge's single rewrite target unambiguous. **The structural requirement won over
   one-file-per-class.**

5. **The purge's target must be outside `apps/dashboard/server/`.** This is a real
   production limitation, and the alternative - allowing the tree - would put the one
   destructive verb in this repository one `rmdir` away from the data two agents have
   already destroyed. **The conservative default won**, with the limitation recorded
   above and in the error message itself.

6. **A dry-run that cannot verify the store THROWS.** It could have printed a partial
   plan, and "a dry-run always succeeds" sounds friendlier - but a plan over the half
   of a store the tool could read is a plan about a hypothetical. **AC-034's
   "no silent pass" won.**

7. **The store stamps the derived class and nothing else.** No `recordedAt`, no
   `sequence`: a veto record's time is T11's `evaluatedAt`, and a store that stamped a
   second one would leave a reader with two answers to "when". **D8's purpose won
   over convenience.**

8. **The store directory is unconstrained for appends.** An earlier draft refused the
   server tree at construction, which would have made a retention store impossible to
   install at `server/data/copilot-retention/` alongside every other store, over a
   concern that only applies to the destructive verb. **Usability won, and the refusal
   moved to `assertPurgeTargetAllowed`.**

## Files

Added - ten, all inside the `:73` d union (`apps/dashboard/server/services/**`,
`scripts/**` and `docs/trading-logic/changelog/**`), all new, nothing tracked
modified:

- `apps/dashboard/server/services/copilot/retention.mjs` - the class table, the 90-day
  window, and the one-way transform. Pure: no clock, no filesystem, no randomness, no
  imports at all.
- `apps/dashboard/server/services/copilot/permanentLedger.mjs` - the ONLY writer of a
  permanent record, holding an append-only filesystem capability.
- `apps/dashboard/server/services/copilot/retentionStore.mjs` - the persistence layer:
  routes an append by derived class, exposes `vetoSink()`, class-checks both segments
  on read, and grants the purge verb only on request.
- `apps/dashboard/server/services/copilot/purgeSnapshots.mjs` - the purge job. Dry-run
  by default; two keys for a real run; append-aggregate, append-cutover, then rewrite.
- `apps/dashboard/server/services/copilot/__tests__/retention.test.mjs` - 23 tests.
- `apps/dashboard/server/services/copilot/__tests__/retentionStore.test.mjs` - 30 tests.
- `apps/dashboard/server/services/copilot/__tests__/purgeSnapshots.test.mjs` - 24 tests.
- `apps/dashboard/server/services/copilot/__tests__/permanentAppendOnlySurface.test.mjs` - 19 tests.
- `scripts/purge-snapshot-retention.mjs` - the CLI. A bare invocation prints usage and
  exits 1 without opening anything.

**Not edited:** `vetoIndex.mjs` (T11's seam is consumed through the `sink` it already
accepted), `engine.mjs`, `confluence.mjs`, `tiers.mjs`, `tierBoundaryFixture.mjs`,
`regime.mjs`, `marketState.mjs`, `riskLayer.mjs`, any `vetoes/*`, `conflicts/*` or
`experts/*` module, `routing.mjs`, `explain.mjs`, `modelLayer/*`, any pre-existing
test, `testSupport/storeIsolation.mjs` and
`testSupport/vitestStoreIsolation.setup.mjs` (both byte-identical - see the guard
incident above, which was fixed in T15's own comments precisely so that they could
stay that way),
every guard value, both lockfiles, `server/data/`, `.playwright-tmp/`, and
`apps/dashboard/src/**` in its entirety.

## Verification

- `npm run typecheck` - clean, exit 0.
- `npm run test --workspace @picc/dashboard`, run twice: **4697 passed / 1 skipped /
  0 failed** both times (357 files: 356 passed, 1 skipped). The floor entering this
  task was 4602 passed / 1 skipped / 0 failed; T15 adds 96 tests.
  Measured note: the pre-change baseline on this host was 4599 passed / 3 failed /
  1 skipped, with three 5-second timeouts across two runs hitting different files
  (`handlers.test.mjs`, `authMeStatus.test.mjs`) - the documented load flake.
- **The FIRST post-commit run was red** - `ws7TestStoreIsolation.test.mjs`, 6
  assertions - for the reason set out above, and it was not the load flake. Fixed in
  T15's own comments, never in the guard. The suite was then re-run twice more after
  the fix, and the final two runs were green. That ordering matters: the guard only
  reads a store it can see through `git ls-files`, so every pre-commit run in this
  task was measuring the wrong thing about this specific risk.
- `git diff --check` - clean, exit 0. `git diff --name-only` - empty (nothing tracked
  was modified). Ten new files, all inside the union.
- Nothing under `apps/dashboard/src/`, no lockfile, no `server/data/`, no
  `.playwright-tmp/`.
- E2E not run, per instruction. Not pushed.

## BS-3 handoffs named, not silently trimmed (D27)

Nothing under `apps/dashboard/src/` was touched, so none of these could land in T15.
BS-2's "must not touch" column is room visuals (`:1397`).

| # | Handoff | Why it could not land in T15 |
|---|---|---|
| 1 | **Surface the retention store's contents.** Nothing reads `readCutovers()` outside the tests. D8:162's argument - that a veto record is the evidence a safety rule worked - presumes somebody can look at it. | A room surface is BS-2's forbidden column, and the instruction forbade `apps/dashboard/src/` |
| 2 | **Schedule the purge.** T15 delivers the job; nothing schedules it. | The scheduler is `server/services/scheduler.mjs`, wired from `vite.config.ts`; T19 and T20 own the scheduled-work and cross-room gates |
| 3 | **`retention_cutover` and `retention_cutover`'s shape are T15's own.** D8 names the three classes, not this kind. An owner ruling that the cutover belongs in its own readable file - or that it needs a fourth class - is owed. | T15 invented the kind to satisfy D8:164; §4.3's union is the owner's |
| 4 | **A purgeable production store must live outside `apps/dashboard/server/`.** See "Stated limits". | Needs a dated owner decision; T15 took the conservative default |
| 5 | **Nothing writes score breakdowns or execution receipts yet.** The store persists them and the class table routes them, but no module produces them. T11 produces veto records; the engine result is not yet decomposed into a stored breakdown. | The producers belong to whichever task persists an `ExecutionTier` or a fill. T15 owns the destination, not the source |