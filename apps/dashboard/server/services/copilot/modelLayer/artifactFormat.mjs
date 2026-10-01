// WS-7 T13 — D15 / R10.1 / R10.2. Content-based model artifact format detection.
//
// D15:220-227 — "Every downloaded model MUST be SHA-256 verified against a
// pinned expected digest and loaded via **safetensors or `.cact` only**.
// Pickle-family formats (`.bin`, `.pt`, `.pkl`) are forbidden. [...] Format
// detection must cover renamed files, not just extensions."
//
// WHY A POSITIVE ALLOWLIST WITH A DENY-BY-DEFAULT FALLTHROUGH. D15 says two
// things that pull against each other if implemented naively:
//
//   1. only safetensors/.cact may load  -> needs a positive test
//   2. detection must cover renamed files -> needs a negative test
//
// A detector built only from rule 2 ("is this a pickle? then refuse") passes a
// renamed-pickle test while accepting any format nobody thought of. A detector
// built only from rule 1 ("is this safetensors? then allow") is a real content
// test and needs no filename at all. So this module recognises the two allowed
// formats from their bytes, refuses everything else, and separately CLASSIFIES a
// refused artifact as `pickle` versus `unknown` purely so the operator is told
// what to do about it. The classification never grants permission.
//
// The `.cact` signature below was read from the real published artifact
// (`Cactus-Compute/needle3`, `needle3.cact`, 35,335,380 bytes, sha256
// `c9d915ec...8170c38`) and its provenance is recorded as OBSERVED, not
// DOCUMENTED — see `modelManifest.mjs`. A magic number read off one file is
// evidence of a prefix, not a specification, and this comment says so rather
// than letting the constant look like a published format spec.
//
// PURE. No clock, no filesystem, no network. It takes a Buffer and answers.

/**
 * The two formats D15 permits. The order is the spec's own (":220-227",
 * ":1310"), and a test pins it to exactly these two so a third cannot be added
 * without a deliberate edit.
 */
export const ALLOWED_FORMATS = Object.freeze(["safetensors", "cact"])

/**
 * The `.cact` container prefix, as OBSERVED on the real artifact.
 *
 * Provenance: OBSERVED, not DOCUMENTED. Cactus publishes no format
 * specification for `.cact` in the model repository; these four bytes are what
 * the published file begins with. The manifest records the same marker, and
 * because the digest pin is checked independently, a file that merely *starts*
 * with these bytes still cannot pass the gate.
 */
export const CACT_MAGIC_HEX = "842ae105"

/** Named refusal codes, so a caller branches on a code and not on a message. */
export const FORBIDDEN_FORMAT_CODES = Object.freeze({
  pickle: "model-format:forbidden-pickle",
  unknown: "model-format:forbidden-unknown"
})

/**
 * Member names that make a ZIP a pickle-family artifact. `torch.save` writes a
 * ZIP archive whose payload is `archive/data.pkl` (torch >= 1.6) or `data.pkl`,
 * and the loader `exec`s that member. The archive as a whole is therefore
 * pickle-family, which is why a torch checkpoint renamed to `model.safetensors`
 * must be refused — and why "it is a ZIP, and ZIPs are safe" is the exact wrong
 * conclusion.
 */
const PICKLE_MEMBER_SUFFIXES = Object.freeze([".pkl", ".pickle", ".pt", ".pth", ".bin", ".pt2", ".ckpt"])

/** Torch's pickle opcodes / markers, for the non-ZIP text and binary cases. */
const PICKLE_MARKERS = Object.freeze([
  "__reduce__",
  "__builtin__",
  "copyreg",
  "_reconstructor",
  "torch._utils",
  "c__builtin__"
])

/** ZIP local-file-header and central-directory signatures. */
const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_EOCD = 0x06054b50

/**
 * A cap on a plausible safetensors JSON header. 100 MiB is far above any real
 * one (Needle 3's is 8,248 bytes) and far below the 2 GB ceiling D14 sets, so a
 * corrupt length field cannot make the detector read a whole artifact as JSON.
 */
const MAX_SAFETENSORS_HEADER_BYTES = 100 * 1024 * 1024

