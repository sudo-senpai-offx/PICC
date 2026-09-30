// WS-7 T7a follow-up - the lockfile must actually satisfy package.json's
// `overrides`, and the declaration must not silently disappear.
//
// WHY THIS FILE EXISTS AS A RUNNING TEST.
//
// The T7a commit (`3891bbb`) added a two-key root `overrides` block to move
// `undici` off two high-severity advisories, and it had to hand-edit SIX
// `package-lock.json` lines to make the change take effect. That hand-edit is
// not a preference, it is a fact about npm: when the lockfile is already
// complete, `npm install`, `npm install --package-lock-only` and `npm update`
// all treat the lockfile as authoritative and leave it alone. The `overrides`
// block on its own is INERT against a complete lockfile - it only takes effect
// when the lockfile is regenerated from scratch.
//
// So T7a produced a state with two independent halves:
//
//   1. a lockfile carrying patched versions, and
//   2. a manifest declaring why those versions are there.
//
// and NOTHING asserted that the two agree. The state was verified by hand, once,
// by the author of the commit that created it. That is exactly the shape that
// has produced most of the defects in this workstream, and it is the shape
// D27 and the "verified once by hand, nothing enforces it" rule exist to close.
//
// WHAT IT GUARDS, IN BOTH DIRECTIONS.
//
//   DIRECTION 1 - declared but not satisfied. The lockfile carries the
//   vulnerable version the override was written to remove. This is the
//   silent-inert case and the one that matters most, because the manifest
//   still LOOKS correct: `package.json` says 7.29.1, the audit gate is a
//   separate command, and nothing in the test suite objects.
//
//   DIRECTION 2 - satisfied but not declared. The lockfile carries a patched
//   version that NO override explains. This is the mirror failure and it was
//   equally undetected: a reviewer deleting the `overrides` block, or a merge
//   resolving `package.json` in favour of the branch that never had it, leaves
//   a lockfile full of hand-edited versions with no declared intent. Because
//   npm will not re-resolve a satisfied lockfile edge, nothing puts it back.
//   The patched version becomes a folklore number nobody can justify, and the
//   next `npm install` on a regenerated lockfile silently reverts it.
//
// PINNED, NOT DERIVED, AND WHY THAT IS THE POINT.
//
// The expected declarations below are TRANSCRIBED, not computed from
// `package.json`. If they were derived they would be tautological - the test
// would compare `package.json` against itself and could never fail. The
// transcription is the owner's T7a decision, recorded in the guard, and it is
// the independent third source of truth alongside the manifest and the
// lockfile. The same pattern is used by `ws5SeamGuard.test.mjs`'s authorised
// path set: the authorisation is pinned to its exact true value and asserted,
// so it cannot be widened to make a suite green.
//
// This also means the set is not a hand-maintained duplicate that can drift
// silently: adding a THIRD override to `package.json` fails here until the
// guard's transcription is updated deliberately, and removing one fails here
// immediately. Both directions are covered by
// "declares exactly the pinned override set, and nothing else".
//
// THE SAME-MAJOR AND NOT-A-NO-OP ASSERTIONS.
//
// T7a recorded a deliberate constraint: `ccxt` pins `undici` to exactly
// `7.29.0`, so a single-version override would push it across a major
// boundary. Each override therefore moves its dependents one patch WITHIN
// their own major. That constraint is asserted here rather than left in a
// commit message, because the failure it prevents (a tree-wide `undici@8`
// that silently breaks the `ccxt` edge) is not something a version-equality
// check would ever catch. An override that maps a version to ITSELF is also
// asserted to be a violation: it is inert by construction and reads as a fix.
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const MANIFEST_PATH = join(REPO_ROOT, "package.json")
const LOCKFILE_PATH = join(REPO_ROOT, "package-lock.json")

function readJson(path) {
  // existsSync BEFORE readFileSync so a missing file produces a named failure
  // rather than an ENOENT stack trace from inside a helper. Both files are
  // load-bearing for every assertion below; a missing one must not read as an
  // empty object, which would make "declares nothing" indistinguishable from
  // "declares exactly what we want" in the direction-1 layer.
  if (!existsSync(path)) throw new Error(`required file is missing: ${path}`)
  return JSON.parse(readFileSync(path, "utf8"))
}

const manifest = readJson(MANIFEST_PATH)
const lockfile = readJson(LOCKFILE_PATH)
const LOCK_PACKAGES = lockfile.packages ?? {}

