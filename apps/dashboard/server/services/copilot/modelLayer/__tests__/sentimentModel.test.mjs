// WS-7 T13 — the PRODUCER half of T11's sentiment seam.
//
// T11 built `experts/sentiment.mjs` as a consumer: it reads `state.sentimentInput`
// and validates its shape, and T11 left the producer unfilled on purpose
// (`:6` — "THIS IS THE MODEL SEAM AND T11 DOES NOT FILL IT"). T13 fills it, and
// T11's file is NOT MODIFIED — which is the strongest available statement of
// AC-031, because the consumer that sits on the decision path has no import edge
// to the model at all. `modelIsolation.test.mjs` walks the import graph to prove
// it.
//
// §4.1:533 — "the model may contribute the 5% Sentiment expert's input and may
// write prose, and it may do nothing else."
//
// THE ORDER OF OPERATIONS IS THE CONTROL. The reader verifies the artifact's
// digest and format BEFORE it is willing to call the backend. A reader that
// inferred first and verified afterwards would have already executed whatever
// the artifact contained by the time D15's gate ran, which would make the gate a
// receipt rather than a control. So: verify → then infer. A test asserts the
// backend is never called when verification fails.
//
// WHY THE BACKEND IS INJECTED, AND WHY THE DEFAULT IS ABSENT. Needle 3 is a
// Cactus-proprietary runtime: `modelManifest.mjs`'s `needle3` row records the
// measured fact that its repository publishes `linux-*`, `macos-*`, `android-*`,
// `ios-*`, `tvos-*` and `wasm` builds and NO `windows-*` build, and Cactus
// publishes no npm package. There is therefore no in-process inference runtime
// available to this repository's dev host, and the default backend is `absent`
// rather than a stub that returns 0. A stub returning 0 would be a fabricated
// sentiment — the exact thing §4.1:533 forbids — expressed as a default instead
// of as a lie in a comment.

import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"

import { SENTIMENT_CODES, createSentimentReader, defaultBackendAbsenceReason } from "../sentimentModel.mjs"
import { CACT_MAGIC_HEX } from "../artifactFormat.mjs"
import { ARTIFACT_ROLES, PINNED_ARTIFACTS, manifest } from "../modelManifest.mjs"
import { evaluate as evaluateSentimentExpert } from "../../experts/sentiment.mjs"

const LOADED = PINNED_ARTIFACTS.find((a) => a.role === ARTIFACT_ROLES.loaded)

/** A verified artifact plus a manifest pinned to it, in a temp directory. */
function verifiedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "picc-t13-sent-"))
  const bytes = Buffer.concat([Buffer.from(CACT_MAGIC_HEX, "hex"), Buffer.from("weights", "latin1")])
  writeFileSync(join(dir, LOADED.fileName), bytes)
  const digest = createHash("sha256").update(bytes).digest("hex")
  const m = {
    ...manifest(),
    artifacts: PINNED_ARTIFACTS.map((a) => (a.fileName === LOADED.fileName ? { ...a, sha256: digest, bytes: bytes.length } : a))
  }
  return { dir, digest, manifest: m }
}

/** A recording stub backend. Records every call so "never called" is assertable. */
function recordingBackend(result = 0.6) {
  const calls = []
  return {
    calls,
    id: "stub:recording",
    sentimentOf(texts) {
      calls.push(texts)
      return result
    }
  }
}

