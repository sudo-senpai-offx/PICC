// WS-7 T5c — encoding-integrity guard: no tracked text file may carry CP1252
// misread of UTF-8, or a U+FFFD replacement character.
//
// WHY THIS FILE EXISTS AS A RUNNING TEST. PowerShell 5.1 reads a file without a
// BOM as ANSI (CP1252), not UTF-8, and writes it back the same way. On this
// project that has silently corrupted typographic characters - an em-dash
// U+2014, a right-arrow U+2192, a bullet U+2022 - THREE separate times. Each
// time the damage looked like a REGEX bug, because every character left behind
// is a real letter or punctuation mark, so a misread em-dash reads as
// plausible text and the natural first hypothesis is a broken pattern. The real
// cause is a byte-level misread several commits away. All three corruptions
// were committed. A comment cannot fix a class of defect that recurs every few
// slices, so the class is scanned for mechanically.
//
// THE DAMAGE IS A BYTE-LEVEL FACT, NOT A STRING THE AUTHOR CHOSE. A UTF-8
// sequence for a character above U+007F is two to four bytes. If those bytes
// are decoded as CP1252 instead, each becomes one printable character:
//
//   intended          UTF-8      misread as            appears as
//   U+2014 EM DASH    E2 80 94   E2, 80, 94            U+00E2 U+20AC U+201D
//   U+2192 RIGHT ARROW E2 86 92  E2, 86, 92            U+00E2 U+2020 U+2019
//   U+2022 BULLET     E2 80 A2   E2, 80, A2            U+00E2 U+20AC U+00A2
//
// Every one of those result characters is a legitimate letter or punctuation
// mark in isolation, which is exactly why the damage survives review. When the
// damaged file is itself saved and misread AGAIN the sequence doubles, giving
// eight characters ending in U+009D - the undefined CP1252 byte 0x9D. Both
// shapes are detected below.
//
// NO MOJIBAKE SEQUENCE IS REPRODUCED LITERALLY IN THIS FILE, INCLUDING THIS
// COMMENT. That is the precise claim, and it is deliberately narrower than "no
// character from the tables above appears here", because it is not true: the
// next paragraph quotes the BARE characters U+00E2, U+00E3 and U+00C5 on
// purpose, to show why a bare lead byte is not a finding. Those are single
// code points standing for themselves; the damage is the SEQUENCE, and no
// sequence is written out. The examples above are given as code points for that
// reason, and the detector's test samples are built from raw bytes. The first
// draft of this guard wrote the sequences out literally, and this guard then
// failed on ITSELF - which is the only honest way to demonstrate that it has
// teeth. Do not "tidy" the bare characters in the next paragraph away to satisfy
// a stricter reading of this line: they are the explanation of why the guard is
// safe on honest multilingual text, and removing them would remove the argument.
//
// A BARE LEAD CHARACTER IS NOT A FINDING, AND THAT IS THE WHOLE TRICK.
// `â` (U+00E2) and `ã` (U+00E3) are ordinary letters in French, Portuguese,
// Romanian and Turkish; `Å` (U+00C5) is a letter in Swedish, Danish and
// Norwegian. A guard that banned the single character U+00E2 would fail on
// honest prose, and the correct response to a guard that fails on honest text
// is for the next person to weaken or delete it - so a single-character ban
// would manufacture the very rot it is meant to prevent. The damage is the
// SEQUENCE: a UTF-8 lead byte (U+00C2..U+00F4) that is immediately followed by
// the code point a CP1252 read of its continuation byte produces. Legitimate
// text never produces that adjacency, because in real text those characters are
// independent letters with ordinary spacing between them.
//
// THE CONTINUATION SET IS THE COMPLETE CP1252 TABLE, NOT A HANDFUL. Bytes
// 0x80-0x9F do not map to U+0080-U+009F in CP1252 - they map to typographic
// characters such as U+20AC EURO SIGN, U+201D RIGHT DOUBLE QUOTE, U+2019 RIGHT
// SINGLE QUOTE and U+201A SINGLE LOW-9 QUOTATION MARK. An earlier draft of this
// detector listed only a few of them and therefore MISSED the em-dash family
// entirely, reporting a clean repository while 21 damaged lines were still
// committed. That is why the table below is spelled out in full: a detector with
// a partial alphabet is worse than none, because it reports a green run.
//
// THE FILE SET IS DISCOVERED, NEVER LISTED. The candidates come from
// `git ls-files`, and every text file in that list is read. A corruption
// introduced in a brand-new file, in a directory nobody thought of, fails this
// test. `.freebuff/worktrees/` is excluded explicitly: it is a gitignored
// nested worktree belonging to another branch, and although `git ls-files`
// already omits it because it is untracked, a future author rewriting this scan
// as a naive filesystem walk would pick it up and fail on another branch's
// working state. The exclusion is load-bearing intent, documented so it is not
// "tidied away" as redundant.
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative, sep } from "node:path"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join("/")

