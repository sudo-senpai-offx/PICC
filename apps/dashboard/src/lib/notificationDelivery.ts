// WS-7 T14 - how a delivery state is PRESENTED, and the one rule the
// presentation must not break.
//
// The four states and their meanings are owned by the SERVER
// (`server/services/notifications/states.mjs`). This file does not restate what
// they mean and does not carry a second list of them: `DELIVERY_PRESENTATION`
// is a map from the server's own state strings to a label and a tone, and
// `notifications.delivery.test.ts` asserts its key set EQUALS the server's
// `DELIVERY_STATES`. A state added on the server without a presentation entry
// fails that test, so the two cannot drift apart unnoticed.
//
// The rule: `describeDelivery` may only say a message arrived when the
// SERVER said at least one transport acknowledged. The client does not get to
// infer a delivery from a 200 response, from a non-empty request, or from the
// absence of an error - which is what the previous "Test dispatched - check
// bell/push." did, unconditionally, before the server had been asked anything
// about whether anything arrived (D11 spec :191, AC-037 spec :1064).

/** Mirrors the server's DeliveryOutcome. `reason` is null for delivered/off. */
export type DeliveryOutcome = {
  state: string
  reason: string | null
  attempted: number
  acknowledged: number
}

/** The server's `summariseDeliveries` output, as it arrives over the wire. */
export type DeliverySummary = {
  readoutObtained: boolean
  delivered: Array<{ transport: string; acknowledged: number }>
  unavailable: Array<{ transport: string; reason: string }>
  failed: Array<{ transport: string; reason: string; attempted: number }>
  off: string[]
  deliveredAny: boolean
}

type Tone = "accent" | "success" | "warn" | "danger" | "muted"

/**
 * Label and tone per state. `unavailable` is MUTED rather than `warn` on
 * purpose: nothing is broken, there is simply nothing to send with, and a
 * warning badge on a deliberate configuration state trains operators to ignore
 * the badge that matters. `failed` is the one that gets `danger`.
 */
export const DELIVERY_PRESENTATION: Record<string, { label: string; tone: Tone }> = {
  delivered: { label: "delivered", tone: "success" },
  failed: { label: "failed", tone: "danger" },
  unavailable: { label: "unavailable", tone: "muted" },
  off: { label: "off", tone: "muted" }
}

/** Unknown states render as an explicit unknown, never as a success. */
export function deliveryPresentation(state: string): { label: string; tone: Tone } {
  return DELIVERY_PRESENTATION[state] ?? { label: `unrecognised: ${state}`, tone: "danger" }
}

/**
 * The sentence for a whole dispatch.
 *
 * `null` in, `null` out: a readout that was not obtained has no summary, and
 * the caller must render "could not reach the dispatcher" rather than pass a
 * missing value into a formatter that would print `null` or `undefined`. That
 * separation is T10's `readoutObtained` discipline, and it is why this takes
 * `DeliverySummary | null` rather than a summary with optional fields.
 *
 * The non-delivery facts are appended on EVERY branch, including a successful
 * one, for the same reason the server's `describeSummary` does it: the in-app
 * bell succeeds on essentially every dispatch, so reporting only the successes
 * would hide a refused Telegram or a broken push service almost every time.
 */export function describeDelivery(summary: DeliverySummary | null | undefined): string {
  if (!summary || summary.readoutObtained !== true) {
    return "Notification readout unavailable - PICC could not reach the dispatcher."
  }
  const missed: string[] = [
    ...summary.failed.map((f) => `${f.transport}: ${f.reason}`),
    ...summary.unavailable.map((u) => `${u.transport}: ${u.reason}`),
    ...summary.off.map((o) => `${o}: turned off by the operator`)
  ]

  let head: string
  if (summary.deliveredAny) {
    const names = summary.delivered.map((d) => d.transport).join(", ")
    head = summary.delivered.length === 1
      ? `Delivered on ${names} (${summary.delivered[0].acknowledged} acknowledged).`
      : `Delivered on ${summary.delivered.length} transports: ${names}.`
  } else if (summary.failed.length > 0) {
    head = "Not delivered."
  } else if (summary.unavailable.length > 0) {
    head = "Not delivered - no transport was configured or had a recipient."
  } else if (summary.off.length > 0) {
    head = "Not delivered - every notification transport is turned off."
  } else {
    head = "Not delivered - the dispatcher reported no transports."
  }

  return missed.length === 0 ? head : `${head} Not delivered on: ${missed.join("; ")}.`
}

/** One row per transport, in the server's bucket order, for a table. */
export function deliveryRows(
  results: Record<string, DeliveryOutcome> | null | undefined
): Array<{ transport: string; state: string; reason: string | null; label: string; tone: Tone }> {
  const entries = Object.entries(results ?? {})
  return entries
    .map(([transport, o]) => ({
      transport,
      state: o?.state ?? "unrecognised",
      reason: o?.reason ?? null,
      label: deliveryPresentation(o?.state ?? "unrecognised").label,
      tone: deliveryPresentation(o?.state ?? "unrecognised").tone
    }))
    .sort((a, b) => a.transport.localeCompare(b.transport))
}
