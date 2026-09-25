import type { Availability } from "../domain/availability"

/**
 * WS-6 T7 — command palette command contract.
 *
 * The load-bearing rule is that a palette command can never BYPASS the server's
 * consent/risk rails. That is enforced here in two ways:
 *  1. A command is offered only when its capability is actually available. An
 *     unknown capability FAILS CLOSED, so a missing entry means "not permitted"
 *     rather than "allowed".
 *  2. Every command carries the server rails it requires. A command is never
 *     self-authorizing: invoking it still goes through the server, and the
 *     rails are carried as data so a UI can refuse to present a control whose
 *     rails it cannot satisfy.
 *
 * NO `cmdk` DEPENDENCY: per spec 4.5 `cmdk` is REJECT and per §4.8 it must stay
 * absent. This is a plain, dependency-free command list.
 *
 * An unavailable capability yields a command that is PRESENT BUT DISABLED rather
 * than silently removed, so the operator can see that the action exists and why
 * it cannot run. Hiding it would make the refusal invisible (AC-007).
 */
export type CommandAction = "paper" | "live" | "read" | "reserved"

export type CommandSpec = {
  id: string
  label: string
  action: CommandAction
  /** Server-side rails this command requires. Never empty for a write action. */
  rails: string[]
}

export type Command = {
  id: string
  label: string
  action: CommandAction
  rails: string[]
  disabled: boolean
  reason: string | null
}

function reasonFor(availability: Availability | undefined): string | null {
  if (availability == null) return "capability not registered — failing closed"
  switch (availability.status) {
    case "live":
      return null
    case "stale":
      return `data is stale: ${availability.reason}`
    case "unavailable":
      return `${availability.reason} (owner ${availability.owner})`
    case "reserved":
      return `reserved for ${availability.workstream}: ${availability.reason}`
  }
}

export function buildCommands(
  specs: readonly CommandSpec[],
  capabilities: Partial<Record<CommandAction, Availability>>
): Command[] {
  return specs.map((spec) => {
    const availability = capabilities[spec.action]
    const reason = reasonFor(availability)
    return {
      ...spec,
      // A capability that is not `live` cannot be invoked. Absent => disabled.
      disabled: reason != null,
      reason
    }
  })
}

/**
 * Case-insensitive label search. Disabled commands remain in the result so the
 * refusal stays visible instead of the action appearing not to exist.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return [...commands]
  return commands.filter((c) => c.label.toLowerCase().includes(q))
}