// ---------------------------------------------------------------------------
// The CP1252 continuation table, bytes 0x80-0x9F, in order. 0xA0-0xBF map to
// themselves and are added below. Undefined CP1252 bytes (0x81, 0x8D, 0x8F,
// 0x90, 0x9D, 0x9F) are included as their C1 code points, because a permissive
// latin1-style misread yields exactly those and the double-encoded corruption
// genuinely ends in U+009D.
// ---------------------------------------------------------------------------
const CP1252_80_9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
]

const CONTINUATION = new Set([
  ...CP1252_80_9F,
  ...Array.from({ length: 0xbf - 0xa0 + 1 }, (_, i) => 0xa0 + i)
])

// A UTF-8 lead byte as a single misread CP1252 character.
const isLead = (cp) => cp !== undefined && cp >= 0xc2 && cp <= 0xf4
const isContinuation = (cp) => cp !== undefined && CONTINUATION.has(cp)
// A third byte is anything printable-ASCII, whitespace, or another continuation
// code point. It must NOT be a lead byte, or the run was not a valid UTF-8
// sequence to begin with.
const isTail = (cp) =>
  cp !== undefined &&
  !isLead(cp) &&
  (CONTINUATION.has(cp) || (cp >= 0x20 && cp <= 0x7e) || cp === 0x09 || cp === 0x0a || cp === 0x0d)

/** Every multi-character mojibake sequence in `text`, with its line number. */
function findMojibake(text) {
  const found = []
  for (let i = 0; i < text.length; i++) {
    if (!isLead(text.codePointAt(i))) continue
    if (!isContinuation(text.codePointAt(i + 1))) continue
    const length = isTail(text.codePointAt(i + 2)) ? 3 : 2
    found.push({
      line: text.slice(0, i).split("\n").length,
      seq: text.slice(i, i + length)
    })
    i += length - 1
  }
  return found
}

const REPLACEMENT_CHAR = /\uFFFD/g

// ---------------------------------------------------------------------------
// ALLOWLIST - legitimate sequences that must survive.
//
// CURRENTLY EMPTY, and that is a measured fact rather than an omission: the
// repository-wide scan below reports zero findings, so nothing needs to be
// permitted. The structure is kept because the alternative is that the next
// person who hits a genuine false positive hardcodes an `if` into the scan,
// which is how a guard quietly stops being a guard.
//
// An entry is legitimate only if the sequence is REAL damage-shaped text that
// the project genuinely needs to keep - for example a file that documents this
// very corruption, or a test fixture that must reproduce it. An entry needs a
// non-empty `reason` (a bare marker is not an allowance) and an exact
// `sequences` count, so a NEW hit in an allowlisted file is still caught and a
// stale entry - the text it permitted is gone - is itself a failure.
// ---------------------------------------------------------------------------
const ALLOWLIST = []

const EXCLUDED_PREFIXES = [".freebuff/worktrees/"]

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)))

// WHY A NUL BYTE IS NOT SUFFICIENT TO CALL A FILE BINARY. It is necessary but
// not sufficient, and treating it as sufficient silently dropped a TEXT file
// from this guard's own scan: this repository uses a raw NUL byte deliberately,
// as a cache-key separator in ws7RegulatoryClaimGuard.test.mjs, so that file
// was classified binary and never scanned - which made this guard's headline
// claim ("no tracked text file may carry...") false for one of the very files
// its own commit had just edited. The bug was invisible for two independent
// reasons: that file was not in HISTORICALLY_DAMAGED, and the vacuity floor
// passed comfortably. Real binary data is not merely NUL-bearing, it is
// DENSE in control bytes; a 64KB source file with one NUL is 0.0015% control.
// Measured across every NUL-containing tracked file in this repository the
// separation is four orders of magnitude - 0.000015 for the text file against
// 0.199 for the lowest-density PNG - so 0.05 is not a tuned magic number, it
// sits in the middle of an empty gap. This is the shape of test git itself uses.
const BINARY_CONTROL_RATIO = 0.05