// ---------------------------------------------------------------------------
// THE INDEPENDENT EXPECTATION (transcribed from the T7a decision, 3891bbb)
// ---------------------------------------------------------------------------
// Key: the exact `overrides` key npm is given. Value: the exact version it must
// resolve to. Nothing here is read from `package.json` - see the header.
const PINNED_OVERRIDES = {
  "undici@7.29.0": "7.29.1",
  "undici@^8.9.0": "8.10.2"
}

/**
 * Split an `overrides` key into its package name and its range.
 *
 * The separator is the LAST `@` at index > 0, not the first: a scoped package
 * name begins with `@` (`@scope/name@^1.2.3`), so splitting on the first `@`
 * yields an empty name and a range of `scope/name@^1.2.3`. npm's own key syntax
 * is `name@range` with the range optional, and a bare `name` key means "every
 * version of this package", so `range` may be null.
 */
function splitOverrideKey(key) {
  const at = key.lastIndexOf("@")
  if (at <= 0) return { name: key, range: null }
  return { name: key.slice(0, at), range: key.slice(at + 1) }
}

/** Major of a `x.y.z` version, or null when the string is not a plain triple. */
function majorOf(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  return m === null ? null : Number(m[1])
}

/**
 * Lower bound of an override range, as a concrete version.
 *
 * Only the forms actually used by this repository's overrides are handled
 * (bare `^x.y.z` and exact `x.y.z`). Anything else returns null, and every
 * consumer treats null as "cannot check" rather than as "check passed" - a
 * range this guard cannot reason about must not read as a satisfied
 * constraint. npm's full range grammar is not reimplemented here on purpose;
 * the same-major rule only needs the major, and the versions are read from the
 * lockfile by the caller.
 */
function rangeLowerBound(range) {
  if (range == null) return null
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)/.exec(range)
  if (m === null) return null
  return `${m[1]}.${m[2]}.${m[3]}`
}

/**
 * Every lockfile path that resolves `name` to a real installed copy.
 *
 * The suffix is EXACT - `node_modules/undici` - so `node_modules/undici-types`
 * (a different, `@types`-style package that happens to share the prefix) is not
 * swept in. A false positive here would be a guard that fails on a healthy
 * tree, which is how guards get weakened.
 *
 * The root entry (`""`) is excluded explicitly: it is the workspace root
 * project, not a dependency, and it has no `version` for a package to match.
 */
function lockfilePathsFor(name) {
  const suffix = `node_modules/${name}`
  return Object.keys(LOCK_PACKAGES).filter((path) => path !== "" && path.endsWith(suffix)).sort()
}

/** Overridden package names, derived from the PINNED set, in a stable order. */
const OVERRIDDEN_NAMES = [
  ...new Set(Object.keys(PINNED_OVERRIDES).map((k) => splitOverrideKey(k).name))
].sort()

/**
 * The full set of versions the pinned set permits for `name`.
 *
 * Two keys can name the same package at different ranges (here `undici@7.29.0`
 * and `undici@^8.9.0`), and each carries its OWN permitted version, so a
 * per-path check has to consult the whole set rather than one key. This is what
 * makes the two majors of `undici` coexisting in one lockfile a legitimate
 * state rather than a contradiction.
 */
function permittedVersionsFor(name) {
  return Object.entries(PINNED_OVERRIDES)
    .filter(([key]) => splitOverrideKey(key).name === name)
    .map(([, version]) => version)
}

