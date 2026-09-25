/**
 * WS-6 T1 — sample-key contract.
 *
 * D8 is a hard lock: sample bucket identity is the five-part
 * (setup, market, timeframe, dataFidelity, regimeClass) tuple, and samples are
 * NEVER aggregated across keys. `dataFidelity` and `regimeClass` are part of
 * the identity precisely because a bar-only reading and an L2 reading are
 * different hypotheses, and because session routing makes a London-trend bar
 * and a Tokyo-reversion bar different hypotheses.
 *
 * The id encoding is length-prefixed rather than a plain join, because a plain
 * join collides: setup="a::b", market="c" and setup="a", market="b::c" both
 * produce "a::b::c". That collision was caught by the T1 test suite while this
 * module was still a stub.
 *
 * Pure and dependency-free by design (bisect matrix: "Contracts and manifest
 * are pure; they must not mount a room or change server behavior").
 */

export const SAMPLE_KEY_PARTS = [
  "setup",
  "market",
  "timeframe",
  "dataFidelity",
  "regimeClass"
] as const

export type SampleKeyPart = (typeof SAMPLE_KEY_PARTS)[number]

export type SampleKey = Record<SampleKeyPart, string>

/**
 * Builds a validated key. Every part is required and must be a non-empty
 * string — there is no default, because a defaulted part silently merges two
 * different hypotheses into one bucket.
 */
export function makeSampleKey(input: SampleKey): SampleKey {
  const out = {} as SampleKey
  for (const part of SAMPLE_KEY_PARTS) {
    const value = input[part]
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`sampleKey.${part} must be a non-empty string`)
    }
    out[part] = value
  }
  return out
}

/**
 * Collision-free, deterministic, human-readable id. Each part is length-prefixed
 * so no combination of part contents can imitate a different key.
 */
export function sampleKeyId(key: SampleKey): string {
  return SAMPLE_KEY_PARTS.map((part) => {
    const value = key[part]
    return `${value.length}:${value}`
  }).join("|")
}

export function sameSampleKey(a: SampleKey, b: SampleKey): boolean {
  return SAMPLE_KEY_PARTS.every((part) => a[part] === b[part])
}

/**
 * The D8 aggregation gate. True only for a structurally identical key; any
 * differing part — including dataFidelity and regimeClass — returns false.
 */
export function canAggregate(a: SampleKey, b: SampleKey): boolean {
  return sameSampleKey(a, b)
}

/** Groups resolved samples by key id without ever merging across keys. */
export function groupBySampleKey<T extends { key: SampleKey }>(samples: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const sample of samples) {
    const id = sampleKeyId(sample.key)
    const bucket = groups.get(id)
    if (bucket) bucket.push(sample)
    else groups.set(id, [sample])
  }
  return groups
}
