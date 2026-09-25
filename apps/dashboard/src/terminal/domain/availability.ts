/**
 * WS-6 T1 — availability contract.
 *
 * The governing rule (PICC Constitution; spec §4.3; the order-flow P0 at
 * `ddc4c91`): an unobservable value is `unavailable` with a named reason and an
 * owning workstream. It is NEVER a zero, a candle approximation, or a silent
 * default. `unavailable` deliberately exposes no numeric field at all, so a
 * consumer cannot read a fabricated `0` out of it.
 *
 * Pure and dependency-free by design (bisect matrix: "Contracts and manifest
 * are pure; they must not mount a room or change server behavior").
 */

export type Availability =
  | { status: "live"; source: string; observedAt: number; freshnessMs: number }
  | { status: "stale"; source: string; observedAt: number; reason: string }
  | { status: "unavailable"; reason: string; owner: string; since: number }
  | { status: "reserved"; workstream: string; reason: string }

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`availability.${field} must be a non-empty string`)
  }
  return value
}

function requireFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`availability.${field} must be a finite number`)
  }
  return value
}

export function live(input: { source: string; observedAt: number; freshnessMs: number }): Availability {
  return {
    status: "live",
    source: requireText(input.source, "source"),
    observedAt: requireFinite(input.observedAt, "observedAt"),
    freshnessMs: requireFinite(input.freshnessMs, "freshnessMs")
  }
}

export function stale(input: { source: string; observedAt: number; reason: string }): Availability {
  return {
    status: "stale",
    source: requireText(input.source, "source"),
    observedAt: requireFinite(input.observedAt, "observedAt"),
    reason: requireText(input.reason, "reason")
  }
}

export function unavailable(input: { reason: string; owner: string; since: number }): Availability {
  return {
    status: "unavailable",
    reason: requireText(input.reason, "reason"),
    owner: requireText(input.owner, "owner"),
    since: requireFinite(input.since, "since")
  }
}

export function reserved(input: { workstream: string; reason: string }): Availability {
  return {
    status: "reserved",
    workstream: requireText(input.workstream, "workstream"),
    reason: requireText(input.reason, "reason")
  }
}

/** Only a live reading may drive a decision. Stale data is visible, not actionable. */
export function isUsable(a: Availability): boolean {
  return a.status === "live"
}

/** Only a live reading carries a value that may be displayed as current. */
export function hasValue(a: Availability): boolean {
  return a.status === "live"
}

/** Stable one-line description for logs and reserved-state UI. Never fabricates a value. */
export function describeAvailability(a: Availability): string {
  switch (a.status) {
    case "live":
      return `live from ${a.source} (freshness ${a.freshnessMs}ms)`
    case "stale":
      return `stale from ${a.source}: ${a.reason}`
    case "unavailable":
      return `unavailable (owner ${a.owner}): ${a.reason}`
    case "reserved":
      return `reserved for ${a.workstream}: ${a.reason}`
  }
}