describe("AC-046/AC-018 - package.json's overrides are the declaration, and it is intact", () => {
  it("declares exactly the pinned override set, and nothing else", () => {
    // DIRECTION 2's gate. Deleting the `overrides` block leaves a lockfile
    // full of hand-edited patched versions that nothing explains, and npm will
    // not put the vulnerable ones back on its own. This assertion is what
    // makes that state red.
    const declared = manifest.overrides ?? {}
    expect(
      Object.keys(declared).sort(),
      "package.json's `overrides` keys must equal the guard's pinned set exactly. A key added or removed here changes what the lockfile is accountable to, and the guard's transcription must be updated deliberately rather than drifted."
    ).toEqual(Object.keys(PINNED_OVERRIDES).sort())

    for (const [key, version] of Object.entries(PINNED_OVERRIDES)) {
      expect(
        declared[key],
        `override "${key}" must pin exactly ${version}. A different value silently changes which advisory range the audit gate is holding the tree to.`
      ).toBe(version)
    }
  })

  it("reports every lockfile version that no override declares", () => {
    // DIRECTION 2, derived from BOTH files rather than from the transcription
    // alone, so it is independent of the gate above.
    //
    // The gate above compares `package.json` against a hard-coded set. That
    // transcription is also editable, and the realistic bad edit is to delete
    // the `overrides` block and the pinned table in the same commit "to keep
    // them in sync" - after which the gate above compares `{}` with `{}` and
    // passes. This assertion cannot be satisfied that way: it reads the
    // versions the lockfile ACTUALLY ships and asks the manifest to account
    // for each one. Deleting the declaration leaves the lockfile's patched
    // versions unexplained no matter what the transcription says.
    //
    // The scope is the packages this guard governs, not the whole lockfile: a
    // version nobody has declared an override for is entirely normal for the
    // other 259 entries - most of them have no override at all. The question
    // here is narrower and is the one that matters: does a version this guard
    // knows was pinned BY AN OVERRIDE still have that override?
    const declared = manifest.overrides ?? {}
    const undeclared = []
    for (const name of OVERRIDDEN_NAMES) {
      const declaredVersions = new Set(
        Object.entries(declared)
          .filter(([key]) => splitOverrideKey(key).name === name)
          .map(([, version]) => version)
      )
      for (const path of lockfilePathsFor(name)) {
        const version = LOCK_PACKAGES[path]?.version
        if (!declaredVersions.has(version)) {
          undeclared.push(
            `${path} ships ${version}, which no override in package.json declares. The lockfile carries a version nothing explains; npm will not re-resolve a satisfied edge, so nothing puts it back.`
          )
        }
      }
    }
    expect(undeclared, "every lockfile version this guard governs must be declared by an override").toEqual([])
  })

  it("never declares an override that pins a version to itself", () => {
    // `{"undici@7.29.0": "7.29.0"}` reads as a fix in review and does nothing
    // at install time. A version-equality guard cannot see this, so it is
    // asserted separately.
    for (const [key, version] of Object.entries(PINNED_OVERRIDES)) {
      const { range } = splitOverrideKey(key)
      expect(range, `override key "${key}" must carry the range it replaces`).not.toBeNull()
      expect(
        version,
        `override "${key}" pins ${version} to itself, which is inert - it looks like a remediation and changes nothing.`
      ).not.toBe(range)
    }
  })

  it("keeps every override inside the major it replaces", () => {
    // T7a recorded this as the reason a single-version override was rejected:
    // `ccxt` pins `undici` to exactly 7.29.0, so collapsing the tree onto one
    // `undici` would push `ccxt` across a major boundary. The constraint is
    // load-bearing and was otherwise recorded only in a commit message.
    for (const [key, version] of Object.entries(PINNED_OVERRIDES)) {
      const { range } = splitOverrideKey(key)
      const lower = rangeLowerBound(range)
      const from = majorOf(lower)
      const to = majorOf(version)
      if (from === null || to === null) {
        // A range this guard cannot parse is reported, never treated as
        // satisfied. Silently passing an unparsed range is how the check ends
        // up decorative.
        throw new Error(`override "${key}" has an unparseable range "${range}"; extend rangeLowerBound rather than skipping the check`)
      }
      expect(
        to,
        `override "${key}" moves undici from major ${from} to major ${to}. A major-crossing override breaks the dependents that pinned the old major (ccxt pins 7.29.0 exactly).`
      ).toBe(from)
    }
  })

  it("splits scoped package names correctly, so a future scoped override is not mis-parsed", () => {
    // The reason `splitOverrideKey` splits on the LAST `@` rather than the
    // first. A split on the first `@` yields name "" for a scoped package, the
    // name matches no lockfile path, and DIRECTION 1's "at least one path
    // satisfies it" check then fires on a perfectly healthy tree - a guard
    // that fails on correct input is a guard that gets deleted.
    expect(splitOverrideKey("@scope/pkg@^1.2.3")).toEqual({ name: "@scope/pkg", range: "^1.2.3" })
    expect(splitOverrideKey("undici@7.29.0")).toEqual({ name: "undici", range: "7.29.0" })
    expect(splitOverrideKey("undici")).toEqual({ name: "undici", range: null })
    // And the real keys parse the way the guard believes they do.
    for (const key of Object.keys(PINNED_OVERRIDES)) {
      expect(splitOverrideKey(key).name, `${key} must name a real package`).not.toBe("")
    }
  })
})

