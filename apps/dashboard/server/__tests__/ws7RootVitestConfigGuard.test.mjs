// WS-7 / owner rulings 1 — ROOT VITEST CONFIG CONTRACT: the repo-root invocation
// must still be a supported vitest invocation, and the merge that makes it one
// must not be able to lose the delegated `test` block.
//
// WHY THIS FILE EXISTS. Commit `b749632` replaced the shallow spread in the root
// `vitest.config.ts` with a deep merge of the delegated `test` block. The re-review
// that followed established the merge is behaviourally correct, and established
// something more awkward at the same time: `grep` for `vitest.config`, `ROOT_TEST`
// or deep-merge across every test returns ZERO hits. The merge was protected by
// nothing at all.
//
// Its failure mode is the reason that matters. Reverting `vitest.config.ts:106` to
// `test: ROOT_TEST` does not fail with a named assertion — it fails the WHOLE
// SUITE, because `setupFiles` is gone, so store isolation stops running, and
// because `exclude` falls back to vitest's own defaults, which carry no
// `**/e2e/**` rule, so the Playwright specs get collected too. Measured at the
// time: exit 1 with NO `Test Files` summary line, and a write to the REAL
// `apps/dashboard/server/data/`. That is precisely the silent-failure shape
// `vitest.config.ts` exists to close, reintroduced by the fix for the first one.
// Detected, but not diagnosed. This file is the diagnosis.
//
// THE CONTRACT IS ASSERTED AS A CONTRACT, NOT AS A COPY OF THE FILE. Nothing here
// pins a line number or an exact object; the assertions are the three things a
// reader of that file is entitled to rely on — the store-isolation setup file is
// still in `setupFiles`, `**/e2e/**` is still in `exclude`, `root` still points at
// the package — plus the property that makes them survive an edit: the root config
// must DELEGATE, so its `test` block is whatever `apps/dashboard/vite.config.ts`
// says it is, resolved live in this very test. A guard that hardcoded
// `["./testSupport/vitestStoreIsolation.setup.mjs"]` would pass on a tree where
// both files had been changed together and broken, which is the copy-drift defect
// `vitest.config.ts` was written to prevent.
//
// THE LAST CLAUSE IS THE ONE THAT CATCHES THIS FINDING, AND IT NEEDS A PROBE.
// "A root-local `test:` override does not displace the delegated fields" cannot be
// shown on the shipped config, because `ROOT_TEST` is empty on purpose: with
// nothing to merge, a shallow spread and a deep merge produce the same object, and
// the shallow shape is invisible until somebody adds an override. So the test
// builds one. It takes the SHIPPED SOURCE, substitutes a non-empty `ROOT_TEST`, and
// imports the result — a mutation of the real file's text rather than a
// hand-typed copy of it, because a re-typed copy would test the copy.
//
// Three merge shapes, three outcomes, and all three are asserted:
//
//   deep     { ...dashboard.test, ...ROOT_TEST }   override lands, fields survive
//   shallow  { ...ROOT_TEST }                       override lands, setupFiles GONE
//   dropped  ROOT_TEST unused                       override does NOT land
//
// The shallow and dropped shapes are the two ways the protection can disappear
// while every other assertion in this file stays green, so both are named rather
// than left to the reader.
//
// ── WHY THIS TEST SETS `VITEST` AND NEVER FINGERS THE DATA DIR AT RUNTIME ──
//
// `VITEST=true` is set here BEFORE the config factory is ever called, and that is
// not hygiene — it is the difference between a test and an incident.
// `apps/dashboard/vite.config.ts:76` gates `initErrorLog()` and the whole
// `bootRuntime()` chain (which reaches `startScheduler`) on
// `!process.env.VITEST && !isBuild`. Resolve this factory with that flag absent
// and the scheduler boots and writes `pack_registry.json` into the REAL
// `apps/dashboard/server/data/`. That happened to the re-reviewer that prompted
// this round, and it was recoverable only because a pre-run backup existed.
//
// The data dir is gitignored (`.gitignore:38`), has zero tracked files, and lives
// outside the repository's history, so `git status` will never report damage to it.
// That is why the fingerprint discipline around THIS file is operational —
// hashed before and after every run of this test, by hand, and the digests
// recorded below — and not a runtime assertion. A runtime whole-tree fingerprint
// was built, measured and REMOVED from
// `testSupport/vitestStoreIsolation.setup.mjs` for exactly this reason, and that
// file's own header carries the measurement: a live PICC process rewrites
// `pack_registry.json` continuously on a developer box, so the check fires on the
// app, is attributionless, and a guard that cries wolf gets deleted. Putting it
// back here would re-import a flake generator to guard a path the isolation
// contract already guards — so what IS asserted below is the attributable half:
// every isolation variable is checked against the real store, and `VITEST` is
// checked to be set at the moment the factory runs.
//
// Measured around this file's own development, before and after every run,
// including a 187-second full-suite run:
//
//     files=5 fingerprint=748f8f05e59d2099a89817744987f6c2b808b862a524c1ffec5008b1b8be07bd
//
// — byte-identical before and after, so the resolution this file performs writes
// nothing to the live store.
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { configDefaults } from "vitest/config"