function looksBinary(bytes) {
  // Necessary but not sufficient: a NUL on its own means "binary", which is
  // exactly the bug this second condition exists to remove.
  if (!bytes.includes(0)) return false
  const sample = bytes.subarray(0, Math.min(bytes.length, 65536))
  let control = 0
  for (const byte of sample) {
    // Tab, LF and CR are TEXT whitespace and must not count against a file.
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    if (byte < 0x20 || byte === 0x7f) control++
  }
  return control / sample.length > BINARY_CONTROL_RATIO
}

/** Why each tracked file was not scanned. Absent means "it was scanned". */
const SKIPPED = new Map()

/** Read a tracked file as text, or return null if it is binary. */
function readText(rel) {
  let bytes
  try {
    bytes = readFileSync(join(REPO_ROOT, rel))
  } catch {
    SKIPPED.set(rel, "unreadable")
    return null
  }
  if (looksBinary(bytes)) {
    SKIPPED.set(rel, "binary")
    return null
  }
  return bytes.toString("utf8")
}

/** file -> { mojibake: [...], fffd: n } for every scannable tracked text file. */
const SCAN = (() => {
  const out = new Map()
  for (const rel of trackedFiles) {
    const text = readText(rel)
    if (text === null) continue
    out.set(rel, { mojibake: findMojibake(text), fffd: (text.match(REPLACEMENT_CHAR) || []).length })
  }
  return out
})()

const nonAsciiCount = (text) => [...text].filter((c) => c.codePointAt(0) > 0x7f).length

// The six files this guard was written for. If discovery silently stopped
// reaching them, every other test here would still pass on an empty scan set,
// so they are pinned explicitly.
const HISTORICALLY_DAMAGED = [
  "apps/dashboard/src/hooks/__tests__/useSourcePreference.test.tsx",
  "apps/dashboard/src/hooks/__tests__/useCandleData.freshness.test.tsx",
  "apps/dashboard/server/__tests__/browserStudio.test.mjs",
  "apps/dashboard/e2e/terminal-perf.spec.ts",
  "apps/dashboard/e2e/ws7-transition-diagnostic.spec.ts",
  "apps/dashboard/perf/terminal-perf-manifest.json"
]

describe("WS-7 T5c - encoding integrity: the detector can actually fail", () => {
  // These samples are built from HEX, never written as literals. A literal
  // misread em-dash (U+00E2 U+20AC U+201D) written into this file would make
  // the guard's own scan find the guard file, and an allowlist entry to excuse
  // that would be a self-inflicted blind spot.
  const MISREAD_EM_DASH = Buffer.from("c3a2e282ace2809d", "hex").toString("utf8")
  const MISREAD_ARROW = Buffer.from("c3a2e280a0e28099", "hex").toString("utf8")
  const MISREAD_BULLET = Buffer.from("c3a2e282acc2a2", "hex").toString("utf8")
  const MISREAD_EM_DASH_TWICE = Buffer.from("c383c2a2c3a2e2809ac2acc3a2e282acc29d", "hex").toString("utf8")

  it("detects the single-misread forms of the characters this project uses", () => {
    for (const [label, sample] of [
      ["em-dash U+2014", MISREAD_EM_DASH],
      ["right-arrow U+2192", MISREAD_ARROW],
      ["bullet U+2022", MISREAD_BULLET]
    ]) {
      expect(findMojibake(sample), `a CP1252 misread of ${label} must be detected`).toHaveLength(1)
    }
  })

  it("detects the DOUBLE-misread form, the shape that survived three commits", () => {
    const found = findMojibake(`targetDeviceClaim: "UNVERIFIED ${MISREAD_EM_DASH_TWICE} throttling"`)
    expect(found.length, "a file misread twice must still be detected").toBeGreaterThan(0)
    expect(found[0].line).toBe(1)
  })

  it("does not flag the clean originals of those same characters", () => {
    for (const [label, clean] of [
      ["em-dash", "Browser Studio — site detection"],
      ["right-arrow", "Unknown asset on a deep-linkable venue → venue root"],
      ["bullet", "//   • load the saved pref on mount"]
    ]) {
      expect(findMojibake(clean), `a clean ${label} must not be flagged`).toEqual([])
    }
  })

  it("does not flag letters that merely RESEMBLE a mojibake lead byte", () => {
    // This is the test that separates this guard from the wrong one. A
    // single-character ban on U+00E2 fails on every line below; the sequence
    // rule is silent on all of them and still catches the real damage.
    for (const [label, honest] of [
      ["Portuguese", "o utilizador não podeTradegar"],
      ["French", "le château d'Aix-en-Provence"],
      ["Romanian", "înțelegi asta, nu"],
      ["Turkish", "İstanbul'da Ångström"],
      ["Vietnamese", "tiếng Việt đầy ắp"]
    ]) {
      expect(findMojibake(honest), `honest ${label} text must not be flagged`).toEqual([])
    }
  })

  it("detects a U+FFFD replacement character", () => {
    expect("broken \uFFFD text".match(REPLACEMENT_CHAR)).toHaveLength(1)
  })

  it("keeps non-ASCII characters that are legitimate, rather than banning them", () => {
    // A guard that "fixes" damage by deleting the character is not a fix, so the
    // clean originals must still be countable and must survive a round trip.
    const clean = "— → • não château Ångström"
    expect(findMojibake(clean)).toEqual([])
    expect(nonAsciiCount(clean), "legitimate non-ASCII must be preserved, not stripped").toBe(7)
  })
})