describe("AC-046/AC-018 - the lockfile satisfies the declaration", () => {
  it("resolves every lockfile path of an overridden package to a permitted version", () => {
    // DIRECTION 1's gate. Reverting one `package-lock.json` version back to the
    // vulnerable patch - the exact hand-edit this guard exists to catch - fails
    // here, naming the path, what it carries, and what was permitted.
    const violations = []
    for (const name of OVERRIDDEN_NAMES) {
      const permitted = permittedVersionsFor(name)
      for (const path of lockfilePathsFor(name)) {
        const version = LOCK_PACKAGES[path]?.version
        if (!permitted.includes(version)) {
          violations.push(`${path} is ${version}; package.json permits only ${permitted.join(" or ")}`)
        }
      }
    }
    expect(violations, "every lockfile path of an overridden package must match a declared override").toEqual([])
  })

  it("has at least one lockfile path for every overridden package", () => {
    // The silent-inert case, isolated so its failure names ITSELF. A lockfile
    // with no `undici` entry at all while `package.json` still declares the
    // override means the declaration is describing a package that is not in
    // the tree: either the tree changed under it or the declaration is stale.
    // Either way "the lockfile satisfies the overrides" is not a true statement,
    // and a check that only compared versions would see zero paths, compare
    // zero versions, and pass.
    for (const name of OVERRIDDEN_NAMES) {
      const paths = lockfilePathsFor(name)
      expect(
        paths.length,
        `package.json declares an override for "${name}" but the lockfile contains no node_modules/${name} entry, so nothing satisfies the declaration.`
      ).toBeGreaterThan(0)
    }
  })

  it("permits a package to hold several majors only when the declaration names each of them", () => {
    // `undici` legitimately appears twice - 7.29.1 for `ccxt` and 8.10.2 under
    // `jsdom` - and a guard that asserted "one version per package" would call
    // that healthy tree broken. The rule is the opposite: each path must match
    // SOME declaration for that name, and each major present must be named.
    // This test pins the two-major reality so a future single-version
    // "simplification" is a visible, deliberate act rather than a quiet one.
    const present = new Set()
    for (const name of OVERRIDDEN_NAMES) {
      for (const path of lockfilePathsFor(name)) present.add(majorOf(LOCK_PACKAGES[path]?.version))
    }
    const declaredMajors = new Set()
    for (const name of OVERRIDDEN_NAMES) {
      for (const version of permittedVersionsFor(name)) declaredMajors.add(majorOf(version))
    }
    expect([...present].sort(), "every major present in the lockfile must be named by an override").toEqual(
      [...declaredMajors].sort()
    )
  })

  it("scans a lockfile set that is real, not an empty or hand-listed subset", () => {
    // Non-vacuity. A guard that found no paths would pass every version
    // assertion above, so the discovered set is proved non-empty and is proved
    // to contain the paths the T7a hand-edit actually touched.
    const entries = Object.keys(LOCK_PACKAGES).filter((k) => k !== "")
    expect(entries.length, "the lockfile scan set must be substantial").toBeGreaterThan(200)
    expect(lockfile.lockfileVersion, "this guard reads lockfileVersion 3 `packages`, not a v1 `dependencies` map").toBe(3)
    for (const path of ["node_modules/undici", "node_modules/jsdom/node_modules/undici"]) {
      expect(entries, `${path} must be inside the discovered lockfile set`).toContain(path)
    }
    // And the exact-suffix scan must not sweep in a same-prefix neighbour.
    expect(
      lockfilePathsFor("undici"),
      "a same-prefix sibling must not be swept in by the path scan"
    ).not.toContain("node_modules/undici-types")
  })
})

// A base64 payload is only well-formed if its LENGTH matches the digest it
// claims, and its PADDING matches that length. A character-class regex alone
// accepts a truncated hash - `sha512-` plus 44 valid base64 characters is the
// alphabet, so it passes - and a truncated integrity is one of the hand-edit
// accidents this check exists to catch. The digest sizes and their canonical
// base64 lengths and padding runs are therefore checked together:
//
//   sha256 -> 32 bytes -> 44 chars total, one trailing `=`, 43 data chars
//   sha384 -> 48 bytes -> 64 chars total, no padding (48 is a multiple of 3)
//   sha512 -> 64 bytes -> 88 chars total, two trailing `=`, 86 data chars
//
// This is a structural check, not a checksum. See the scope note below.
const SRI_DIGESTS = {
  sha256: { total: 44, padding: 1 },
  sha384: { total: 64, padding: 0 },
  sha512: { total: 88, padding: 2 }
}

function wellFormedIntegrity(value) {
  if (typeof value !== "string") return false
  // A hand-edit that introduced surrounding whitespace is a defect: `npm ci`
  // compares the recorded string byte for byte.
  if (value.trim() !== value) return false
  const m = /^sha(256|384|512)-(.+)$/.exec(value)
  if (m === null) return false
  const spec = SRI_DIGESTS[`sha${m[1]}`]
  if (spec === undefined) return false
  const payload = m[2]
  if (payload.length !== spec.total) return false
  const padding = "=".repeat(spec.padding)
  if (!payload.endsWith(padding)) return false
  // No `=` may appear anywhere in the data portion, so the padding run is the
  // only one and it is at the end - a hash with `==` in the middle is corrupt.
  const data = payload.slice(0, payload.length - spec.padding)
  return data.length > 0 && /^[A-Za-z0-9+/]+$/.test(data)
}