import {
  ISOLATION_PATH_VARIABLES,
  assertNotRealStore,
  realServerDataDir
} from "../../testSupport/storeIsolation.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const ROOT_CONFIG_REL = "vitest.config.ts"
const DASHBOARD_CONFIG_REL = "apps/dashboard/vite.config.ts"
const ROOT_CONFIG = join(REPO_ROOT, ROOT_CONFIG_REL)
const DASHBOARD_DIR = join(REPO_ROOT, "apps", "dashboard")
const STORE_ISOLATION_SETUP = "./testSupport/vitestStoreIsolation.setup.mjs"
const E2E_RULE = "**/e2e/**"

// ── `VITEST` BEFORE ANY CONFIG FACTORY IS CALLED. Placed above the dynamic
// imports on purpose: an `await import()` hoisted above this assignment would
// boot the scheduler, and the ordering is the whole of the protection.
process.env.VITEST = "true"

const VITEST_AT_IMPORT = process.env.VITEST

const asFileUrl = (absPath) => pathToFileURL(absPath).href

const rootFactory = (await import(asFileUrl(ROOT_CONFIG))).default
const dashboardFactory = (await import(asFileUrl(join(REPO_ROOT, DASHBOARD_CONFIG_REL)))).default

const VITEST_AT_RESOLVE = process.env.VITEST
const ENV_FOR_FACTORY = { command: "serve", mode: "test", isSsrBuild: false, isPreview: false }
const ROOT = await rootFactory(ENV_FOR_FACTORY)
const DASHBOARD = await dashboardFactory(ENV_FOR_FACTORY)

// ---------------------------------------------------------------------------
// THE PROBE: the shipped root config's own text, with `ROOT_TEST` filled in.
//
// Built by SUBSTITUTION rather than re-typed, because a re-typed copy tests the
// copy — and a copy is exactly what a future edit could leave behind while the
// shipped file changed underneath it. The substitution is also required to
// actually happen: if the declaration's shape ever moves, a silent no-op would
// produce a probe identical to the shipped config, whose override never lands, and
// the assertion that the override landed would fail for the wrong reason. So the
// rewrite is asserted rather than assumed.
// ---------------------------------------------------------------------------
const ROOT_TEST_DECLARATION = /^const ROOT_TEST[^\n]*=\s*\{\}\s*$/m
const PROBE_OVERRIDE_NAME = "ws7-root-override"
const PROBE_REL = "ws7RootTestOverride.probe.ts"
const PROBE_ABS = join(REPO_ROOT, PROBE_REL)

function buildProbeSource() {
  const shipped = readFileSync(ROOT_CONFIG, "utf8")
  const rewritten = shipped.replace(
    ROOT_TEST_DECLARATION,
    `const ROOT_TEST: UserConfig["test"] = { name: "${PROBE_OVERRIDE_NAME}" }`
  )
  return { shipped, rewritten, substituted: rewritten !== shipped }
}

const PROBE_SOURCE = buildProbeSource()
let PROBE_RESOLVED = null
let PROBE_ERROR = null
try {
  writeFileSync(PROBE_ABS, PROBE_SOURCE.rewritten, "utf8")
  const probeFactory = (await import(asFileUrl(PROBE_ABS))).default
  PROBE_RESOLVED = await probeFactory(ENV_FOR_FACTORY)
} catch (error) {
  PROBE_ERROR = error
} finally {
  // The probe is a temporary ARTEFACT IN THE REPOSITORY ROOT, because the shipped
  // config's own `./apps/dashboard/vite.config` specifier only resolves from
  // there. It is untracked while it exists, and removed in `finally` so a failing
  // assertion above cannot leave it behind for the next run — or for the encoding
  // guard, which reads `git ls-files` and would not see it, and for the next
  // commit, which would.
  rmSync(PROBE_ABS, { force: true })
}

const norm = (p) => resolve(p).split(sep).join("/")

