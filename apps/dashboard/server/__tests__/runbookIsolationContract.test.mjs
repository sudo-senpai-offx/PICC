// WS-7 slice B fix round 1 — the operability runbook must state the harness's ACTUAL
// isolation contract, and must not be able to drift from it again.
//
// ── THE DEFECT THIS GUARDS ─────────────────────────────────────────────────
// `docs/runbooks/PICC_OPERABILITY_RUNBOOK.md` §4.3 enumerates the isolation map as
// "the full 20-variable contract" and §4.4 says the env "must contain exactly the 20
// required keys". The harness's real `REQUIRED_ISOLATION_VARIABLES` has 23 entries.
// Three are missing from the runbook:
//
//   PICC_ERROR_LOG_FILE  added by slice A, and the one that decides whether the
//                        error log is written at the REPOSITORY ROOT
//   PICC_ENV_LOADED      added by slice A, and the flag that stops server/config.mjs
//                        loading the repo `.env` (real provider + CCXT credentials)
//   PICC_E2E_RUN_ID      added by THIS slice, and the arming signal for the /me
//                        branch trace
//
// and §4.4 lists none of slice B's new refusal condition (the run-id format check).
// So an operator reading §4.3/§4.4 today is being told a contract that does not exist.
// The drift is inherited from slice A; this slice widened it from 2 keys to 3.
//
// ── WHY A TEST AND NOT JUST A PROSE FIX ─────────────────────────────────────
// Because §4.3 is exactly the kind of numbered list that rots silently: the next
// person to add a required variable will not think to walk to a runbook in
// `docs/runbooks/`. This test reads the runbook's table and compares it, element by
// element and IN ORDER, against the harness's exported array — so the day a 24th key
// is added, this goes red and names the file that has to change with it.
//
// It imports the harness rather than re-describing the contract, for the same reason
// the anti-rot test does: a second copy of the list is a second thing to drift, and
// the copy is what this test exists to prevent. The import is cleaned up by
// `testSupport/isoHarnessEnv.mjs`, which removes the root this load minted.
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { REQUIRED_ISOLATION_VARIABLES } from "../../testSupport/isoHarnessEnv.mjs"

const RUNBOOK = fileURLToPath(new URL("../../../../docs/runbooks/PICC_OPERABILITY_RUNBOOK.md", import.meta.url))

function sectionOf(markdown, heading) {
  const start = markdown.indexOf(heading)
  if (start === -1) throw new Error(`the runbook has no ${heading} section`)
  const rest = markdown.slice(start + heading.length)
  const next = rest.search(/\n#{2,3} /)
  return next === -1 ? rest : rest.slice(0, next)
}

function contractTable(markdown) {
  const rows = []
  for (const line of sectionOf(markdown, "### 4.3").split("\n")) {
    const row = line.match(/^\|\s*(\d+)\s*\|\s*`([A-Za-z0-9_]+)`\s*\|/)
    if (row) rows.push({ index: Number(row[1]), name: row[2] })
  }
  return rows
}

describe("the operability runbook states the harness's real isolation contract", () => {
  it("§4.3 lists every required key, in the harness's order, and nothing else", () => {
    expect(existsSync(RUNBOOK)).toBe(true)
    const rows = contractTable(readFileSync(RUNBOOK, "utf8"))
    expect(
      rows.map((r) => r.name),
      "§4.3's table must equal REQUIRED_ISOLATION_VARIABLES, in order. A runbook that lists a subset " +
        "tells an operator which stores are isolated when some are not, and one that lists a stale " +
        "superset documents a key the harness would reject as unexpected."
    ).toEqual([...REQUIRED_ISOLATION_VARIABLES])
    expect(
      rows.map((r) => r.index),
      "§4.3's rows are numbered; the numbering must be dense and ascending from 1, or the table is " +
        "quoting a count nobody maintains"
    ).toEqual(REQUIRED_ISOLATION_VARIABLES.map((_, i) => i + 1))
  })

  it("§4.3's heading states the real key count, not a remembered one", () => {
    const heading = readFileSync(RUNBOOK, "utf8").split("\n").find((l) => l.startsWith("### 4.3"))
    const claimed = Number((heading ?? "").match(/\b(\d+)-variable contract\b/)?.[1])
    expect(
      Number.isFinite(claimed),
      `§4.3's heading must name the key count ("### 4.3 Full N-variable contract"); got: ${heading}`
    ).toBe(true)
    expect(claimed, "§4.3's heading quotes a count that no longer matches the harness").toBe(
      REQUIRED_ISOLATION_VARIABLES.length
    )
    // The prose sentence under the heading quotes it a second time.
    const prose = sectionOf(readFileSync(RUNBOOK, "utf8"), "### 4.3")
    expect(prose, "§4.3 must not describe the map as anything but the harness's own composition").toContain(
      `${REQUIRED_ISOLATION_VARIABLES.length - 4} path variables plus ${4} scalar variables`
    )
  })

  it("§4.4 states the real required-key count in its refusal conditions", () => {
    const s44 = sectionOf(readFileSync(RUNBOOK, "utf8"), "### 4.4")
    expect(
      s44,
      `§4.4 must say "exactly the ${REQUIRED_ISOLATION_VARIABLES.length} required keys". An operator ` +
        "trusting a smaller number has no reason to suspect a key is missing."
    ).toContain(`exactly the ${REQUIRED_ISOLATION_VARIABLES.length} required keys`)
    expect(
      s44,
      `§4.4 must say how many path values are contained, and that number is the path-variable count ` +
        `(${REQUIRED_ISOLATION_VARIABLES.length - 4})`
    ).toMatch(new RegExp(`\\b${REQUIRED_ISOLATION_VARIABLES.length - 4} path values`))
  })

  it("§4.4 documents every refusal condition the harness actually enforces", () => {
    const s44 = sectionOf(readFileSync(RUNBOOK, "utf8"), "### 4.4")
    // One per thrown branch in `assertIsolatedEnv`, named by the variable it is about.
    // This slice added the run-id format check, which the runbook did not mention.
    for (const name of [
      "PICC_ERROR_LOG",
      "PICC_ENV_LOADED",
      "PICC_VAULT_KEY",
      "PICC_E2E_RUN_ID",
      "picc-vault.key"
    ]) {
      expect(
        s44,
        `§4.4 does not mention ${name}, so an operator cannot tell that the harness will refuse to start ` +
          "over it"
      ).toContain(name)
    }
  })

  it("says what the run marker is FOR, so the refusal is not a mystery rule", () => {
    const s44 = sectionOf(readFileSync(RUNBOOK, "utf8"), "### 4.4")
    // A refusal condition an operator cannot explain is a refusal condition they will
    // work around rather than satisfy.
    expect(
      s44 + sectionOf(readFileSync(RUNBOOK, "utf8"), "### 4.3"),
      "§4.3/§4.4 must explain what PICC_E2E_RUN_ID arms, or its format rule looks arbitrary"
    ).toMatch(/auth-me|\/me branch trace|branch trace/)
  })
})