describe("AC-046/AC-018 - hand-edited lockfile entries are structurally well-formed", () => {
  // SCOPE DECISION, and it is narrow on purpose.
  //
  // The hand-edit class this catches is real: T7a rewrote `version`,
  // `resolved` and `integrity` on two lockfile entries using npm's own
  // generated values, and a version-equality check cannot tell a correctly
  // edited entry from one whose `integrity` is a truncated string, a hash of
  // the wrong file, or a base64 blob with a corrupt padding run. Those entries
  // are exactly the ones a future maintainer will re-edit by hand.
  //
  // The scope is the OVERRIDE-GOVERNED entries, not the whole lockfile, and the
  // reason is specific rather than cautious: a repo-wide integrity sweep has
  // to encode exceptions it cannot enumerate in advance (git dependencies
  // carry `sha1-`, `file:` and `link:` entries carry no `integrity` at all),
  // and a sweep whose exception list is guesswork is a sweep that goes red on
  // the next legitimate dependency shape and gets deleted. The narrow scope
  // needs no exception list, cannot go red on a healthy tree, and covers the
  // exact entries that were hand-edited.
  //
  // What it CANNOT do, stated here rather than left implicit: it does not
  // recompute the hash. Nothing offline can - that requires downloading the
  // tarball. A well-formedness check proves the entry is shaped like an npm
  // registry entry; it does not prove the bytes behind it are the right bytes.
  // Detecting a wrong-but-well-formed hash is `npm ci`'s job, and it is
  // unchanged.

  it("gives every override-governed entry a registry URL and a well-formed SRI hash", () => {
    // `npm ci` refuses a malformed `integrity` outright, so this is the
    // cheapest possible early signal; a truncated or whitespace-padded value
    // that survives here will fail the install later, far from its cause.
    const violations = []
    let checked = 0

    for (const name of OVERRIDDEN_NAMES) {
      for (const path of lockfilePathsFor(name)) {
        const entry = LOCK_PACKAGES[path] ?? {}
        checked += 1
        if (typeof entry.resolved !== "string" || !/^https:\/\/registry\.[^/]+\/.+\.tgz$/.test(entry.resolved)) {
          violations.push(`${path} has no https registry tarball URL (resolved: ${JSON.stringify(entry.resolved)})`)
        }
        if (!wellFormedIntegrity(entry.integrity)) {
          violations.push(
            `${path} has a malformed integrity (${JSON.stringify(entry.integrity)}); expected sha256/384/512 with a base64 payload of exactly the digest's length`
          )
        }
      }
    }

    expect(checked, "the well-formedness check must actually reach the hand-edited entries").toBeGreaterThan(0)
    expect(violations, "hand-edited lockfile entries must stay shaped like npm-generated ones").toEqual([])
  })

  it("proves a corrupt hash is caught, by probing the same shape check", () => {
    // The check above is structural, so it can be proved on its own terms
    // without mutating the lockfile: real entries pass and six hand-edit
    // accidents do not. Without this, "well-formed" is an assertion nobody has
    // ever seen fail.
    const real = LOCK_PACKAGES["node_modules/undici"]?.integrity
    expect(typeof real, "the probe needs a real entry to start from").toBe("string")
    expect(wellFormedIntegrity(real), "the real sha512 entry must pass the shape check").toBe(true)
    expect(
      wellFormedIntegrity(LOCK_PACKAGES["node_modules/jsdom/node_modules/undici"]?.integrity),
      "the second real sha512 entry must pass too, so the check is not tuned to one string"
    ).toBe(true)

    for (const [label, broken] of [
      ["truncated by a bad paste", real.slice(0, 40)],
      ["one character short of the digest length", real.slice(0, -3)],
      ["algorithm prefix dropped", real.replace("sha512-", "")],
      ["padding run stripped", real.replace(/=+$/, "")],
      ["non-alphabet characters", "sha512-not base64!!"],
      ["emptied", ""],
      ["wrapped in whitespace by a hand-edit", ` ${real} `],
      ["digest size of a different algorithm", `sha256-${real.slice("sha512-".length)}`]
    ]) {
      expect(wellFormedIntegrity(broken), `a corrupt integrity (${label}) must not pass`).toBe(false)
    }
  })
})