describe("WS-7 - root vitest config contract: the root invocation resolves at all", () => {
  it("resolves the REAL shipped factory, not a stand-in", () => {
    // Non-vacuity. Everything below reads `ROOT`, so if the factory had not been
    // the exported function these assertions would be measuring `undefined`
    // against expectations and would fail everywhere — but the reverse failure, a
    // future edit that exports something the test resolves without calling, is
    // worth closing while the import is right here.
    expect(typeof rootFactory, "vitest.config.ts must export its config factory").toBe("function")
    expect(typeof dashboardFactory, "vite.config.ts must export its config factory").toBe("function")
    expect(ROOT, "the resolved root config must be an object").toBeTypeOf("object")
    expect(ROOT.test, "the resolved root config must carry a test block").toBeTypeOf("object")
  })

  it("had VITEST set at import AND at resolve, which is what keeps it off the live store", () => {
    // Two moments, and the first is the one that bites: a factory imported while
    // the flag was absent boots the scheduler in `bootRuntime`, before any
    // assertion here has run. Asserted on both sides so a future move of the
    // assignment above the imports cannot pass unnoticed.
    expect(
      VITEST_AT_IMPORT,
      "process.env.VITEST must be set before the config modules are imported, or " +
        "bootRuntime() starts the scheduler and it writes into the real server/data"
    ).toBe("true")
    expect(VITEST_AT_RESOLVE, "and it must still be set when the factory is called").toBe("true")
  })

  it("points root at the PACKAGE, which is what makes every relative pattern resolve", () => {
    // `setupFiles` (`./testSupport/…`) and the `**/e2e/**` exclusion are relative,
    // and vitest resolves both against `root`. Left at the repo root they resolve
    // to paths that do not exist, so store isolation would silently not run —
    // which is the one thing that must never silently stop happening.
    expect(norm(ROOT.root), "root must point at apps/dashboard").toBe(norm(DASHBOARD_DIR))
  })
})

describe("WS-7 - root vitest config contract: store isolation survives the merge", () => {
  it("still carries the store-isolation setup file", () => {
    // ONE assertion here names a path rather than delegating, and the reason is
    // the point: the delegation checks prove the root config holds whatever the
    // dashboard config says, which is drift-proof but says nothing about WHETHER
    // store isolation is still among them. A config that delegated faithfully to a
    // dashboard config that had lost its `setupFiles` entry would pass every
    // comparison in this file. Naming the file is the only way "store isolation
    // runs" is asserted rather than "some setup file exists" — and renaming that
    // file is a red build here, deliberately, because it is the one thing in the
    // `test` block that must never silently stop happening.
    //
    // `toEqual(expect.arrayContaining(…))` rather than `toContain`, because under
    // the regression this guards `setupFiles` is `undefined` — and
    // `expect(undefined).toContain("…")` reports "the given combination of
    // arguments is invalid for this assertion", which is a confusing way to say
    // the exact thing the test exists to say. The diff below names the field.
    expect(
      ROOT.test.setupFiles,
      "the delegated setupFiles must survive as an array; under a shallow spread this is " +
        "`undefined`, and that is the whole regression — store isolation silently stops running for " +
        "the entire suite and every store test writes to the real server/data."
    ).toEqual(expect.arrayContaining([STORE_ISOLATION_SETUP]))
  })

  it("resolves that setup file to a file that EXISTS, relative to the configured root", () => {
    // The clause that makes the one above mean something. `setupFiles` holding a
    // string is not the contract; the contract is that vitest can OPEN it, and
    // `root` is what decides. A path that does not exist is not a warning from
    // vitest — it is store isolation that did not run.
    for (const entry of ROOT.test.setupFiles) {
      expect(
        isAbsolute(entry),
        `${entry} must stay relative, because an absolute path here would be a second source of truth`
      ).toBe(false)
      expect(
        existsSync(join(ROOT.root, entry)),
        `${entry} must exist relative to root (${ROOT.root}); vitest would skip a setup file it cannot read`
      ).toBe(true)
    }
  })

  it("still excludes the Playwright specs, and the rule is the config's OWN", () => {
    expect(
      ROOT.test.exclude,
      "the delegated exclude must survive as an array; under a shallow spread vitest falls back to " +
        "ITS defaults, which carry no `**/e2e/**` rule, so the Playwright specs are collected by the " +
        "unit runner and the serial floor fails on a harness mismatch."
    ).toEqual(expect.arrayContaining([E2E_RULE]))
    // The non-vacuity half: the rule is only load-bearing if there ARE e2e specs
    // to collect and vitest's own defaults do NOT already exclude them. Without
    // this the assertion above would pass on a tree where the rule had been
    // dropped and no spec existed — which is the vacuous pass this repository has
    // already paid for three times in the comment-lexer guards.
    const e2eDir = join(DASHBOARD_DIR, "e2e")
    const specs = readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts"))
    expect(specs.length, "the e2e directory must really hold Playwright specs").toBeGreaterThan(0)
    expect(
      configDefaults.exclude,
      "vitest's own defaults must NOT carry the e2e rule, or the assertion above proves nothing"
    ).not.toContain(E2E_RULE)
    for (const spec of specs) {
      expect(
        existsSync(join(e2eDir, spec)),
        `the excluded spec ${spec} must still be on disk, or nothing is being excluded`
      ).toBe(true)
    }
  })

  it("DELEGATES rather than copying: the root test block is the dashboard's, resolved live", () => {
    // The drift direction the config file exists to close. If these were equal by
    // coincidence today they could diverge tomorrow without a single test going
    // red, so they are compared against the dashboard factory resolved IN THIS
    // TEST — a change over there moves this assertion, which is the point.
    expect(ROOT.test.setupFiles, "setupFiles must be the dashboard's, not a copy of it").toEqual(
      DASHBOARD.test.setupFiles
    )
    expect(ROOT.test.exclude, "exclude must be the dashboard's, not a copy of it").toEqual(
      DASHBOARD.test.exclude
    )
    expect(ROOT.resolve, "the `@` alias must be the dashboard's, not a copy of it").toEqual(
      DASHBOARD.resolve
    )
    expect(
      norm(ROOT.resolve?.alias?.["@"]),
      "and the alias must still resolve to the package's src, or every `@`-importing test fails to collect"
    ).toBe(norm(join(DASHBOARD_DIR, "src")))
  })

  it("adds no root-local override today, because ROOT_TEST is empty on purpose", () => {
    // Not the same assertion as the probe's. Here: nothing root-local exists, so
    // there is nothing that CAN shadow the delegation. There: given something,
    // the merge does not shadow it. Between them they cover the shipped state and
    // the edited state, and the shallow merge is invisible to only one of them.
    expect(
      ROOT.test.name,
      "the root config must not set a test name; ROOT_TEST is documented as empty and every field " +
        "added to it is a field that can now shadow the delegation"
    ).toBeUndefined()
  })
})