// SHAPE OF THE EXCLUSION, NOT A LIST OF NAMES. Anything this guard skips must
// be skipped because it is BINARY, and binary-ness is a property of the bytes,
// not of the file's name. So the assertions below are about SHAPE: every skip
// must carry a binary reason, no skipped file may carry a text-ish extension,
// and the skipped set must stay a negligible fraction of the corpus. A named
// allowlist of "these files may be skipped" would be the precise thing this
// guard exists to prevent - an exclusion that reads as coverage - and it would
// rot silently the first time somebody renamed a file on it.
const BINARY_EXTENSION =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|psd|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|xz|7z|mp3|mp4|mov|webm|avi|wav|flac|wasm|so|dll|dylib|exe|class|jar|pyc|o|obj)$/i

describe("WS-7 T5c - encoding integrity: the scan set is real", () => {
  it("discovers a substantial number of tracked text files", () => {
    expect(
      SCAN.size,
      "the scan must actually cover the repository, not an empty or near-empty set"
    ).toBeGreaterThan(400)
    // The absolute floor above cannot catch a rule that quietly drops a large
    // SLICE of the corpus - a NUL heuristic going mass-misfire, or a read error
    // firing en masse - because the remaining hundreds still clear it. A ratio
    // is what distinguishes "the corpus" from "a convenient subset of it".
    expect(
      SCAN.size / trackedFiles.length,
      "the scan must cover the corpus, not a convenient subset: a rule that dropped " +
        "hundreds of files at once would leave every other test in this file green"
    ).toBeGreaterThan(0.95)
  })

  it("excludes nothing that is not genuinely binary", () => {
    // THE ASSERTION THAT FAILS ON A BARE-NUL RULE. This is the net for the
    // defect that shipped: a text file containing a deliberate NUL was skipped
    // as "binary" and never scanned, while every other assertion in this file
    // stayed green because the corpus was still large and the file was not
    // named in HISTORICALLY_DAMAGED.
    const notBinary = [...SKIPPED.entries()]
      .filter(([, reason]) => reason !== "binary")
      .map(([file, reason]) => `${file} (skipped as ${reason})`)
    expect(
      notBinary,
      "every file this guard skips must be skipped as binary; an unreadable or " +
        "otherwise dropped text file is a silent coverage hole"
    ).toEqual([])

    const notBinaryShaped = [...SKIPPED.keys()].filter((file) => !BINARY_EXTENSION.test(file))
    expect(
      notBinaryShaped,
      "a skipped file must look binary by extension. A source file here means the " +
        "binary heuristic is too broad, which is how a text file stops being scanned."
    ).toEqual([])
  })

  it("keeps the excluded set a negligible fraction of the corpus", () => {
    expect(
      SKIPPED.size / trackedFiles.length,
      "the skipped set must stay negligible; a large one means the binary heuristic " +
        "is misfiring in bulk"
    ).toBeLessThan(0.05)
  })

  it("scans a text file that deliberately contains a NUL byte", () => {
    // The concrete instance, pinned positively so the general shape assertions
    // above cannot be satisfied by a rule that happens to agree today. This
    // file uses a raw NUL as a cache-key separator; a bare-NUL binary test drops
    // it. It is pinned as something that MUST BE SCANNED, which is the opposite
    // of an allowlist entry.
    const NUL_BEARING_TEXT =
      "apps/dashboard/server/__tests__/ws7RegulatoryClaimGuard.test.mjs"
    expect(
      SCAN.has(NUL_BEARING_TEXT),
      "a source file containing a deliberate NUL byte is still text and must be scanned"
    ).toBe(true)
  })

  it("reaches every file this guard was written for", () => {
    // If discovery stopped covering these, the scan test below would pass
    // vacuously - which is precisely the "coverage read as coverage" failure
    // the project has already had to correct once.
    const missing = HISTORICALLY_DAMAGED.filter((f) => !SCAN.has(f))
    expect(missing, "the historically-damaged files must stay inside the scan set").toEqual([])
  })

  it("excludes the gitignored nested worktree of another branch", () => {
    expect(
      trackedFiles.some((f) => f.startsWith(".freebuff/worktrees/")),
      ".freebuff/worktrees/ is another branch's working state and must never be scanned"
    ).toBe(false)
  })

  it("scans this guard's own file, so the guard cannot hide from itself", () => {
    expect(SCAN.has(SELF), "the guard must include itself in the scan").toBe(true)
  })
})

