/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"
import type { UserConfig } from "vitest/config"
import dashboardConfig from "./apps/dashboard/vite.config"

// ---------------------------------------------------------------------------
// THE REPO ROOT IS A SUPPORTED VITEST INVOCATION. IT OWNS NO SETTINGS.
//
// `apps/dashboard/vite.config.ts:129` states that it deliberately carries the `@`
// alias and that there is deliberately no `vitest.config.ts` inside the package.
// Before this file, the consequence was that `npx vitest run` at the repo root
// loaded no alias and no `setupFiles` at all: every `@`-importing test failed to
// collect, and the run exited 1 in a shape that can be mistaken for a result.
// Four mutation harnesses this work reported from runners that never ran; one
// read `passed=0 failed=0` as GREEN and called eight mutants SURVIVED on a
// healthy suite. A silent failure mode that looks exactly like an answer is the
// defect this file removes.
//
// WHY DELEGATION AND NOT A COPY. The `@` alias and the store-isolation
// `setupFiles` are load-bearing for the whole suite, and a second copy of them
// here would be a second source of truth that drifts silently — the failure this
// file exists to prevent, reintroduced one level up. So this file calls the SAME
// factory `apps/dashboard/vite.config.ts` exports and adds exactly one field.
//
// The dashboard config stays authoritative, and stays so by construction: change
// the alias, the plugins, or the setup file over there, and this invocation
// picks the change up on its next run, because it never held a copy to forget.
//
// `command: "serve"` is a FIDELITY choice, not a necessity, and it is recorded
// as one because the delta is smaller than it reads. `"serve"` is what vitest
// itself hands the factory when it resolves this config, so the root invocation
// and the package's own `npm test` differ in `root` and in nothing else.
//
// MEASURED, NOT ASSUMED: the whole suite was run at the repo root under
// `command: "build"` and returned the identical result - 452 files / 6401 tests,
// exit 0, `apps/dashboard/server/data` unchanged - the same numbers `"serve"`
// gives. So the two are equivalent on this box, and `"serve"` is chosen because
// it is what vitest actually passes, not because `"build"` would break.
//
// WHY they are equivalent, read off the config rather than guessed. There is
// exactly one delta between the two branches in `apps/dashboard/vite.config.ts`:
// `if (!isBuild) startTradingHud(); startLedger()`. The other gate,
// `if (!process.env.VITEST && !isBuild)`, is skipped under vitest either way,
// because vitest sets `VITEST`. So the entire delta is those two starters, which
// register interval handles and process handlers and which no test in the suite
// asserts on — invisible from the suite's side of the boundary. That is a
// measured property of THIS suite, not a general licence: wiring a test to
// either starter would make `"build"` the wrong choice immediately, and the
// measurement would have to be redone.
// WHY `root` MUST MOVE. The dashboard's `setupFiles` (`./testSupport/…`) and its
// `exclude` entry (`**/e2e/**`) are relative, and vitest resolves both against
// `root`. Left at the repo root they would resolve to paths that do not exist —
// so store isolation would silently not run, which is the one thing that must
// never silently stop happening. Pointing `root` at the package makes every
// relative pattern resolve to the same file it does for the package invocation.
//
// Scope is the other half of why. Rooted at the package, the root invocation
// collects the same test files `npm test` does. Unrooted, it also swept up a
// stale full copy of this repository under `.freebuff/worktrees/` — gitignored
// scratch (`.gitignore:48`), not part of this tree, and not something any test
// count should be measuring.
//
// ── THE ONE FIELD THAT MUST BE DEEP-MERGED, AND WHY A SHALLOW SPREAD IS A TRAP
//
// `{ ...dashboard, root }` is SHALLOW. A `test:` key added to the returned
// object does not merge into the delegated `test` block — it REPLACES it
// wholesale. Measured, by resolving the real config factory both ways with a
// `test: { name: "root-override" }` key present:
//
//   shallow:  test.setupFiles  undefined        <- store isolation GONE
//             test.exclude     undefined        <- vitest falls back to ITS
//                                                 defaults, which carry no
//                                                 `**/e2e/**` rule, so the
//                                                 Playwright specs get collected
//   deep:     test.setupFiles  ["./testSupport/vitestStoreIsolation.setup.mjs"]
//             test.exclude     […defaults, "**/e2e/**"]
//
// Running the shallow shape was measured to exit 1 with NO `Test Files` summary
// line — the exact silent-failure shape this file exists to close — and to write
// to the REAL `apps/dashboard/server/data/` (both gitignored and not recoverable
// from git). That is the whole of `setupFiles`, lost to one line of object
// spread. The delegation above closes drift in the DASHBOARD -> ROOT direction;
// this line closes the ROOT -> DASHBOARD direction, which "it never held a copy
// to forget" does not reach.
//
// So `test` is deep-merged, and ROOT_TEST is the only place a root-local test
// override can live. It is EMPTY and must stay that way unless something
// genuinely cannot be expressed in `apps/dashboard/vite.config.ts` — every field
// added to it is a field that can now shadow the delegation, which is the hazard
// above wearing a different name.
// ---------------------------------------------------------------------------

// Root-local vitest overrides. Empty on purpose — see the hazard note above.
const ROOT_TEST: UserConfig["test"] = {}

export default defineConfig(async (env) => {
  const dashboard = await dashboardConfig({
    command: "serve",
    mode: env.mode,
    isSsrBuild: false,
    isPreview: false
  })
  return {
    ...dashboard,
    test: { ...dashboard.test, ...ROOT_TEST },
    root: fileURLToPath(new URL("./apps/dashboard", import.meta.url))
  }
})