/**
 * Identify an artifact from its bytes.
 *
 * @param {Buffer|Uint8Array} bytes The artifact's actual content.
 * @returns {{format: string, allowed: boolean, signature: object, reason: string|null}}
 *   `format` is `"safetensors"`, `"cact"`, `"pickle"` or `"unknown"`. `allowed`
 *   is true ONLY for the first two. `reason` is non-null exactly when
 *   `allowed` is false.
 */
export function detectArtifactFormat(bytes) {
  const buf = toBuffer(bytes)

  if (buf === null || buf.length === 0) {
    return refuse("unknown", "the artifact is empty", FORBIDDEN_FORMAT_CODES.unknown)
  }

  // --- .cact: a fixed four-byte container prefix, checked first because it is
  //     an O(1) test and a file that is both would be malformed anyway. ---
  if (buf.length >= 4 && buf.subarray(0, 4).toString("hex") === CACT_MAGIC_HEX) {
    return {
      format: "cact",
      allowed: true,
      signature: {
        magicHex: CACT_MAGIC_HEX,
        provenance: "observed-on-published-artifact",
        bytes: buf.length
      },
      reason: null
    }
  }

  // --- safetensors: u64 LE header length, then that many bytes of JSON object.
  //     Read from the real file: first 8 bytes `38 20 00 00 00 00 00 00` =
  //     8,248, followed by `{"__metadata__": {...}`. ---
  if (buf.length >= 8) {
    const declared = readU64LE(buf, 0)
    if (declared !== null && declared >= 2 && declared <= MAX_SAFETENSORS_HEADER_BYTES) {
      const available = buf.length - 8
      if (BigInt(available) >= declared) {
        const headerText = buf.subarray(8, 8 + Number(declared)).toString("utf8")
        if (looksLikeSafetensorsJson(headerText)) {
          return {
            format: "safetensors",
            allowed: true,
            signature: { headerBytes: Number(declared), totalBytes: buf.length },
            reason: null
          }
        }
        // The length field is plausible and the bytes are present, but the JSON
        // is not an object. That is a CORRUPT or lying artifact, and it is more
        // useful to say so than to call it "unknown".
        return refuse(
          "unknown",
          `the first 8 bytes declare a ${declared}-byte JSON header and that many bytes are present, but the header does not parse as a JSON object — a corrupt or hand-crafted safetensors file`,
          FORBIDDEN_FORMAT_CODES.unknown
        )
      }
      // Declared length exceeds the file. A truncated download.
      return refuse(
        "unknown",
        `the first 8 bytes declare a ${declared}-byte JSON header but only ${available} bytes follow — a truncated download`,
        FORBIDDEN_FORMAT_CODES.unknown
      )
    }
  }

  // --- pickle family, in each of the shapes it actually takes. ---
  const pickle = classifyPickle(buf)
  if (pickle !== null) return refuse("pickle", pickle.reason, FORBIDDEN_FORMAT_CODES.pickle, pickle.signature)

  return refuse(
    "unknown",
    "the content matches neither a safetensors container nor a .cact container, and carries no pickle marker",
    FORBIDDEN_FORMAT_CODES.unknown
  )
}

/** Is this a format D15 permits? Convenience for a boolean call site. */
export function isAllowedFormat(bytes) {
  return detectArtifactFormat(bytes).allowed
}

/**
 * Assert that an artifact may be loaded, or throw a named refusal.
 *
 * `fileName` is used ONLY for the message. It is deliberately not an input to
 * the decision — a test calls this with a `.pkl` name and `.cact` bytes and
 * expects success, and with `.safetensors` name and pickle bytes and expects
 * the pickle refusal.
 *
 * @param {Buffer|Uint8Array} bytes
 * @param {string} fileName For the error message only.
 * @returns {ReturnType<typeof detectArtifactFormat>} The detection, on success.
 * @throws {Error} with `.code` set from `FORBIDDEN_FORMAT_CODES`.
 */
export function assertLoadableFormat(bytes, fileName) {
  const found = detectArtifactFormat(bytes)
  if (found.allowed) return found
  const err = new Error(
    `model-digest-gate: refusing to load "${fileName}" — ${found.reason}. ` +
      `D15 (spec :220-227) permits safetensors and .cact only, and refuses the pickle family ` +
      `(.bin/.pt/.pkl) renamed or not, because pickle deserialisation executes arbitrary code at load time.`
  )
  err.code = found.allowed ? undefined : foundFormatCode(found.format)
  err.format = found.format
  err.fileName = fileName
  throw err
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return null
}