describe("WS-7 T5c - encoding integrity: no tracked text file is damaged", () => {
  it("finds no CP1252-misread sequence outside the reasoned allowlist", () => {
    const violations = []
    for (const [file, result] of SCAN) {
      const permitted = ALLOWLIST.filter((a) => a.file === file)
      const allowance = permitted.reduce((n, a) => n + a.sequences, 0)
      const hits = result.mojibake.length
      if (hits > allowance) {
        violations.push(
          `${file}: ${hits} mojibake sequence(s) ` +
            `first at L${result.mojibake[0].line} ${JSON.stringify(result.mojibake[0].seq)}`
        )
      }
    }
    expect(
      violations,
      "A CP1252 misread is committed text damage, not a style choice. Repair the " +
        "characters to what was intended (the bytes are E2 80 94 for an em-dash, " +
        "E2 86 92 for a right-arrow, E2 80 A2 for a bullet), or - if a sequence is " +
        "genuinely required - add a reasoned ALLOWLIST entry above. Never re-save " +
        "the file with PowerShell 5.1: it reads UTF-8 without a BOM as CP1252."
    ).toEqual([])
  })

  it("finds no U+FFFD replacement character outside the reasoned allowlist", () => {
    const violations = []
    for (const [file, result] of SCAN) {
      const allowance = ALLOWLIST.filter((a) => a.file === file).reduce((n, a) => n + a.fffd, 0)
      if (result.fffd > allowance) violations.push(`${file}: ${result.fffd} U+FFFD`)
    }
    expect(violations, "U+FFFD means a decode already lost the original byte").toEqual([])
  })
})

describe("WS-7 T5c - encoding integrity: the allowlist stays honest", () => {
  it("gives every entry a written reason and an exact count", () => {
    for (const entry of ALLOWLIST) {
      expect(typeof entry.reason, "an allowlist entry must carry a written reason").toBe("string")
      expect(entry.reason.trim().length, "a bare marker is not an allowance").toBeGreaterThan(40)
      expect(Number.isInteger(entry.sequences), "an entry must state an exact count").toBe(true)
    }
  })

  it("does not permit a sequence that is no longer present (no stale entries)", () => {
    for (const entry of ALLOWLIST) {
      const result = SCAN.get(entry.file)
      expect(result, `allowlisted file ${entry.file} must still exist`).toBeDefined()
      expect(
        result.mojibake.length,
        `allowlist entry ${entry.file} is stale: the text it permitted has changed count`
      ).toBe(entry.sequences)
    }
  })

  it("needs no allowance today, and says so by being empty", () => {
    // Not a tautology: if a future scan ever needs an exception this becomes
    // the test that forces the exception to be written down and justified
    // rather than smuggled into the detector.
    expect(ALLOWLIST, "an empty allowlist is the intended state while the scan is clean").toEqual([])
  })
})
