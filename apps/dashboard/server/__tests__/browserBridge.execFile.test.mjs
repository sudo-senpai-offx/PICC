import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Fix 8 (CWE-78): browserBridge previously ran shell strings via execSync with
// interpolated, sometimes user-controlled, inputs (a crafted profile path could
// become shell operators). It must now execute only via execFileSync with
// argument arrays — no shell, no rediscovery of the operator characters.
const SRC = fileURLToPath(new URL("../services/browserBridge.mjs", import.meta.url))
const source = readFileSync(resolve(SRC), "utf8")

describe("browserBridge command-execution hardening (Fix 8 / CWE-78)", () => {
  it("no longer imports or uses shell-string execSync anywhere", () => {
    // execSync runs a shell and re-parses the string; its mere presence in the
    // module is the vulnerability class this fix removes.
    expect(source).not.toMatch(/\bexecSync\b/)
    // execFileSync must be the only sync child-process executor.
    expect(source).toMatch(/\bexecFileSync\b/)
  })

  it("passes the previously-unsafe sinks as argument arrays, not joined shell strings", () => {
    // pgrep: needle (user-controlled profile path) must be a separate array arg.
    expect(source).toMatch(/execFileSync\(\s*"pgrep",\s*\["-f",\s*needle\]/)
    // kill: the pid is a distinct array element, never interpolated into a string.
    expect(source).toMatch(/execFileSync\(\s*"kill",\s*\["-9",\s*String\(id\)\]/)
    // taskkill: same argument-array discipline.
    expect(source).toMatch(/execFileSync\(\s*"taskkill",\s*\["\/PID",\s*String\(id\),\s*"\/T",\s*"\/F"\]/)
    // No backtick template-string interpolation into a child_process call remains.
    // (No shell metacharacters should be passed as a single command string.)
    expect(source).not.toMatch(/exec(?:File)?Sync\(`/)
  })

  it("keeps the registry lookups as array-based reg query calls", () => {
    expect(source).toMatch(/execFileSync\(\s*"reg",\s*\["query",\s*key,\s*"\/ve"\]/)
    expect(source).toMatch(/execFileSync\(\s*"reg",\s*\["query",\s*"HKCU\\[^"]*nLocaleName",\s*"\/ve"\]/)
  })
})
