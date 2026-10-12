# Pre-Mortem Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-audit that verifies every claimed guard actually exists and can fail, and names every failure mode that has none.

**Architecture:** Four pure modules under `server/services/premortem/` — a curated catalog, a guard inventory *derived* from tracked files, a verifier that diffs the two, and an opt-in mutation tier that proves a guard bites. One additive authenticated route exposes the readout. No UI.

**Tech Stack:** Node 22 ESM (`.mjs`), Vitest 5.0.3, `git ls-files` via injected command runner, existing `requireAuthStrict`.

**Spec:** `docs/superpowers/specs/2026-10-11-pre-mortem-planner-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- **Never a fabricated verdict.** Every outcome is one of the seven in the spec, or nothing is emitted. No default, no "probably fine", no inferred pass.
- **Never a fabricated guard.** `inventory.mjs` reports only guards found in files git tracks. A guard it cannot locate is `guard-missing`, never assumed.
- **`unverified-manual` is never upgraded to `verified`, ever**, regardless of inventory contents. Asserted by test, not by review.
- **The planner audits itself first.** Catalog staleness is reported before any claim is evaluated.
- **Structural verification is not biting.** Where mutation has not run, the output says so. The two claims are never collapsed.
- **Silence is not coverage.** Every catalog mode carries either a `claim` or an `acceptedUnclaimed` disposition (owner + date). Neither present is `stale-catalog-entry`.
- **Advisory only.** No permit, ceremony, credential, or venue-class path is touched. Nothing blocks a build.
- **`Number.isFinite` before every comparison and division.** Never `Number()` a possibly-null value; never `==`; never coerce absence to `0`.
- **Pure modules.** No store, no network, no `process.env`, no clock reads in `catalog.mjs`, `inventory.mjs`, `verify.mjs`.
- **Hermetic tests.** Fixtures and injected data only; no real store dirs; no sleeps. **Stage new test files before running `ws7TestStoreIsolation`** — it enumerates tracked files via `git ls-files` and passes vacuously on untracked ones.
- **One commit per task**, `feat(premortem): …` / `fix(premortem): …`.
- Probe scripts in `apps/dashboard/testSupport/*.tmp.mjs`, deleted before finishing.
- **Verification-first:** every factual claim in a comment or report must come from a command that was run and quoted. Unproducible claims are deleted, never re-attributed.

---

### Task 1: Catalog — the curated failure modes

**Files:**
- Create: `apps/dashboard/server/services/premortem/catalog.mjs`
- Test: `apps/dashboard/server/__tests__/preMortemCatalog.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SEVERITIES = Object.freeze(["high", "medium", "low"])`
  - `KINDS = Object.freeze(["capital", "shipping"])`
  - `FAILURE_MODES` — frozen array of entries, each `{ id, kind, severity, subsystem, summary, claim, acceptedUnclaimed, mutation, rationale }`
  - `catalogEntries()` → `FAILURE_MODES` (frozen; returned so callers cannot mutate the export)

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { FAILURE_MODES, KINDS, SEVERITIES, catalogEntries } from "../services/premortem/catalog.mjs"

describe("catalog", () => {
  it("every entry has a disposition — a claim or an explicit accepted-unclaimed", () => {
    for (const m of FAILURE_MODES) {
      const hasClaim = typeof m.claim === "string" && m.claim.length > 0
      const hasAccepted = m.acceptedUnclaimed != null
      expect(hasClaim || hasAccepted, `${m.id} has neither`).toBe(true)
    }
  })

  it("kind and severity come from the frozen vocabularies", () => {
    for (const m of FAILURE_MODES) {
      expect(KINDS).toContain(m.kind)
      expect(SEVERITIES).toContain(m.severity)
    }
  })

  it("acceptedUnclaimed carries an owner and a date", () => {
    for (const m of FAILURE_MODES) {
      if (m.acceptedUnclaimed == null) continue
      expect(m.acceptedUnclaimed.owner).toBeTruthy()
      expect(m.acceptedUnclaimed.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it("ids are unique", () => {
    const ids = FAILURE_MODES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("the returned catalog cannot be mutated", () => {
    expect(Object.isFrozen(catalogEntries())).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run preMortemCatalog` (workdir `apps/dashboard`)
Expected: FAIL — "Cannot find module … premortem/catalog.mjs"

- [ ] **Step 3: Write minimal implementation**

A static frozen array. Seed it with the shipping-risk and capital-risk modes from spec §6. Capital-risk entries carry `claim: null` and an `acceptedUnclaimed` disposition naming the manual check required. Shipping-risk entries that DO have a guard carry its repo-relative path in `claim`. Set `mutation: true` only on entries whose guard exists and is worth proving bites.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2
Expected: PASS

- [ ] **Step 5: Stage the test file, then run the isolation guard**

Run: `git add apps/dashboard/server/__tests__/preMortemCatalog.test.mjs` then `npx vitest run preMortemCatalog ws7TestStoreIsolation`
Expected: both green

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/services/premortem/catalog.mjs apps/dashboard/server/__tests__/preMortemCatalog.test.mjs
git commit -m "feat(premortem): curated failure-mode catalog"
```

### Task 2: Inventory — derive the real guard set

**Files:**
- Create: `apps/dashboard/server/services/premortem/inventory.mjs`
- Test: `apps/dashboard/server/__tests__/preMortemInventory.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `guardInventory({ listTrackedFiles, readFile })` → `{ guards: [{ file, describes: string[], asserts: number }], unreadable: string[] }`
  - `listTrackedFiles` is an **injected** async function returning repo-relative paths. It is the ONLY way the module learns what exists. `readFile` is likewise injected and returns the file's text.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { guardInventory } from "../services/premortem/inventory.mjs"

const files = (list) => async () => list

describe("guardInventory", () => {
  it("derives guards from tracked files and reads each one", async () => {
    const out = await guardInventory({
      listTrackedFiles: files([
        "apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs",
        "apps/dashboard/server/__tests__/graduationApi.test.mjs",
      ]),
      readFile: async () => 'describe("a guard", () => { it("x", () => { expect(1).toBe(1) }) })',
    })
    expect(out.guards).toHaveLength(2)
    expect(out.guards[0].asserts).toBeGreaterThan(0)
  })

  it("never consults a hardcoded consumer list", async () => {
    const out = await guardInventory({
      listTrackedFiles: files([]),
      readFile: async () => "",
    })
    expect(out.guards).toEqual([])
  })

  it("a file git does not track is never reported as a guard", async () => {
    const out = await guardInventory({
      listTrackedFiles: files([]),
      readFile: async () => 'describe("g", () => { expect(1).toBe(1) })',
    })
    expect(out.guards).toHaveLength(0)
  })

  it("a file it cannot read is recorded, not guessed", async () => {
    const out = await guardInventory({
      listTrackedFiles: files(["apps/dashboard/server/__tests__/x.test.mjs"]),
      readFile: async () => { throw new Error("EACCES") },
    })
    expect(out.unreadable).toEqual(["apps/dashboard/server/__tests__/x.test.mjs"])
    expect(out.guards).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run preMortemInventory` (workdir `apps/dashboard`)
Expected: FAIL — "Cannot find module … premortem/inventory.mjs"

- [ ] **Step 3: Write minimal implementation**

Filter the injected tracked-file list to guard-shaped test files, read each through injected `readFile`, extract `describe`/`it` names and count assertion calls. Any read failure lands in `unreadable` — never a guessed guard.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2
Expected: PASS

- [ ] **Step 5: Stage, run guard, commit**

```bash
git add apps/dashboard/server/__tests__/preMortemInventory.test.mjs
npx vitest run preMortemInventory ws7TestStoreIsolation
git add apps/dashboard/server/services/premortem/inventory.mjs
git commit -m "feat(premortem): derive the guard inventory from tracked files"
```

### Task 3: Verifier — catalog × inventory

**Files:**
- Create: `apps/dashboard/server/services/premortem/verify.mjs`
- Test: `apps/dashboard/server/__tests__/preMortemVerify.test.mjs`

**Interfaces:**
- Consumes: `FAILURE_MODES` (Task 1), and an inventory shaped as Task 2 produces. **Import `splitClaim` and `CLAIM_SEPARATOR` from `inventory.mjs` — never re-implement the `" :: "` split locally.** Splitting the separator twice is how the two copies drift.
- Produces:
  - `VERDICTS = Object.freeze(["verified", "partially-covered", "guard-missing", "guard-cannot-fail", "unclaimed", "unverified-manual", "stale-catalog-entry"])` — **`guard-unregistered` was withdrawn**: the derived inventory has no registry for it to check, and reintroducing one would recreate the defect the feature exists to catch. SHIP-1/SHIP-2 carry a `gap` and report `partially-covered` instead.
  - A claim naming a file outside the inventory's declared scope (`.ts`/`.tsx`) reports `stale-catalog-entry`, NOT `guard-missing`. 115 tracked non-`.mjs` tests are out of scope (49 `.ts` + 66 `.tsx`); calling that "uncovered" would be a confident false miss.
  - `auditCatalog({ modes, knownSubsystems })` → array of `stale-catalog-entry` findings (the self-audit; runs FIRST)
  - `verifyMode({ mode, inventory })` → `{ id, verdict, evidence, manualCheck }`
  - `verifyAll({ modes, inventory, knownSubsystems })` → `{ catalogFindings, results, counts }`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { VERDICTS, verifyMode, verifyAll, auditCatalog } from "../services/premortem/verify.mjs"

const shipping = (over = {}) => ({
  id: "guard-cannot-fail", kind: "shipping", severity: "high", subsystem: "lexing",
  summary: "s", claim: "server/__tests__/g.test.mjs", acceptedUnclaimed: null,
  mutation: false, rationale: "r", ...over,
})

describe("verify", () => {
  it("pins every verdict in the vocabulary", () => {
    expect([...VERDICTS].sort()).toEqual([
      "guard-cannot-fail", "guard-missing", "partially-covered",
      "stale-catalog-entry", "unclaimed", "unverified-manual", "verified",
    ])
  })

  it("a claim naming a file that is not in the inventory is guard-missing", () => {
    const r = verifyMode({ mode: shipping(), inventory: { guards: [], unreadable: [] } })
    expect(r.verdict).toBe("guard-missing")
  })

  it("a capital-risk mode is unverified-manual even when guards are present", () => {
    const mode = shipping({ id: "x", kind: "capital", claim: null,
      acceptedUnclaimed: { owner: "owner", date: "2026-10-11" } })
    const inv = { guards: [{ file: "server/__tests__/g.test.mjs", describes: [], asserts: 5 }], unreadable: [] }
    expect(verifyMode({ mode, inventory: inv }).verdict).toBe("unverified-manual")
  })

  it("a mode with no claim and no disposition is stale, never unclaimed", () => {
    const mode = shipping({ claim: null, acceptedUnclaimed: null })
    expect(verifyMode({ mode, inventory: { guards: [], unreadable: [] } }).verdict).toBe("stale-catalog-entry")
  })

  it("the self-audit runs before any claim is evaluated", () => {
    const out = verifyAll({
      modes: [shipping({ claim: "server/__tests__/gone.test.mjs", subsystem: "vanished" })],
      inventory: { guards: [], unreadable: [] },
      knownSubsystems: ["lexing"],
    })
    expect(out.catalogFindings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run preMortemVerify` (workdir `apps/dashboard`)
Expected: FAIL — "Cannot find module … premortem/verify.mjs"

- [ ] **Step 3: Write minimal implementation**

Seven verdicts exactly as specced. `unverified-manual` is decided on `kind === "capital"` before any inventory lookup, so no inventory content can upgrade it.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2
Expected: PASS

- [ ] **Step 5: Stage, run guard, commit**

```bash
git add apps/dashboard/server/__tests__/preMortemVerify.test.mjs
npx vitest run preMortemVerify ws7TestStoreIsolation
git add apps/dashboard/server/services/premortem/verify.mjs
git commit -m "feat(premortem): verify claims and report gaps"
```

### Task 4: Mutation tier — prove a guard bites

**Files:**
- Create: `apps/dashboard/server/services/premortem/mutate.mjs`
- Test: `apps/dashboard/server/__tests__/preMortemMutate.test.mjs`

**Interfaces:**
- Consumes: a catalog entry (Task 1 shape) with `mutation: true` and a `claim` naming its guard. It does NOT consume the inventory — the guard reference travels on the entry, and the actual running is delegated to the injected runner.
- Produces:
  - `mutationCheck({ entry, runGuard })` → `{ id, verdict: "bites" | "does-not-bite" | "not-run", evidence }`
  - `runGuard` is **injected**: given the guard file it is asked to run against a deliberately broken implementation and returns whether it failed.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest"
import { mutationCheck } from "../services/premortem/mutate.mjs"

const entry = { id: "e1", claim: "server/__tests__/g.test.mjs", mutation: true }

describe("mutationCheck", () => {
  it("a guard that fails on a broken implementation bites", async () => {
    const r = await mutationCheck({ entry, runGuard: async () => ({ failed: true }) })
    expect(r.verdict).toBe("bites")
  })

  it("a guard that passes on a broken implementation does not bite", async () => {
    const r = await mutationCheck({ entry, runGuard: async () => ({ failed: false }) })
    expect(r.verdict).toBe("does-not-bite")
  })

  it("an entry not marked for mutation is not-run, never inferred", async () => {
    const r = await mutationCheck({ entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: true }) })
    expect(r.verdict).toBe("not-run")
  })

  it("structural verification is never reported as biting", async () => {
    const r = await mutationCheck({ entry: { ...entry, mutation: false }, runGuard: async () => ({ failed: false }) })
    expect(r.verdict).not.toBe("bites")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run preMortemMutate` (workdir `apps/dashboard`)
Expected: FAIL — "Cannot find module … premortem/mutate.mjs"

- [ ] **Step 3: Write minimal implementation**

Three verdicts only. `not-run` is the default and is never upgraded from structural evidence.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2
Expected: PASS

- [ ] **Step 5: Stage, run guard, commit**

```bash
git add apps/dashboard/server/__tests__/preMortemMutate.test.mjs
npx vitest run preMortemMutate ws7TestStoreIsolation
git add apps/dashboard/server/services/premortem/mutate.mjs
git commit -m "feat(premortem): mutation tier proves guards bite"
```

### Task 5: Route — `GET /api/premortem/overview`

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (ONE additive branch, dynamic `await import()`, `requireAuthStrict` first)
- Test: `apps/dashboard/server/__tests__/preMortemApi.test.mjs`
- Modify: `apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs` (re-pin line/dynamic counts, accounted line by line — statics MUST stay 72)

- [ ] **Step 1: Write the failing test**

`apps/dashboard/server/__tests__/preMortemApi.test.mjs`. Copy the harness shape from `apps/dashboard/server/__tests__/graduationApi.test.mjs` (fresh `handlers` import per test, `DATA_DIR` redirect, `vi.resetModules()`), then:

```js
import { describe, expect, it } from "vitest"

const load = async () => {
  vi.resetModules()
  return await import("../handlers.mjs")
}

it("refuses unauthenticated callers with 401", async () => {
  const { handleRequest } = await load()
  const res = await callRoute(handleRequest, "/api/premortem/overview", "GET")
  expect(res.status).toBe(401)
})

it("requireAuthStrict is the first statement in the route block", async () => {
  const src = await readFile("apps/dashboard/server/handlers.mjs", "utf8")
  const block = src.slice(src.indexOf('path === "/api/premortem/overview"'))
  const firstLine = block.slice(block.indexOf("{") + 1).trim().split("\n")[0].trim()
  expect(firstLine).toMatch(/^if\s*\(!\(await requireAuthStrict\(req, res\)\)\)\s*return/)
})

it("reports catalogFindings before results", async () => {
  const res = await callAuthenticated(load(), "/api/premortem/overview")
  expect(Object.keys(res.body)).toEqual(
    expect.arrayContaining(["catalogFindings", "results"])
  )
  expect(Object.keys(res.body).indexOf("catalogFindings"))
    .toBeLessThan(Object.keys(res.body).indexOf("results"))
})

it("never emits a verdict outside the vocabulary", async () => {
  const { VERDICTS } = await import("../services/premortem/verify.mjs")
  const res = await callAuthenticated(load(), "/api/premortem/overview")
  for (const r of res.body.results) expect(VERDICTS).toContain(r.verdict)
})

it("a mutation entry that did not run is reported not-run, never bites", async () => {
  const res = await callAuthenticated(load(), "/api/premortem/overview")
  const notRun = res.body.mutation.filter((m) => m.verdict === "not-run")
  // "not-run" IS the encoding of "did not run" — there is no separate ran flag to drift.
  expect(notRun.length).toBeGreaterThan(0)
  expect(res.body.mutation.every((m) => m.verdict !== "bites" || m.ran === true)).toBe(true)
})
```

For any entry flagged `mutation: true`, the route must actually invoke the mutation
runner and set `ran`. An entry marked `mutation: true` that reports `not-run`
without having run is the failure this assertion exists to catch.

Adapt the `callRoute` / `callAuthenticated` / `readFile` helpers to the names that file actually uses — read it first and match it. Do not invent a second harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run preMortemApi` (workdir `apps/dashboard`)
Expected: FAIL — 404

- [ ] **Step 3: Write minimal implementation**

One branch. `requireAuthStrict` first. All four service modules via dynamic import inside the try. No static top-level imports. The response carries `catalogFindings` first, then `results`, then `mutation` — so the self-audit is read before any claim, and an unrun mutation is visible as `not-run` rather than absent.

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npx vitest run preMortemApi ws7AuthBootstrapGateGuard ws7RouteAuthCoverageGuard ws7TestStoreIsolation` then `npm run typecheck` (repo root)
Expected: all green

- [ ] **Step 5: Re-pin the bootstrap guard, accounted line by line**

Run `git diff --stat` on `handlers.mjs`, decompose the line delta into its regions, update only the `lines` and `dynamics` pins. **Statics must remain 72.** If statics moved, something was statically imported and it is wrong.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/handlers.mjs apps/dashboard/server/__tests__/preMortemApi.test.mjs apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs
git commit -m "feat(premortem): overview route"
```