describe("a verified artifact plus a backend produces the 5% expert's input", () => {
  it("returns exactly the shape T11's expert consumes", () => {
    const f = verifiedFixture()
    try {
      const reader = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend(0.6) })
      const r = reader.read({ headlines: ["ECB holds rates"] })
      expect(r.available).toBe(true)
      expect(Object.keys(r.input).sort()).toEqual(["score", "source"])
      expect(typeof r.input.score).toBe("number")
      expect(r.input.score).toBeGreaterThanOrEqual(-1)
      expect(r.input.score).toBeLessThanOrEqual(1)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("names its provenance, so the expert's leg records where the number came from", () => {
    const f = verifiedFixture()
    try {
      const backend = recordingBackend(-0.25)
      const r = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend }).read({ headlines: ["risk-off"] })
      expect(r.input.source).toContain(backend.id)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("feeds T11's expert, which accepts it and maps it onto the ±5 band", () => {
    const f = verifiedFixture()
    try {
      const r = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend(0.6) }).read({
        headlines: ["ECB holds rates"]
      })
      const expert = evaluateSentimentExpert({ sentimentInput: r.input })
      expect(expert.available).toBe(true)
      expect(expert.rawDelta).toBeCloseTo(3, 10) // 0.6 × 5
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("is deterministic for the same input and backend", () => {
    const f = verifiedFixture()
    try {
      const reader = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend(0.6) })
      const a = JSON.stringify(reader.read({ headlines: ["one", "two"] }))
      const b = JSON.stringify(reader.read({ headlines: ["one", "two"] }))
      expect(a).toBe(b)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })
})

describe("the reader returns NOTHING but a sentiment input", () => {
  it("has no indicator-shaped key anywhere in its result", () => {
    const f = verifiedFixture()
    try {
      const r = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend(0.6) }).read({
        headlines: ["x"]
      })
      const text = JSON.stringify(r).toLowerCase()
      // `score` is deliberately absent from this list: it is the NAME of the
      // sentiment input's own field (T11's contract is `{ score, source }`), not
      // a confluence score. What must not appear is any indicator or decision
      // quantity — the model computes none of them.
      for (const forbidden of ["adx", "bbw", "atr", "ema", "vwap", "stochrsi", "regime", "tier", "veto", "confluence", "contribution", "weight"]) {
        expect(text, `the reader leaked "${forbidden}"`).not.toContain(`"${forbidden}"`)
      }
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("carries no field a decision could be derived from", () => {
    const f = verifiedFixture()
    try {
      const r = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend(0.6) }).read({
        headlines: ["x"]
      })
      expect(Object.keys(r).sort()).toEqual(["available", "input", "reason"])
      expect(Object.keys(r.input).sort()).toEqual(["score", "source"])
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("refuses a backend that returns something other than a number in -1..1", () => {
    // A backend returning an ADX, a percentage, or an object is a backend that
    // is not a sentiment model, and passing its output on would put whatever it
    // returned into the 5% band. `undefined` is included and is a distinct case
    // from "no argument", which is why the backend is built per case here rather
    // than through the recording helper.
    const f = verifiedFixture()
    try {
      for (const bad of [1.5, -2, NaN, Infinity, "0.4", null, undefined, { value: 0.4 }, [0.4], true]) {
        const reader = createSentimentReader({
          modelDir: f.dir,
          manifest: f.manifest,
          backend: { id: "stub:bad", sentimentOf: () => bad }
        })
        const r = reader.read({ headlines: ["x"] })
        expect(r.available, `backend returned ${JSON.stringify(bad) ?? "undefined"}`).toBe(false)
        expect(r.input).toBeNull()
        expect(r.reason).toMatch(/finite number|outside -1\.\.1/i)
      }
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })
})

describe("the artifact is verified BEFORE the backend is called", () => {
  it("never calls the backend when the artifact is absent", () => {
    const backend = recordingBackend()
    const reader = createSentimentReader({ modelDir: join(tmpdir(), "picc-t13-absent-dir"), manifest: manifest(), backend })
    const r = reader.read({ headlines: ["x"] })
    expect(r.available).toBe(false)
    expect(backend.calls).toHaveLength(0)
  })

  it("never calls the backend when the digest does not match", () => {
    const f = verifiedFixture()
    try {
      const backend = recordingBackend()
      const tampered = { ...f.manifest, artifacts: f.manifest.artifacts.map((a) => (a.fileName === LOADED.fileName ? { ...a, sha256: "c".repeat(64) } : a)) }
      const r = createSentimentReader({ modelDir: f.dir, manifest: tampered, backend }).read({ headlines: ["x"] })
      expect(r.available).toBe(false)
      expect(backend.calls).toHaveLength(0)
      expect(r.reason).toMatch(/digest|sha/i)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("never calls the backend when the artifact is a renamed pickle", () => {
    const f = verifiedFixture()
    try {
      // A pickle whose OWN digest is pinned — the case a digest-only gate misses.
      const pickle = Buffer.concat([Buffer.from([0x80, 0x04, 0x95]), Buffer.from("evil", "latin1")])
      writeFileSync(join(f.dir, LOADED.fileName), pickle)
      const pinned = {
        ...f.manifest,
        artifacts: f.manifest.artifacts.map((a) =>
          a.fileName === LOADED.fileName ? { ...a, sha256: createHash("sha256").update(pickle).digest("hex"), bytes: pickle.length } : a
        )
      }
      const backend = recordingBackend()
      const r = createSentimentReader({ modelDir: f.dir, manifest: pinned, backend }).read({ headlines: ["x"] })
      expect(r.available).toBe(false)
      expect(backend.calls).toHaveLength(0)
      expect(r.reason).toMatch(/pickle/i)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("refuses when the manifest itself is invalid, before touching the artifact", () => {
    const backend = recordingBackend()
    const empty = mkdtempSync(join(tmpdir(), "picc-t13-badmanifest-"))
    try {
      const reader = createSentimentReader({
        modelDir: empty,
        manifest: { ...manifest(), b11: { ...manifest().b11, verdict: "MEASURED" } },
        backend
      })
      const r = reader.read({ headlines: ["x"] })
      expect(r.available).toBe(false)
      expect(backend.calls).toHaveLength(0)
      expect(r.reason).toMatch(/manifest|B11/i)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe("the layer is FULLY DISABLEABLE — T13:1316's bisect line", () => {
  it("returns the unavailable reading when disabled, and calls nothing", () => {
    const f = verifiedFixture()
    try {
      const backend = recordingBackend()
      const reader = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend, enabled: false })
      const r = reader.read({ headlines: ["x"] })
      expect(r.available).toBe(false)
      expect(r.input).toBeNull()
      expect(backend.calls).toHaveLength(0)
      expect(r.reason).toMatch(/disabled/i)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("is enabled by default only when a backend exists — never with a fabricated one", () => {
    const f = verifiedFixture()
    try {
      const withBackend = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend() })
      expect(withBackend.read({ headlines: ["x"] }).available).toBe(true)
      const without = createSentimentReader({ modelDir: f.dir, manifest: f.manifest })
      expect(without.read({ headlines: ["x"] }).available).toBe(false)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("names the missing native runtime rather than saying 'no model'", () => {
    // The honest reason is specific and actionable: the artifact is present and
    // verified, and what is missing is the runtime that can execute it.
    const f = verifiedFixture()
    try {
      const r = createSentimentReader({ modelDir: f.dir, manifest: f.manifest }).read({ headlines: ["x"] })
      expect(r.reason).toBe(defaultBackendAbsenceReason())
      expect(r.reason).toMatch(/runtime|backend/i)
      expect(r.reason).not.toMatch(/stub|placeholder|mock/i)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })

  it("produces T11's own NO_MODEL_INPUT outcome when its input is simply absent", () => {
    // The end of the chain: an absent reader means no `sentimentInput` on the
    // state, and T11's expert reports the unavailable row with its own reason.
    const expert = evaluateSentimentExpert({ sentimentInput: null })
    expect(expert.available).toBe(false)
    expect(expert.rawDelta).toBeNull()
    expect(expert.unavailableReason).toContain("T13")
  })
})

describe("it refuses malformed caller input rather than inferring over nothing", () => {
  const f = verifiedFixture()
  const backend = recordingBackend()
  const reader = createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend })

  // A caller bug is a THROW; a model that cannot answer is a READING. The same
  // distinction `marketState.mjs:17-23` draws for a malformed candle.
  const thrown = [
    ["no argument", undefined],
    ["null", null],
    ["a string", "headlines"],
    ["an array", ["headlines"]]
  ]
  for (const [label, input] of thrown) {
    it(`throws for ${label}`, () => {
      expect(() => reader.read(input)).toThrowError(expect.objectContaining({ code: SENTIMENT_CODES.noRequest }))
      expect(backend.calls).toHaveLength(0)
    })
  }

  const readings = [
    ["an empty object", {}],
    ["no headlines key", { items: ["x"] }],
    ["a non-array headlines", { headlines: "ECB holds" }],
    ["an empty headlines array", { headlines: [] }]
  ]
  for (const [label, input] of readings) {
    it(`returns an unavailable reading for ${label}`, () => {
      const r = reader.read(input)
      expect(r.available).toBe(false)
      expect(r.input).toBeNull()
      expect(r.reason).toMatch(/headline/i)
      expect(backend.calls).toHaveLength(0)
    })
  }

  it("returns an unavailable reading for a non-string headline", () => {
    const r = reader.read({ headlines: ["ok", 42] })
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/headline/i)
  })
})

describe("the reader touches only the artifact directory it is given", () => {
  it("does not read anything outside it", () => {
    // A reader that resolved paths relative to the process cwd would pick up a
    // developer's local artifact. The assertion is behavioural: a directory
    // containing no artifact yields the absent reason, not a pass.
    const empty = mkdtempSync(join(tmpdir(), "picc-t13-empty-"))
    try {
      expect(readdirSync(empty)).toEqual([])
      const r = createSentimentReader({ modelDir: empty, manifest: manifest(), backend: recordingBackend() }).read({
        headlines: ["x"]
      })
      expect(r.available).toBe(false)
      expect(r.reason).toMatch(/absent/i)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("never writes to the artifact directory", () => {
    const f = verifiedFixture()
    try {
      const before = readdirSync(f.dir).sort()
      createSentimentReader({ modelDir: f.dir, manifest: f.manifest, backend: recordingBackend() }).read({ headlines: ["x"] })
      expect(readdirSync(f.dir).sort()).toEqual(before)
    } finally {
      rmSync(f.dir, { recursive: true, force: true })
    }
  })
})