function refuse(format, reason, code, signature = {}) {
  return { format, allowed: false, signature, reason, code }
}

function foundFormatCode(format) {
  return format === "pickle" ? FORBIDDEN_FORMAT_CODES.pickle : FORBIDDEN_FORMAT_CODES.unknown
}

/** u64 little-endian as a BigInt, or null if the field exceeds 2^53. */
function readU64LE(buf, offset) {
  const value = buf.readBigUInt64LE(offset)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : null
}

/** The header must be a JSON OBJECT whose first non-space byte is `{`. */
function looksLikeSafetensorsJson(text) {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith("{")) return false
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Recognise the three shapes a pickle-family artifact takes on disk, or return
 * null. Order matters only for the reason given, not for the verdict — all
 * three routes end in the same refusal.
 */
function classifyPickle(buf) {
  // 1. Binary pickle: PROTO opcode `\x80` followed by a protocol byte 0..5.
  //    Protocol 2+ is what every modern `pickle` and every `torch.save` writes.
  if (buf.length >= 2 && buf[0] === 0x80 && buf[1] <= 0x05) {
    return {
      reason: `the content begins with the pickle PROTO opcode for protocol ${buf[1]} (bytes 0x80 0x${buf[1].toString(16).padStart(2, "0")})`,
      signature: { opcode: "PROTO", protocol: buf[1] }
    }
  }

  // 2. A ZIP container. Walk the local file headers and read the member NAMES
  //    only — the payload is never deserialised, which is the entire point.
  if (readU32LE(buf, 0) === ZIP_LOCAL_HEADER) {
    const members = zipMemberNames(buf)
    const offending = members.find((name) =>
      PICKLE_MEMBER_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))
    )
    if (offending !== undefined) {
      return {
        reason: `the content is a ZIP archive carrying the pickle-family member "${offending}" — a torch.save checkpoint is a ZIP, and its loader execs that member`,
        signature: { container: "zip", member: offending, memberCount: members.length }
      }
    }
    return {
      reason: "the content is a ZIP archive, which is neither a safetensors nor a .cact container (a torch.save checkpoint is a ZIP, and this one carries no recognisable pickle member)",
      signature: { container: "zip", member: null, memberCount: members.length }
    }
  }

  // 3. Text-mode pickle: a `GLOBAL`/`REDUCE` opcode stream, or one of the
  //    well-known dunder markers. Kept last so a binary pickle is reported by
  //    its opcode rather than by a substring.
  const head = buf.subarray(0, 4096).toString("latin1")
  const marker = PICKLE_MARKERS.find((candidate) => head.includes(candidate))
  if (marker !== undefined) {
    return {
      reason: `the content carries the pickle marker "${marker}"`,
      signature: { marker }
    }
  }

  return null
}

/**
 * Member names from a ZIP's local file headers.
 *
 * Bounded on purpose: a hostile archive can declare 4 GiB sizes, and this walks
 * a fixed number of headers over a bounded prefix. It is a NAME SCAN, not a
 * parser — it never allocates a member and never touches its bytes, so a zip
 * bomb costs this function nothing.
 */
function zipMemberNames(buf, maxHeaders = 64, maxScanBytes = 1 << 20) {
  const names = []
  const limit = Math.min(buf.length, maxScanBytes)
  let offset = 0
  while (offset + 30 <= limit && names.length < maxHeaders) {
    if (readU32LE(buf, offset) !== ZIP_LOCAL_HEADER) break
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const compressedSize = buf.readUInt32LE(offset + 18)
    const nameStart = offset + 30
    if (nameStart + nameLen > limit) break
    names.push(buf.subarray(nameStart, nameStart + nameLen).toString("latin1"))
    // The next header begins at the next 512-byte boundary after the payload.
    const advance = 30 + nameLen + extraLen + compressedSize
    offset += 512 * Math.ceil(advance / 512)
  }
  return names
}

function readU32LE(buf, offset) {
  if (offset + 4 > buf.length) return -1
  return buf.readUInt32LE(offset)
}
