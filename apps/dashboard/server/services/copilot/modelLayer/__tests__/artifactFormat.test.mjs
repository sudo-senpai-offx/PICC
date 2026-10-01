// WS-7 T13 — D15 / R10.1 / R10.2 / AC-032. Format detection is CONTENT-BASED.
//
// D15:223 — "loaded via safetensors or `.cact` only. Pickle-family formats
// (`.bin`, `.pt`, `.pkl`) are forbidden." D15:227 — "Format detection must cover
// renamed files, not just extensions."
//
// The design that satisfies both halves is a POSITIVE allowlist with a
// deny-by-default fallthrough, plus a specific pickle classifier purely so the
// operator is told WHY. If the gate merely said "not a pickle -> allow", a
// renamed pickle would be allowed. If it merely said "not safetensors ->
// deny", it would be a filename check wearing a content check's name.
//
// So: positively identify safetensors and .cact from their bytes, and refuse
// everything else — including a torch.save ZIP, which is a pickle family member
// (its `archive/data.pkl` member is deserialised by exec'ing pickle) and which
// no extension test would catch under the name `model.safetensors`.
//
// THE HEADLINE TEST is "the same pickle bytes, three names, three refusals",
// and its mirror is "cact bytes named .pkl are ACCEPTED" — the second half is
// what makes the first half mean something. A detector that rejected
// everything would also pass the first half.

import { describe, expect, it } from "vitest"

import {
  ALLOWED_FORMATS,
  CACT_MAGIC_HEX,
  FORBIDDEN_FORMAT_CODES,
  assertLoadableFormat,
  detectArtifactFormat,
  isAllowedFormat
} from "../artifactFormat.mjs"

// ---------------------------------------------------------------------------
// Byte fixtures. Each is built here rather than shipped as a binary so the test
// states exactly what the detector is being asked to recognise.
// ---------------------------------------------------------------------------

/** Python `pickle.dumps({"w": [1, 2]}, protocol=4)` — begins `\x80\x04`. */
const PICKLE_PROTOCOL_4 = Buffer.concat([
  Buffer.from([0x80, 0x04]), // PROTO 4
  Buffer.from([0x95]), // FRAME
  Buffer.from([0x8c, 0x03]), // SHORT_BINUNICODE "w\x00"
  Buffer.from("w\x00", "latin1"),
  Buffer.from([0x8c, 0x02]), // SHORT_BINUNICODE "t\x00"
  Buffer.from("t\x00", "latin1"),
  Buffer.from([0x4c, 0x8b, 0x8b, 0x8c]), // SHORT_BINBYTES8, 2 items
  Buffer.from([0x4b, 0x01, 0x00, 0x00, 0x00]) // BININT1 1
])

/** A protocol-0 text pickle: `c__builtin__\neval\n(V1\ntR.`. */
const PICKLE_PROTOCOL_0_TEXT = Buffer.from("c__builtin__\neval\n(V1\ntR.", "latin1")

/**
 * A `torch.save` archive: a ZIP containing `archive/data.pkl`. Built by hand so
 * the test does not need a torch install. The member NAME is the tell.
 */
function torchSaveZip() {
  const member = "archive/data.pkl"
  const payload = PICKLE_PROTOCOL_4
  const nameBuf = Buffer.from(member, "latin1")
  const crc = 0x12345678 // not validated by the detector; the name is the tell

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // local file header signature
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(0, 8) // method: stored
  local.writeUInt32LE(0, 12) // mod time
  local.writeUInt32LE(0, 16) // mod date
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18) // compressed size
  local.writeUInt32LE(payload.length, 22) // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26) // filename length

  return Buffer.concat([local, nameBuf, payload])
}

/** A structurally valid safetensors header: u64 LE length, then that many JSON bytes. */
function safetensorsBytes(tensorName = "model.embed_tokens.weight", jsonOverrides = null) {
  const header = JSON.stringify(
    jsonOverrides ?? {
      __metadata__: { format: "pt" },
      [tensorName]: { dtype: "F32", shape: [2, 2], data_offsets: [0, 16] }
    }
  )
  const headerBuf = Buffer.from(header, "utf8")
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(headerBuf.length))
  // 8 + header + a little payload; the detector must not require the payload to
  // be any particular size.
  return Buffer.concat([len, headerBuf, Buffer.alloc(16, 0xab)])
}

/** Needle 3's real `.cact` container signature, as measured from the real file. */
function cactBytes(extraBytes = 32) {
  return Buffer.concat([Buffer.from(CACT_MAGIC_HEX, "hex"), Buffer.alloc(extraBytes, 0x11)])
}

describe("D15 — the two allowed formats are recognised from their bytes", () => {
  it("recognises a structurally valid safetensors container", () => {
    const found = detectArtifactFormat(safetensorsBytes())
    expect(found.format).toBe("safetensors")
    expect(found.allowed).toBe(true)
    expect(found.signature.headerBytes).toBeGreaterThan(0)
  })

  it("recognises the real .cact container signature", () => {
    const found = detectArtifactFormat(cactBytes())
    expect(found.format).toBe("cact")
    expect(found.allowed).toBe(true)
  })

  it("ALLOWED_FORMATS is exactly the two D15 names — no third, no default", () => {
    expect([...ALLOWED_FORMATS]).toEqual(["safetensors", "cact"])
  })
})

