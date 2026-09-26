// WS-7 T4 - the agents API CORS posture must stay default-deny.
//
// The service shipped `allow_origins=["*"]` with wildcard methods and headers,
// which let ANY page the user visited call the local agents API from their
// browser. That is an unnecessary cross-origin blast radius for a local backend.
//
// This guard lives in the vitest floor (rather than a pytest file) on purpose:
// the agents service has no Python test runner wired into CI, so a pytest file
// would sit unexecuted and read as coverage while verifying nothing. Anything
// shipped here is therefore actually run.
//
// It pins the SHAPE of the fix, not merely the absence of one string, so the
// protection cannot be undone by reintroducing a different broad pattern.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "../../../..")
const SERVER = resolve(ROOT, "agents/picc_agents/server.py")
const SETTINGS = "agents/picc_agents/settings.json"

const source = readFileSync(SERVER, "utf8")

// The negative assertions must judge CONFIGURATION, not prose. A guard comment
// that documents the old vulnerable value (e.g. "this was allow_origins=[\"*\"]")
// would otherwise trip the guard that exists to catch exactly that value.
// So strip docstrings and `#` comments before matching.
const code = source
  .replace(/"""[\s\S]*?"""/g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join("\n")

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })

describe("WS-7 T4 agents API CORS is default-deny", () => {
  it("never configures a wildcard origin", () => {
    expect(code, "allow_origins must never be a wildcard").not.toMatch(/allow_origins\s*=\s*\[\s*["']\*["']\s*\]/)
  })

  it("never configures wildcard methods or headers", () => {
    // `*` methods/headers are what turn an origin hole into a full-verb hole.
    expect(code, "allow_methods must not be a wildcard").not.toMatch(/allow_methods\s*=\s*\[\s*["']\*["']\s*\]/)
    expect(code, "allow_headers must not be a wildcard").not.toMatch(/allow_headers\s*=\s*\[\s*["']\*["']\s*\]/)
  })

  it("resolves origins through an allowlist function rather than a literal", () => {
    // Pinning the function name means a later edit has to go through the
    // allowlist (and its wildcard rejection) instead of inlining a literal.
    expect(source).toMatch(/def _allowed_origins\(/)
    expect(source).toMatch(/allow_origins=_allowed_origins\(\)/)
  })

  it("keeps PICC's own dev and preview origins so the dashboard still works", () => {
    expect(source).toMatch(/http:\/\/localhost:5173/)
    expect(source).toMatch(/http:\/\/127\.0\.0\.1:5173/)
    expect(source).toMatch(/http:\/\/localhost:4173/)
  })

  it("rejects a wildcard supplied through the environment instead of honouring it", () => {
    // Fail-closed: a typo in PICC_AGENTS_ALLOWED_ORIGINS must not silently
    // restore the vulnerable configuration.
    expect(source).toMatch(/may not contain/)
    expect(source).toMatch(/raise ValueError/)
  })
})

describe("WS-7 T4 settings.json cannot leak a real LLM key into git", () => {
  it("is untracked", () => {
    expect(git("ls-files", SETTINGS).trim(), `${SETTINGS} must never be tracked`).toBe("")
  })

  it("is git-ignored", () => {
    // check-ignore exits 0 only when the path IS ignored.
    expect(() => git("check-ignore", SETTINGS)).not.toThrow()
  })

  it("still ships a keyless example so setup remains possible", () => {
    const example = readFileSync(resolve(ROOT, "agents/picc_agents/settings.example.json"), "utf8")
    expect(example).toMatch(/"api_key"\s*:\s*""/)
  })

  it("has no non-empty api_key anywhere in its git history", () => {
    // The recorded finding was a plaintext key in settings.json. Verified
    // absent: the risk was latent (a tracked file that COULD hold a key), not
    // an actual exposed secret. This pins that it stays that way.
    const commits = git("log", "--format=%H", "--", SETTINGS).split(/\r?\n/).filter(Boolean)
    for (const commit of commits) {
      let blob = ""
      try {
        blob = git("show", `${commit}:${SETTINGS}`)
      } catch {
        continue // the file did not exist at this commit
      }
      const match = blob.match(/"api_key"\s*:\s*"([^"]*)"/)
      if (match) {
        expect(match[1], `commit ${commit.slice(0, 8)} carried a non-empty api_key`).toBe("")
      }
    }
  })
})
