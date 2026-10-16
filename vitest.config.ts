/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"
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
// `command: "serve"` is not arbitrary. It is what the package's own `npm test`
// already produces — vitest resolves the Vite config in serve mode — so the two
// invocations differ in `root` and in nothing else. Passing `"build"` instead
// would take the `isBuild` branch in that config, which skips `startTradingHud`
// and `startLedger`, and the two invocations would no longer be the same suite.
//
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
// ---------------------------------------------------------------------------
export default defineConfig(async (env) => {
  const dashboard = await dashboardConfig({
    command: "serve",
    mode: env.mode,
    isSsrBuild: false,
    isPreview: false
  })
  return {
    ...dashboard,
    root: fileURLToPath(new URL("./apps/dashboard", import.meta.url))
  }
})