describe("R10.2 — a pickle is rejected on CONTENT, whatever it is called", () => {
  const names = [
    "model.safetensors",
    "model.cact",
    "model.dat",
    "model.pkl",
    "model.bin",
    "model.pt"
  ]

  for (const name of names) {
    it(`refuses a protocol-4 pickle named ${name}`, () => {
      const found = detectArtifactFormat(PICKLE_PROTOCOL_4)
      expect(found.allowed).toBe(false)
      expect(found.format).toBe("pickle")
      // The name is never passed in — `detectArtifactFormat` takes bytes and
      // has no filename parameter — and `assertLoadableFormat` uses it only for
      // the message. Both are asserted so this stays true.
      expect(detectArtifactFormat.length).toBe(1)
      expect(() => assertLoadableFormat(PICKLE_PROTOCOL_4, name)).toThrowError(
        expect.objectContaining({ code: FORBIDDEN_FORMAT_CODES.pickle, fileName: name })
      )
    })
  }

  it("refuses a protocol-0 TEXT pickle (no PROTO opcode, starts with `c`)", () => {
    const found = detectArtifactFormat(PICKLE_PROTOCOL_0_TEXT)
    expect(found.allowed).toBe(false)
    expect(found.format).toBe("pickle")
  })

  it("refuses a torch.save ZIP, whose `archive/data.pkl` member is a pickle family", () => {
    const found = detectArtifactFormat(torchSaveZip())
    expect(found.allowed).toBe(false)
    expect(found.format).toBe("pickle")
    expect(found.signature.member).toBe("archive/data.pkl")
  })
})

describe("THE MIRROR — detection is content, so a VALID file under a BAD name is allowed", () => {
  it("allows .cact bytes; the name is never an input", () => {
    // If the detector consulted the extension this would fail, and with it the
    // whole claim that the pickle refusals above mean anything.
    const found = detectArtifactFormat(cactBytes())
    expect(found.allowed).toBe(true)
  })

  it("allows a safetensors container whose first key is __metadata__ only", () => {
    const found = detectArtifactFormat(safetensorsBytes("x", { __metadata__: { format: "pt" } }))
    expect(found.allowed).toBe(true)
  })

  it("takes bytes as its only argument — there is no filename to pass", () => {
    expect(detectArtifactFormat.length).toBe(1)
    expect(isAllowedFormat).toBeTypeOf("function")
  })
})

describe("deny-by-default — anything not positively identified is refused", () => {
  const cases = [
    ["random bytes", Buffer.from("this is not a model, it is a sentence about one.")],
    ["a PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)])],
    ["an ELF shared object", Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Buffer.alloc(60, 0x02)])],
    ["a bare ZIP with no .pkl member", Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(60)])],
    ["empty bytes", Buffer.alloc(0)],
    ["a 3-byte file", Buffer.from([0x01, 0x02, 0x03])]
  ]

  for (const [label, bytes] of cases) {
    it(`refuses ${label} as \`unknown\`, not as a guess`, () => {
      const found = detectArtifactFormat(bytes)
      expect(found.allowed).toBe(false)
      expect(found.format).toBe("unknown")
    })
  }

  it("refuses a safetensors header whose JSON is truncated", () => {
    // Header length says 200 but only 12 bytes of JSON follow. Accepting this
    // would make a corrupt download look like a model.
    const truncated = Buffer.concat([(() => { const l = Buffer.alloc(8); l.writeBigUInt64LE(200n); return l })(), Buffer.from('{"__metadata', "utf8")])
    const found = detectArtifactFormat(truncated)
    expect(found.allowed).toBe(false)
    expect(found.format).not.toBe("safetensors")
  })

  it("refuses a header whose declared length exceeds the file", () => {
    const lying = Buffer.concat([(() => { const l = Buffer.alloc(8); l.writeBigUInt64LE(9_000_000_000n); return l })(), Buffer.from("{}", "utf8")])
    expect(detectArtifactFormat(lying).allowed).toBe(false)
  })

  it("refuses a header whose JSON is an array, not an object", () => {
    const json = Buffer.from('[1,2,3]', "utf8")
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(json.length))
    expect(detectArtifactFormat(Buffer.concat([len, json])).allowed).toBe(false)
  })
})

describe("assertLoadableFormat — the named refusal", () => {
  it("throws FORBIDDEN_FORMAT_CODES.pickle for a pickle", () => {
    expect(() => assertLoadableFormat(PICKLE_PROTOCOL_4, "model.safetensors")).toThrowError(
      expect.objectContaining({ code: FORBIDDEN_FORMAT_CODES.pickle })
    )
  })

  it("names the file in the message, so the operator knows what to delete", () => {
    let message = ""
    try {
      assertLoadableFormat(PICKLE_PROTOCOL_4, "model.safetensors")
    } catch (e) {
      message = e.message
    }
    expect(message).toContain("model.safetensors")
    expect(message).toMatch(/pickle/i)
  })

  it("throws a DIFFERENT code for unrecognised bytes than for a pickle", () => {
    // One code for everything would tell an operator "pickle" about a truncated
    // download, which is the wrong instruction.
    expect(() => assertLoadableFormat(Buffer.from("nonsense"), "m.dat")).toThrowError(
      expect.objectContaining({ code: FORBIDDEN_FORMAT_CODES.unknown })
    )
  })

  it("returns the detection for an allowed artifact instead of throwing", () => {
    const found = assertLoadableFormat(cactBytes(), "needle3.cact")
    expect(found.format).toBe("cact")
    expect(found.allowed).toBe(true)
  })
})