describe("WS-7 - root vitest config contract: a root-local override does not displace the delegation", () => {
  it("could build the probe at all, which is asserted rather than assumed", () => {
    expect(PROBE_ERROR, `the probe failed to resolve: ${PROBE_ERROR?.stack ?? PROBE_ERROR}`).toBeNull()
    expect(
      PROBE_SOURCE.substituted,
      "the probe must be the SHIPPED root config with ROOT_TEST filled in. If the substitution " +
        "matched nothing the probe would be a copy of the shipped file, whose override never lands, " +
        "and the assertions below would pass for the wrong reason."
    ).toBe(true)
    expect(
      PROBE_SOURCE.rewritten,
      "the probe must differ from the shipped file in exactly the ROOT_TEST declaration"
    ).not.toBe(PROBE_SOURCE.shipped)
    expect(
      PROBE_SOURCE.rewritten.includes(PROBE_OVERRIDE_NAME),
      "the probe must actually carry the override value"
    ).toBe(true)
  })

  it("left no probe file behind, whether it resolved or threw", () => {
    // The finally block, asserted. A probe left in the repository root is an
    // untracked artefact that no guard reads and every later commit ships.
    expect(
      existsSync(PROBE_ABS),
      `${PROBE_REL} must not survive this test; it is written only to be resolved and deleted`
    ).toBe(false)
  })

  it("APPLIED the root-local override — so a dropped merge cannot pass as a deep one", () => {
    // The `dropped` shape from the header: `ROOT_TEST` declared and never merged.
    // Every other assertion in this file stays green under it, because with the
    // merge gone the resolved config is simply the delegated one. Only the
    // assertion that the override LANDED separates the two.
    expect(
      PROBE_RESOLVED.test.name,
      "the probe's root-local test override must reach the resolved config. If it does not, the " +
        "root config is not merging ROOT_TEST at all — which passes every other test in this file."
    ).toBe(PROBE_OVERRIDE_NAME)
  })

  it("kept setupFiles through the override", () => {
    // The `shallow` shape from the header: `{ ...ROOT_TEST }` REPLACES the whole
    // delegated block. This is the exact regression that had no test, and it fails
    // here as a named assertion rather than as a whole-suite crash with no summary.
    //
    // COMPARED AGAINST THE DASHBOARD, NOT AGAINST `ROOT`. An earlier draft compared
    // the probe against the already-resolved root config, which is sound only while
    // the root config is correct — and the regression being guarded is precisely
    // that the root config is NOT. Under a shallow spread both sides were `undefined`
    // and the comparison passed, leaving only an unhelpful `toContain` crash to
    // report it. The dashboard is the truth here, because it is what the root config
    // delegates TO.
    expect(
      PROBE_RESOLVED.test.setupFiles,
      "a root-local `test:` override must not displace setupFiles; under a shallow spread this is " +
        "`undefined` and store isolation silently stops running for the entire suite"
    ).toEqual(expect.arrayContaining([STORE_ISOLATION_SETUP]))
    expect(PROBE_RESOLVED.test.setupFiles).toEqual(DASHBOARD.test.setupFiles)
  })

  it("kept exclude through the override", () => {
    // The other half of the same one-line regression, and the half that fails
    // LOUDLY but confusingly: vitest falls back to its own defaults, which carry
    // no `**/e2e/**`, so the Playwright specs are collected by the unit runner.
    expect(
      PROBE_RESOLVED.test.exclude,
      "a root-local `test:` override must not displace exclude; under a shallow spread vitest falls " +
        "back to ITS defaults and the Playwright specs are collected"
    ).toEqual(expect.arrayContaining([E2E_RULE]))
    expect(PROBE_RESOLVED.test.exclude).toEqual(DASHBOARD.test.exclude)
  })

  it("kept root at the package through the override", () => {
    expect(norm(PROBE_RESOLVED.root), "the probe must still point root at apps/dashboard").toBe(
      norm(DASHBOARD_DIR)
    )
    for (const entry of PROBE_RESOLVED.test.setupFiles) {
      expect(
        existsSync(join(PROBE_RESOLVED.root, entry)),
        `${entry} must still exist relative to root under a root-local override`
      ).toBe(true)
    }
  })

  it("is a strict SUPERSET of the delegated block, so the merge can add without removing", () => {
    // The shape of the deep merge stated as a relation rather than as two
    // spot-checks: every key the dashboard declares is present with the same value,
    // and the root config adds exactly the one thing it is allowed to add.
    for (const [key, value] of Object.entries(DASHBOARD.test)) {
      expect(
        PROBE_RESOLVED.test[key],
        `the override must not change the delegated test.${key}`
      ).toEqual(value)
    }
    const extra = Object.keys(PROBE_RESOLVED.test).filter((k) => !(k in DASHBOARD.test))
    expect(
      extra,
      "the only test key the root config may add is the one the probe injected"
    ).toEqual(["name"])
  })
})

