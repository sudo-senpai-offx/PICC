const CONTRACT_MEMBERS = Object.freeze([
  ["id", "string"],
  ["label", "string"],
  ["markets", "function"],
  ["submitOrder", "function"],
  ["verifyFill", "function"],
  ["observeEquity", "function"],
  ["positionView", "function"],
  ["observeFunding", "function"],
  ["riskModel", "object"]
])

const RISK_MODEL_FIELDS = Object.freeze({
  leverageBandMin: "number",
  leverageBandMax: "number",
  marginPerPositionCapUsd: "number",
  maxOpenPositions: "number",
  fundingStaleMs: "number",
  isolatedOnly: "boolean",
  testnetOnly: "boolean"
})

const registry = new Map()

export function validateVenueAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    return { ok: false, errors: [{ code: "adapter-not-object", message: "venue adapter must be an object" }] }
  }
  const errors = []
  for (const [member, kind] of CONTRACT_MEMBERS) {
    const value = adapter[member]
    if (value == null) {
      errors.push({ code: "missing-member", message: `venue adapter missing member "${member}"` })
      continue
    }
    if (kind === "function" && typeof value !== "function") {
      errors.push({ code: "invalid-member", message: `venue adapter member "${member}" must be a function` })
    } else if (kind === "object") {
      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push({ code: "invalid-member", message: `venue adapter member "${member}" must be an object` })
      } else if (member === "riskModel") {
        for (const [field, fieldKind] of Object.entries(RISK_MODEL_FIELDS)) {
          const fieldValue = value[field]
          if (fieldValue == null) {
            errors.push({ code: "missing-member", message: `venue adapter riskModel missing field "${field}"` })
            continue
          }
          if (fieldKind === "number" && (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))) {
            errors.push({ code: "invalid-member", message: `venue adapter riskModel field "${field}" must be a finite number` })
          } else if (fieldKind === "boolean" && typeof fieldValue !== "boolean") {
            errors.push({ code: "invalid-member", message: `venue adapter riskModel field "${field}" must be a boolean` })
          }
        }
      }
    } else if (kind === "string" && (typeof value !== "string" || value.trim() === "")) {
      errors.push({ code: "invalid-member", message: `venue adapter member "${member}" must be a non-empty string` })
    }
  }
  return { ok: errors.length === 0, errors }
}

export function registerVenueAdapter(adapter) {
  const { ok, errors } = validateVenueAdapter(adapter)
  if (!ok) {
    throw new Error(`venue adapter contract not satisfied — ${errors.map((e) => e.message).join("; ")}`)
  }
  const id = String(adapter.id).trim()
  if (registry.has(id)) {
    throw new Error(`venue adapter already registered for id "${id}"`)
  }
  registry.set(id, adapter)
}

export function venueAdapterFor(id) {
  const key = String(id ?? "").trim()
  return registry.get(key) ?? null
}

export function venueAdapterIds() {
  return [...registry.keys()].sort()
}