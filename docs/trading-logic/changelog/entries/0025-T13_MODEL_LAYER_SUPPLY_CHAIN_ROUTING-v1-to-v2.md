# 0025 - T13_MODEL_LAYER_SUPPLY_CHAIN_ROUTING v1 -> v2

Execution record for WS-7 task T13: the model layer, the D15 supply-chain gate,
the D16 cloud-routing predicate, and the explanation layer. The only task in
BS-2 that touches the network, downloads an artifact, and changes CI.

rule: T13_MODEL_LAYER_SUPPLY_CHAIN_ROUTING
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0025-T13_MODEL_LAYER_SUPPLY_CHAIN_ROUTING-v1-to-v2.md)
date: 2026-10-01
historicalTradesAffected: none
source: >-
  WS-7 task T13 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1309-1316`,
  decision D15 (`:220-227`), decision D16 (`:229-236`), decision D17 (`:238-245`,
  named only to mark the boundary T13 does not cross), requirement R10
  (`:434-438`), acceptance criteria AC-031 (`:1013-1019`), AC-032
  (`:1021-1027`) and AC-040 (`:1085-1091`), the architectural boundary at
  section 4.1 (`:533`), the proposed module layout at section 4.2 (`:539-566`,
  with `experts/sentiment.mjs` at `:548`, `routing.mjs` at `:563` and
  `explain.mjs` at `:565`), the honest-rendering rule at `:747`, the B11 row at
  `:732`, the freeze invariants at `:73` (d), the bisect matrix row BS-2
  (`:1397`), honesty note 6 (`:1464`), and plan v1 section 3.3 (`:250-269`) with
  its Risk 6.

reason: >-
  T11 built the decision path and deliberately left one hole in it.
  `experts/sentiment.mjs:6` says "THIS IS THE MODEL SEAM AND T11 DOES NOT FILL
  IT", and `:28` says "evaluate() takes the value the model layer put on
  state.sentimentInput and validates its shape; T13 wires the producer." T12
  and T16 landed around it without touching that hole. As of `f1567ef` the 5%
  Sentiment expert was therefore permanently unavailable — an honest state, and
  the one section 4.1:533 requires when no model exists, but the seam had a
  consumer and no producer, which is an incomplete task rather than a deferred
  one.

  T13 also carries the two controls that make a model layer safe to have at all.
  D15 is a supply-chain rule ("SHA-256 verified, safetensors/.cact only, never
  pickle") with no implementation anywhere in the tree, and D16 authorises cloud
  inference for a two-case slice with no predicate to hold the boundary. Both are
  P0, and both are invisible until something exists that could violate them.

## The artifact: obtained, pinned, and honestly bounded

**The model was obtained.** `Cactus-Compute/needle3` — Needle 3, the model
T13:1310 names — is published on Hugging Face under Apache-2.0, ungated, and
`needle3.cact` was downloaded and measured in this environment:

    bytes   35,335,380
    sha256  c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38
    magic   84 2a e1 05   (the .cact container prefix)

Both numbers are pinned in `modelManifest.mjs` and asserted against a test, so
neither can drift silently. The 242 MB `checkpoints/needle3.safetensors` sibling
is **declared and not loaded**: T13 pins the `.cact`, and computing a digest for
a quarter-gigabyte file nothing would ever verify would be a claim dressed as a
control. Its row says so, and `validateManifest` REFUSES a `declared` entry that
carries a digest.

The bytes are **not committed.** `models/.gitignore` excludes them — expressed
inside the directory it governs, because the root `.gitignore` is outside this
task's file-touch whitelist (spec `:73` d). The 35 MB file is present in the
working tree and in CI; the *pin*, which is the part that carries meaning, is
committed.

### What could not be obtained, and exactly what that means

**There is no inference runtime for this repository's dev host, so the model does
not run in-process anywhere in this repository.** Three measured facts, not
assumptions:

1. Cactus publishes no npm package for its runtime.
2. Needle 3's repository publishes `linux-*`, `macos-*`, `android-*`, `ios-*`,
   `tvos-*` and `wasm` builds — and **no `windows-*` build at all**.
3. The dev and test host is Windows x86-64.

So `modelLayer/sentimentModel.mjs` takes an **injected backend**, and the default
is `null`, with `defaultBackendAbsenceReason()` naming precisely what is missing.
The alternative — a stub returning `0` — would be a fabricated neutral sentiment
wearing the costume of a working model, which is the first thing section
4.1:533 forbids. A test asserts the default path returns `input: null` and never
a number.

**The consequence is worth stating plainly: the engine scores on 95% with an
honest confidence penalty in every environment this repository can run in, with
the artifact present and verified.** T13's bisect line (`:1316`) is therefore
true not only when the model layer is removed but also when it is present and
unusable — a stronger property than the spec asked for, and measured rather than
asserted.

### What a real environment must still do

1. Run on a platform with a Needle runtime (linux-arm64, macos-arm64, android-arm64
   or the wasm build) and register a real backend satisfying
   `{ id, sentimentOf(texts: string[]): number }` returning a finite number in
   -1..1.
2. Close the `executedVerdict` on all three ARM64 rows, which needs the device.
3. Resolve the `llamaCpp` row, which needs the GitHub release assets rather than
   the npm channel.
4. Decide whether the 242 MB safetensors sibling becomes a second pinned
   artifact, and update the manifest rather than hand-placing the file.

## AC-031 — the model computes no indicator, regime, veto or tier

Section 4.1:533 is the boundary: "the model may contribute the 5% Sentiment
expert's input and may write prose, and it may do nothing else." Plan v1
section 3.3:257-258 says how to enforce it: "by walking the import graph from
confluence.mjs/tiers.mjs/vetoes/*, not by grepping for a filename."

### The import graph is walked, not grepped

`__tests__/modelIsolation.test.mjs` parses every module's real specifiers — all
four forms (named import, bare side-effect import, re-export, dynamic
`import()`) — resolves the relative ones against the filesystem, and BFSes from
21 declared entry points: `engine.mjs`, `confluence.mjs`, `tiers.mjs`,
`regime.mjs`, `marketState.mjs`, `vetoIndex.mjs`, `riskLayer.mjs`, all six
`experts/*`, all six `vetoes/*` and `conflicts/index.mjs`.

A grep would be defeated by a re-export, an alias, or a one-character change. The
graph cannot be. Measured results:

- The closure reaches **no** module under `modelLayer/`.
- The closure reaches **neither** `explain.mjs` **nor** `routing.mjs`.
- `experts/sentiment.mjs` has **no** import of the model layer at all.
- The closure of `explain.mjs` does **not** contain `engine.mjs` — the dependency
  runs engine <- explain, so the prose cannot compute a score.
- `modelLayer/sentimentModel.mjs` imports exactly `./digestGate.mjs` and
  `./modelManifest.mjs` and nothing else, so the producer cannot reach the engine
  either.
- The walk is not vacuous: it is asserted to reach `engine.mjs`, `confluence.mjs`,
  `tiers.mjs`, `experts/sentiment.mjs` and `vetoes/newsLockout.mjs`.

### T11's consumer is byte-for-byte unmodified

`experts/sentiment.mjs` keeps T11's exact SHA-256
(`56530b03a3c5717ad3af6dc4f267b29a30116280e95169dc5aa05433fed2adc2`), pinned in
the test. T13 filled the seam's **producer** and did not touch the consumer. That
is the strongest available form of AC-031's claim: the module sitting on the
decision path has no import edge to the model, and a test fails if anyone adds
one.

### Model PRESENT vs ABSENT vs ADVERSARIAL

AC-031:1018 asks for "a test asserting the deterministic engine's result is
identical when the model is replaced by a stub returning garbage for
indicator-shaped values." All three runs are built from T11's own
`fullMarketState()` so the candles, daily closes, 4H candles and `computedAt` are
byte-identical between them — asserted — leaving `sentimentInput` as the only
variable.

The adversarial input is the model's own `{ score, source }` **plus** `adx:
99.9`, `bbw: 0.0001`, `atr: 0`, `ema50: -1`, `ema200: 1`, `vwap: 999999`,
`stochRsi: 1`, `divergence`, `supportResistance`, `fibonacci`, `regime:
"deadZone"`, `tier: "ignore"`, `veto: { fired: true }`, `vetoes: [...]`,
`confluenceScore: 0`, `coveragePct: 100`, `confidence: "high"`,
`automationPermitted: true`, `rung: "live"`, `action: "autoExecute"`,
`riskPct: 1`, `conflictOverrides: ["C1","C2","C3"]`, `activeBoosters: ["unicorn"]`
and `weightPct: 100`.

Every one of those moves **nothing**:

| Assertion | Result |
|---|---|
| Whole engine result, minus the 5% row, byte-identical PRESENT vs ADVERSARIAL | equal |
| The three scalars the 5% row legitimately moves, compared directly | equal |
| The five surviving experts' rows, all three runs | equal |
| `tier`, all three runs | equal |
| `vetoes` and `firedVetoes`, all three runs | equal |
| `regime`, all three runs | equal |
| `tier.automationPermitted` / `tier.rung` vs the model's `true` / `"live"` | equal |
| `tier.tier` vs the model's `"ignore"` / `"autoExecute"` | equal |
| `firedVetoes` vs the model's `veto: { fired: true }` | equal |
| Sentiment `weightPct` vs the model's `weightPct: 100` | still 5 |
| `score` delta between PRESENT and ABSENT | at most the 5% weight |
| ABSENT `coveragePct` | exactly 95, no renormalisation |
| 100 runs with the adversarial model | byte-identical |

**`score` is the one key deliberately absent from the garbage block**, and the
reason is worth recording. `experts/sentiment.mjs` destructures `{ score,
source }`, so a model returning `score: 0` is returning a *sentiment reading of
zero*, which the engine is entitled to map onto the plus/minus 5 band. An earlier
draft of this test put `score: 0` in the garbage list "as a confluence score",
and the headline assertion failed by exactly 1.5 points. That failure was correct
behaviour; rather than delete the key and lose the finding, the test now calls it
out and pins the distinction with its own case — `score: 0` moves the 5% row and
nothing else. The comparison helper is explicit that it removes precisely the
sentiment row plus the three scalars that row legitimately moves, and those three
are then compared directly rather than swept into a string equality.

### No weight or band is restated

Plan v1 Risk 6 is inherited. The 5% figure is read from
`experts/sentiment.mjs`'s own `WEIGHT_PCT` and cross-checked against
`confluence.mjs`'s `EXPERT_WEIGHTS` at test time; the score-delta bound is
derived from the latter rather than written as the number 5. The plus/minus 5
band, the 85/70 tier boundaries and the weight sum stay in T11's files, which T13
did not edit.

## AC-032 — digest-pinned, and pickle-free by content

### Content, not filename

`modelLayer/artifactFormat.mjs` recognises the two permitted formats from their
**bytes** and refuses everything else:

- **safetensors** — a `u64` little-endian header length, then that many bytes of
  JSON **object**. Read from the real file: the first 8 bytes of
  `needle3.safetensors` are `38 20 00 00 00 00 00 00` = 8,248, followed by a JSON
  object beginning `{"__metadata__": ...`.
- **.cact** — the four-byte prefix `84 2a e1 05`, read from the real
  `needle3.cact`. Its provenance is recorded as **OBSERVED, not DOCUMENTED**:
  Cactus publishes no `.cact` format specification, and the manifest says so
  rather than letting a constant look like a published spec.

The pickle classifier exists only to tell an operator *why* a file was refused; it
never grants permission. Deny-by-default is what makes the control real — a
detector built only from "is this a pickle?" would pass a renamed-pickle test
while accepting any format nobody thought of.

Cases an extension check cannot catch, all tested:

| Bytes | Named | Verdict |
|---|---|---|
| pickle protocol 4 (bytes `80 04`) | `model.safetensors` | **refused**, `format: "pickle"` |
| pickle protocol 4 | `model.cact` | **refused**, `format: "pickle"` |
| pickle protocol 4 | `model.dat`, `.pkl`, `.bin`, `.pt` | **refused** |
| pickle protocol 0 text (`c__builtin__` ...) | any | **refused**, `format: "pickle"` |
| a `torch.save` ZIP carrying `archive/data.pkl` | `model.safetensors` | **refused**, `format: "pickle"`, `signature.member: "archive/data.pkl"` |
| a bare ZIP with no pickle member | any | **refused**, `format: "unknown"` |
| random bytes, a PNG, an ELF shared object, empty, 3 bytes | any | **refused**, `format: "unknown"` |
| a truncated safetensors header | any | **refused** as a corrupt download, with the declared and actual lengths |
| a header whose JSON is an array | any | **refused** |

**The mirror is what gives the refusals meaning.** `detectArtifactFormat` takes
bytes and has no filename parameter (asserted: `length === 1`), and `.cact` bytes
are **accepted** whatever the file is called. A detector that refused everything
would also pass the first table.

`torch.save` deserves its own line: a torch checkpoint is a **ZIP** archive whose
loader executes its `data.pkl` member. "It is a ZIP, and ZIPs are safe" is exactly
the wrong conclusion — which is why the ZIP branch reads member *names* only. It
never allocates a member and never touches its bytes, so a zip bomb costs it
nothing.

### The gate fails on absence, and that is the deliverable

`scripts/model-digest-gate.mjs` is the CLI at the path T13:1312 names;
`modelLayer/digestGate.mjs` is the core it calls, so a failure is a returned
report rather than an exit code and most tests do not need a subprocess. Ten
named codes; a caller branches on the code and never on a message.

Checked, in D15's order: manifest well-formed, required markers present, artifact
**present**, digest pinned, digest matches, size matches, format allowed, nothing
else in the directory.

**The absent case is the first test in the file and it asserts a non-zero
result.** Measured behaviour:

    > node scripts/model-digest-gate.mjs --model-dir <empty dir> --json
      "ok": false
      "failures": [ { "code": "gate:artifact-absent", ... } ]
      exit code 1

A gate that has never seen its artifact has verified nothing, and reporting
success would be the honesty contract's central failure applied to a supply
chain. The test also asserts the failure message contains no "skipped" or
"ignored", and that no check row reports `passed: true` for the missing artifact
— the shape a reader skims past.

Also refused, each with its own test: a **missing** digest (a null, a truncated
12-character prefix, and an uppercase-hex digest are all `gate:digest-missing`,
because AC-032:1025 says a missing digest must fail rather than warn); a
**tampered** artifact (one flipped byte, same length, same format — the case a
size or format check passes — with both digests named in the failure); a
**declared** artifact given a digest nobody verifies; and a **planted** pickle
alongside a valid artifact, which is AC-032's actual scenario and which produces
BOTH `gate:undeclared-artifact` and `gate:format-forbidden`, because those are two
problems and the format one is the urgent one.

`--fetch` is a separate verb from verification on purpose. Obtaining an artifact
and checking it are different acts, and a gate that fetched as a side effect of
verifying would have no failure state for a missing file. The download's digest
is checked **before** the file is allowed to stay on disk and a mismatch deletes
it — without that ordering a corrupt download would sit in the directory and the
gate would be one diagnostic away from being re-run into a pass by someone who
edited the pin.

## AC-032's markers — measured, or explicitly `UNVERIFIED`

T13:1314 requires ARM64 availability for ONNX Runtime / llama.cpp to be "measured
or explicitly `UNVERIFIED`", and honesty note 6 (`:1464`) requires vendor claims
recorded as `UNVERIFIED`. Prose cannot fail a build, so every marker is a named
record with a verdict from a **closed vocabulary** (`MEASURED` | `UNVERIFIED`),
and deleting a row breaks the gate.

The rows split **published** from **executed**, because "ARM64 availability"
covers two facts a single word cannot honestly hold at once, and only the first
was answerable from an x86 host:

| Component | Published | Executed |
|---|---|---|
| `onnxruntime-node@1.30.0` | **MEASURED** | `UNVERIFIED` |
| `llama.cpp` / `node-llama-cpp@3.22.1` | `UNVERIFIED` | `UNVERIFIED` |
| `Cactus-Compute/needle3` | **MEASURED** | `UNVERIFIED` |

The evidence, which is in `modelManifest.mjs` verbatim:

- **ONNX Runtime.** The published npm tarball contains
  `package/bin/napi-v6/linux/arm64/libonnxruntime.so.1` (25,135,496 B) and
  `package/bin/napi-v6/linux/arm64/onnxruntime_binding.node` (394,648 B), plus
  `win32/arm64/onnxruntime.dll` and `darwin/arm64/libonnxruntime.1.30.0.dylib`.
  The package's own `os` field is only `["win32","darwin","linux"]`, so the
  tarball is the only place the question is answerable. This row therefore
  **upgrades from `UNVERIFIED` to `MEASURED` for publication** — which is a real
  finding, not a formality: this environment could answer it, and did.
- **llama.cpp.** llama.cpp publishes **no** first-party npm package, and the
  third-party binding ships **zero** prebuilt native binaries in its tarball: its
  11 arm64/aarch64-named entries are CMake cross-compile configs
  (`linux.host-arm64.target-*.cmake`) plus a `bins/_linux-arm64.moved.txt` marker
  saying the prebuilt binaries were moved out of the npm package. The arm64
  binaries are distributed somewhere this task did not reach, so the npm channel
  cannot answer the question and the row stays `UNVERIFIED` rather than becoming
  `MEASURED`-with-a-guess.
- **Needle 3.** The file listing includes `linux-arm64/needle` (1,168,392 B) and
  `linux-arm64/libneedle.a` (1,540,974 B) — **and no `windows-*` entry at all**,
  which is the measured absence that makes the injected backend necessary.

Execution is `UNVERIFIED` for all three: no ARM64 device was involved, and
publication is not execution. A test asserts all three rows say so, and asserts a
`MEASURED` row without evidence fails the gate.

**B11 keeps its own marker intact.** Spec `:732` reads "**MEASURED
(vendor-reported, `UNVERIFIED`)** — 8-29 MB, 29-121M params, CQ2 2-bit,
android-arm64, peak_ram_mb 28.5". T13 does not flatten that to either "measured"
or "unmeasured": the figures ARE reported and they ARE unverified, and dropping
either half misleads in a different direction. `B11.verdict` is `UNVERIFIED`,
`provenance` is `vendor-reported`, `independentlyVerified` is `false`, and the
comparative claim ("beats DeepSeek V4 Flash") is classified **`marketing`**, per
honesty note 6. A test fails the gate if any of that is promoted.

T13 measured the artifact's real size (35,335,380 B) and digest. That is a
*different* measurement from B11's vendor-reported in-process footprint; neither
supersedes the other, and neither is presented as verifying B11. The row says so.

## AC-040 — the routing predicate

`routing.mjs` is pure and answers one question: **may this operation leave the
device?** It builds no client, holds no key, chooses no provider and makes no
request. D16's boundary is the deliverable; D16's transport is somebody else's,
and building it first would mean the boundary was whatever the client allowed.

D16:232 permits exactly two cases, and the matrix test evaluates every
operation-by-tier cell — 8 operations x 6 tiers = 48 — computing the expected
verdict from the rule **restated in the test**, not imported from the
implementation. The cloud set is pinned as the exact list of (operation, tier)
cells that route cloud, not as a count, because a count is satisfied by the wrong
two operations.

- an A+ **setup** routes to cloud with `provenance: "copilot: remote"`
- a **veto-boundary** decision routes to cloud at *every* tier, deliberately: a
  veto-boundary decision is a decision about the veto boundary itself, so it is
  exactly the case that arises when the score did **not** clear A+. Requiring A+
  as well would make D16's clause (b) unreachable in the situation it was written
  for.
- every other operation, and every other setup tier, routes local

**Fails closed, never open.** Twelve malformed descriptors — `null`, a string, a
number, `{}`, an unknown operation, a differently-cased operation, a tier with
whitespace, a numeric tier, a boolean tier, an array — all route **local**, and
each is named in the failure reason. There is no code path from an unrecognised
descriptor to `cloud`. D16:234 gives the reason: "'Send it to the cloud' without a
boundary turns a local decision system into a remote one whose behavior changes
when a provider changes." A refused input is also marked `recognised: false`, so
a typo'd operation is distinguishable in an audit from a deliberate local
decision.

**A cloud response can never become a decision input.**
`assertNotDeterministicInput(value, slot)` throws for `score`, `veto` and
`execution`, and the check keys on `provenance` rather than on `route`, so a
caller who rebuilds the object and drops `route` is still caught. An object with
no provenance is treated as not-local: a value that does not say where it came
from has not earned the right to be a score.

**Provenance literals.** `REMOTE_PROVENANCE` is the exact string `contracts.ts:99`
declares and that `ws6TerminalSeamGuard` regex-pins; a test re-asserts the
literal is still in that file, so the two cannot drift. `LOCAL_PROVENANCE` is
deliberately **not** the remote literal: `CopilotProvenance` is a single-member
union, so if a locally-computed explanation carried `"copilot: remote"` a reader
could not tell it from a provider's — the confusion AC-014 treats as a prohibited
side effect. A test asserts no local route ever returns the remote literal.

Purity is asserted against the module's own source: no `Date.now`, no `new Date`,
no `performance.now`, no `Math.random`, no `fetch(`, no `node:fs`/`net`/`http`,
no `require(`, no `await `, and **no imports at all** — the same defence T16 used
for its collision detector.

## The explanation layer

`explain.mjs` is pure, imports exactly one module (`./routing.mjs`, for the two
provenance literals), and **cannot import the engine**. It consumes an
`evaluateCopilot` result and quotes it. If it could import `engine.mjs` it would
be one refactor away from computing a score, and the only thing preventing that
would be a convention — so the dependency runs the other way and a test asserts
the import list is exactly `['./routing.mjs']`.

The returned object carries no decision field **at all**: `score`, `tier`,
`riskPct`, `action`, `vetoes`, `automationPermitted`, `rung`, `regime`,
`confidence`, `contributions` and the rest are exported as `PROSE_FORBIDDEN_KEYS`
and asserted absent by name, and no value is an object or an array. A caller
reaching for `explanation.tier` gets `undefined` rather than a plausible number,
which is the strongest form of the `contracts.ts:121-139` distinction between
`CopilotExplanation` and `ConfluenceScore`.

Every number in the prose is quoted from the engine's own result, and a test
enumerates every numeral in the output and requires each to be a quoted engine
value or a count the module wrote itself.

**One judgement call, recorded because it is a real limit on the prose.** The
engine's `score` is an unrounded float — `61.777777777777786` on the test
fixture — because `tiers.mjs` owns an exact, unrounded 85/70 boundary. Printing
that raw would quote arithmetic residue as the score and invite a reader to
compare `61.777777777777786` against the `85` boundary and draw a conclusion the
engine never drew. So the prose shows `score.toFixed(2)` and marks it "about",
and the exact value travels beside it as `exactScore`, a **string**, so a
renderer can display it and nothing can compute from it. Two decimals is safe
only because the tier has already been decided: the prose quotes `tier.tier`,
which `tiers.mjs` computed from the unrounded value. This is presentation, not a
second copy of the boundary, and no weight or cut-point is restated.

An absent model yields `status: "unavailable"` with a non-empty reason and
`text: null` — never a plausible paragraph. Every non-`ready` status returns null
prose, because a cached paragraph served as `stale` is prose that looks live. A
remote explanation must name the model that wrote it; T16 refused an
unattributed automation grant for the same reason, and this is the same defect.
`at` is a caller-supplied argument and no clock is read, for the same reason
T16's permit store made its timestamp one.

## The bisect line, measured

T13:1316 — "The model layer is fully disableable — with it removed, the
deterministic engine still scores, with Sentiment unavailable and an honest
confidence penalty."

Measured with the model layer in place and switched off:

- the engine still produces a `ConfluenceScore` and an `ExecutionTier`;
- Sentiment is `available: false` with a reason naming the disable, and
  `rawDelta: null` — never `0`, which would be a fabricated neutral;
- `coveragePct` is exactly 95, not 100;
- each of the five survivors' `weightedPoints` is **identical** to its value with
  the model present, which is the no-renormalisation property;
- the confidence reflects the gap;
- the backend is never called.

And because the import graph contains no model module at all, deleting
`modelLayer/` changes nothing about how the engine computes. The bisect is
structural, not a switch.

## The T13 file-list / whitelist tension, and how it was resolved

T13:1312 names "the model artifact directory and digest manifest, CI config".
Three of those four are inside the file-touch union at spec `:73` d:
`scripts/**`, `apps/dashboard/server/services/**`, and the model directory plus
manifest, which live under `services/copilot/models/`.

**`.github/workflows/ci.yml` is NOT in that union**, and `:73` d says "Any path
outside this union needs a dated spec amendment." So the spec requires an
amendment for a file its own task list names. The two texts contradict.

**Resolution taken:** the CI job landed, and the required amendment is recorded
here as an **open item** rather than the edit being made silently. A comment at
the top of the job says the same thing, so a reviewer reading `ci.yml` does not
have to find this file first. The job is deliberately **not**
`continue-on-error`: a gate that cannot fail a build is not a gate, and D15:223
says the rule is "enforced as a CI gate". The open item is:

> **Spec amendment required (dated, owner-ruled).** Add `.github/workflows/**` to
> the WS-7 file-touch union at
> `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:73` d, or
> record an equivalent standing authorisation for CI-gate edits. Without it,
> T13's only file outside the union is a 28-line additive CI job whose removal
> would silently disarm D15's enforcement.

The alternative considered and rejected: leaving the gate out of CI because its
path needs an amendment. That would satisfy the whitelist by making D15
unenforceable, which is the worse of the two failures.

The **root `.gitignore`** is also outside the union and was equally not touched.
The 35 MB artifact is instead excluded by a `.gitignore` **inside** the directory
it governs, which git honours and which needs no amendment — so that half of the
problem had a clean answer and the CI half did not.

## BS-3 handoffs named, not silently trimmed (D27)

The explanation layer's **render** is BS-3. Nothing under `apps/dashboard/src/`
was touched — `git status` shows zero changes there — so the prose has no consumer
yet. Recorded here rather than dropped.

| # | Handoff | Why it could not land in T13 |
|---|---|---|
| 1 | **Render the explanation in a room.** T13 delivers the server-side producer: `explainDecision(result, { provenance, model, at })` and `explainUnavailable({ reason, status, provenance, model, at })`, returning the `contracts.ts:101-110` shape. | BS-2's "must not touch" column is **room visuals** (`:1397`), and the instruction for this task forbade `apps/dashboard/src/` |
| 2 | **The `at` / `generatedAt` rename.** `contracts.ts:105` names the field `generatedAt`; this module calls it `at` because it is a caller-supplied input and not something the module generates. A renderer binding to the contract must read `explanation.at` into `generatedAt`. | A client-side type change is a `src/` edit, and BS-2 must not touch it |
| 3 | **`exactScore` is not in the contract.** The contract has 7 fields; this module returns 8. A renderer may display `exactScore`; it must not feed it to arithmetic. `cacheExpiresAt` is deliberately **absent** rather than null, and a test asserts the absence so a future default is a deliberate change. | Same |
| 4 | **`isAdmissibleAsSignal` does not exist.** `contracts.ts:130` names it in a comment as the guard that keeps remote text from becoming a signal, and it is implemented nowhere in the tree. T13's server-side equivalent is `routing.mjs`'s `assertNotDeterministicInput`. The client-side function is still owed. | A `src/` addition, and inventing it from a comment would be a second definition of a boundary |
| 5 | **No cloud transport exists.** `routing.mjs` is the predicate only. Whoever builds the Groq/OpenRouter client must call `routeFor` first, must mark every returned value `provenance: "copilot: remote"`, must redact, and must budget — D16:236's four obligations, none of which are implemented. | Building a network client would have meant the boundary was whatever the client allowed, and T13's own bisect would no longer be a bisect |
| 6 | **No caller of the sentiment reader.** `createSentimentReader` is constructed by a test and by nothing else. T18 owns the digest's sources under D17, and it is T18 that will first supply `headlines` with provenance. | T18's scope; adding a news source here would cross D17 |
| 7 | **The real inference backend is unwritten and unwritable here.** See "What a real environment must still do". | Measured absence of a Needle runtime for this platform |

## Files

Added:

- `scripts/model-digest-gate.mjs`
- `apps/dashboard/server/services/copilot/routing.mjs`
- `apps/dashboard/server/services/copilot/explain.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/artifactFormat.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/modelManifest.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/digestGate.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/sentimentModel.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/__tests__/artifactFormat.test.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/__tests__/modelManifest.test.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/__tests__/digestGate.test.mjs`
- `apps/dashboard/server/services/copilot/modelLayer/__tests__/sentimentModel.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/routing.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/explain.test.mjs`
- `apps/dashboard/server/services/copilot/__tests__/modelIsolation.test.mjs`
- `apps/dashboard/server/services/copilot/models/.gitignore`
- `apps/dashboard/server/services/copilot/models/README.md`

Edited — one file, 28 lines added and none removed:

- `.github/workflows/ci.yml` (the `model-supply-chain` job). Outside the `:73`
  union; see the amendment note above.

**Not edited:** `experts/sentiment.mjs` (byte-identical to T11, its digest pinned
in a test), `engine.mjs`, `confluence.mjs`, `tiers.mjs`, `tierBoundaryFixture.mjs`,
`regime.mjs`, `marketState.mjs`, `riskLayer.mjs`, `vetoIndex.mjs`, any
`vetoes/*`, `conflicts/*` or `experts/*` module, any `__tests__/fixtures/*` file,
`contracts.ts`, every pre-existing test, every guard value, and
`apps/dashboard/src/**` in its entirety.

Untracked by design: `models/needle3.cact` (35,335,380 B), excluded by
`models/.gitignore`. Also unchanged: both lockfiles, `server/data/`,
`.playwright-tmp/`.

## The readings T13 had to make, and which text won

1. **`score` is the sentiment reading, not a leak.** The adversarial-stub test
   initially listed `score: 0` among the garbage keys and the headline assertion
   failed by exactly 1.5 points. `experts/sentiment.mjs:61` destructures
   `{ score, source }`, so the key is the model's one permitted number.
   **The expert's own contract won**, and the test now pins the distinction
   rather than hiding it.

2. **`.cact`'s magic is OBSERVED, not DOCUMENTED.** Cactus publishes no format
   spec, so the four bytes are recorded with that provenance. The digest pin is
   the primary control; the signature is a second, independent one, and a file
   that merely starts with those bytes still cannot pass.

3. **Deny-by-default, with the pickle classifier demoted to a diagnostic.**
   D15:223 needs a positive test and D15:227 needs a negative one. A
   negative-only detector passes a renamed-pickle test while accepting unknown
   formats. **D15:223's allowlist won**, and the classifier explains refusals
   without ever granting one.

4. **A veto-boundary decision routes to cloud at any tier.** D16:232 says "and",
   not "A+ and". Requiring A+ as well would make clause (b) unreachable in the
   situation it exists for. **D16's two clauses won** over the narrower reading.

5. **A manifest is validated even when the artifact is absent.** Otherwise
   "everything is absent" could short-circuit to a single failure and hide a
   manifest that is also wrong. A test asserts the manifest check still runs.

6. **A manifest file kept inside the artifact directory is not an artifact.**
   Found by the tests: following the `--manifest` instructions put `manifest.json`
   in the model directory, and the gate correctly reported it as an undeclared
   file. The gate now excludes the manifest path it was given. The
   undeclared-and-forbidden case still records **both** codes, because it is two
   problems and the format one is the urgent one.

7. **Prose rounds the score for display and says "about".** See the explanation
   section. Presentation only; the boundary stays in `tiers.mjs`.

8. **The CI job landed with the amendment recorded, not silently.** See the
   tension section. The spec's own task list and its own whitelist disagree, and
   resolving it the other way disarms D15.

9. **The `.cact` is the pinned artifact and the safetensors sibling is not.**
   T13:1310 permits "Needle 3 (or an owner-approved alternative)"; both formats
   are on offer in the same repository, so the smaller on-device container is
   pinned and the 242 MB raw checkpoint is declared without a digest. Substituting
   one model for another is the anti-goal; pinning one of the two files the named
   model actually ships is not.

## AC-031 / AC-032 / AC-040 — how each is met

### AC-031 (`:1013-1019`)

- **Scenario** — the model layer is invoked: `createSentimentReader(...).read()`
  and `explainDecision(...)`.
- **Expected observable result** — only the 5% input and the prose. The import
  graph from 21 decision-path entry points reaches no model module, no
  `explain.mjs` and no `routing.mjs`; T11's consumer is digest-pinned
  unmodified; the adversarial run is byte-identical to the present run outside
  the 5% row.
- **Prohibited side effect** — no deterministic decision imports a model output
  other than the sentiment input. Enforced structurally, not by convention.
- **Verification** — the import-boundary guard, plus the garbage-stub determinism
  test AC-031:1018 names.

### AC-032 (`:1021-1027`)

- **Scenario** — a legitimate model is downloaded and a renamed pickle is placed
  in the model directory. `needle3.cact` is the legitimate one; the planted
  pickle is tested at six names, as a protocol-0 text pickle, and inside a
  `torch.save` ZIP.
- **Expected observable result** — the legitimate model loads only when its
  SHA-256 matches the pin; the renamed pickle is rejected on content.
- **Prohibited side effect** — no `.bin`/`.pt`/`.pkl` loads, renamed or not, and
  a missing digest fails rather than warns. Both asserted, and the absent-artifact
  case fails too.
- **Verification** — correct model, tampered model and renamed-pickle model, plus
  the absent case, a missing digest in three malformed forms, an uppercase digest,
  a planted pickle alongside a valid artifact, and a symlink standing in for the
  artifact.

### AC-040 (`:1085-1091`)

- **Scenario** — a non-A+, non-veto-boundary operation runs.
- **Expected observable result** — local, with no cloud call; A+ setups and
  veto-boundary decisions route to cloud with `provenance: "copilot: remote"`.
- **Prohibited side effect** — a cloud response is never a score, veto or
  execution input, and routing never fails open. Enforced by 48 matrix cells,
  twelve malformed descriptors, and `assertNotDeterministicInput`.
- **Verification** — the pure-function matrix, plus a provenance assertion on
  every cloud-derived value and a test that no local route returns the remote
  literal.

## Net effect

The model computes no indicator, regime, veto or tier, and that is a structural
property of the import graph rather than a promise in a comment: 21 decision-path
entry points reach no model module, and T11's own sentiment consumer is
byte-identical to how T11 left it.

The artifact was obtained, pinned, and verified in this environment, and the
digest gate fails loudly when it is absent — which is the property that makes
every other claim about it mean something.

ARM64 is measured where this environment could measure it (ONNX Runtime, Needle 3
— both MEASURED for publication, with the exact file that proves it) and
explicitly `UNVERIFIED` where it could not (llama.cpp, and execution on all
three). B11 stays `UNVERIFIED` with its comparative claim classified as marketing,
and promoting any of it fails the gate.