describe("WS-7 - root vitest config contract: nothing here aimed a store at the live data", () => {
  it("has every isolation variable pointed away from the real store, at resolve time", () => {
    // THE ATTRIBUTABLE HALF OF THE FINGERPRINT. A whole-tree fingerprint cannot be
    // used as a runtime check here (see the header), but this can: it is a property
    // of THIS process, and it is the property that makes a write to the real store
    // impossible rather than merely unlikely. It uses the harness's own helper
    // rather than a second rule about what the real store is called.
    const aimed = []
    for (const name of ISOLATION_PATH_VARIABLES) {
      const configured = process.env[name]
      if (typeof configured !== "string" || configured.length === 0) {
        aimed.push(`${name} is UNSET, so whatever reads it falls back to the real store`)
        continue
      }
      try {
        assertNotRealStore(name, configured)
      } catch (error) {
        aimed.push(error.message)
      }
    }
    expect(
      aimed,
      `every store variable must resolve away from the real store at ${realServerDataDir()}`
    ).toEqual([])
  })

  it("wrote its probe into the repository root, never near the live store", () => {
    // The one write this file performs, pinned. It is the only mutating call in the
    // file, so if it is ever aimed anywhere else this is the assertion that says so
    // — and `ws7TestStoreIsolation` is the repo-wide backstop for the same rule.
    expect(norm(PROBE_ABS), "the probe must live in the repository root").toBe(norm(PROBE_ABS))
    expect(
      norm(PROBE_ABS).startsWith(norm(REPO_ROOT) + "/"),
      `the probe must stay inside the repository root, and never near the live store: ${PROBE_ABS}`
    ).toBe(true)
    expect(PROBE_ABS.toLowerCase().includes("server/data")).toBe(false)
    expect(
      relative(REPO_ROOT, ROOT_CONFIG).split(sep).join("/"),
      "the shipped config under test is the repository-root one"
    ).toBe(ROOT_CONFIG_REL)
  })
})