// Deep-link venue opening (REQ-9 / T6, Decision G seam).
//
// Two honest rules:
//   • NEVER open a raw string straight from a query param. The `venue` param
//     is a venueId and is only ever resolved through the venue catalog to a
//     verified tradeUrl (https, from a known venue row).
//   • The extension's `open-broker-tab` action is attempted first (page →
//     content bridge, Decision G). A new tab is only opened as a fallback when
//     the extension does not answer (no extension installed) or declines.
import type { TradingVenue } from "@/lib/trading"

/** Only an https tradeUrl that genuinely exists on a catalog venue is openable. */
export function validateVenueTradeUrl(venueId: string, venues: TradingVenue[]): string | null {
  const venue = (venues ?? []).find((v) => v.id === venueId)
  if (!venue) return null
  const tradeUrl = venue.tradeUrl
  if (typeof tradeUrl !== "string") return null
  return /^https:\/\//i.test(tradeUrl) ? tradeUrl : null
}

export interface OpenBrokerResult {
  /** A command was posted to the page↔content bridge. */
  attempt: boolean
  /** The extension did not confirm handling, so a new tab was opened. */
  fellBack: boolean
}

/** How long the bridge may stay silent before the new-tab fallback fires. */
const DEFAULT_WAIT_MS = 700

/**
 * Attempt `open-broker-tab` through the page↔content bridge: post the
 * shape-validated command marker (`__piccCommand`), wait briefly for a
 * `__piccCommandAck`; on a positive ack do nothing further, on a timeout or a
 * declined ack open the verified tradeUrl in a new tab (`noopener`). This is
 * the whole action — opening a venue tab — nothing is ever auto-executed.
 */
export function openBrokerTab(opts: { venueId: string; url: string; waitMs?: number }): Promise<OpenBrokerResult> {
  const { venueId, url, waitMs = DEFAULT_WAIT_MS } = opts
  if (!/^https:\/\//i.test(url)) return Promise.resolve({ attempt: false, fellBack: false })
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (fellBack: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      resolve({ attempt: true, fellBack })
    }
    const openFallback = () => {
      window.open(url, "_blank", "noopener")
      finish(true)
    }
    const onMessage = (ev: MessageEvent) => {
      const ack = ev.data?.__piccCommandAck
      if (!ack || ack.venueId !== venueId) return
      if (ack.ok === true) finish(false)
      else openFallback() // extension answered but could not focus/create its tab
    }
    window.addEventListener("message", onMessage)
    timer = setTimeout(openFallback, waitMs)
    window.postMessage({ __piccCommand: { action: "open-broker-tab", venueId, url } }, "*")
  })
}