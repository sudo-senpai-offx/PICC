// Alert condition display (T9) — pure formatting for legacy single-condition
// alerts and the new multi-condition compose (AND/OR). Kept free of React so
// the label logic is unit-testable without component infra.

export interface AlertConditionLike {
  condition: string
  value: number
  band: string[] | null
}

export interface ComposedAlertLike {
  condition: string
  value: number
  conditions: AlertConditionLike[] | null
  logic: "AND" | "OR" | null
}

/** Human label for one condition (legacy or composed entry). */
export function conditionLabel(c: AlertConditionLike): string {
  switch (c.condition) {
    case "price_above":
      return `price > ${c.value}`
    case "price_below":
      return `price < ${c.value}`
    case "price_crossing_up":
      return `crosses above ${c.value}`
    case "price_crossing_down":
      return `crosses below ${c.value}`
    case "pct_change_up":
      return `+${c.value}% move`
    case "pct_change_down":
      return `-${c.value}% move`
    case "convergence_above": {
      const parts: string[] = []
      if (Array.isArray(c.band) && c.band.length) parts.push(`state ${c.band.join(" or ")}`)
      // The engine fires on score OR band; show both when both configured.
      parts.push(`convergence \u2265 ${c.value}`)
      return parts.join(" / ")
    }
    default:
      return `${c.condition} ${c.value}`
  }
}

/**
 * One display string for an alert's firing rule. Returns null for legacy
 * single-condition alerts (the headline condition/value already renders).
 */
export function describeAlertConditions(a: ComposedAlertLike): string | null {
  if (!Array.isArray(a.conditions) || a.conditions.length === 0) return null
  const parts = a.conditions.map(conditionLabel)
  const logic = a.logic === "OR" ? " OR " : " AND "
  return parts.join(logic)
}