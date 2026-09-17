// Deep-link venue opening (REQ-9 / T6, Decision G seam).
//
// Two honest rules:
//   • NEVER open a raw string straight from a query param. The `venue` param
//     is a venueId and is only ever resolved through the venue catalog to a
//     verified tradeUrl (https, from a known venue row).
//   • When the Browser Studio context exists, use the studioTab RPC
//     (action "open" = find-or-create the URL tab). A new tab in the
//     default browser is only opened as a fallback when the studio is
//     unavailable (window-open fallback).
import { browserTab } from "@/lib/api"
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
  /** The studio RPC was attempted (open via the managed browser or fallback). */
  attempt: boolean
  /** Studio was unavailable — fell back to a plain window.open in the default browser. */
  fellBack: boolean
}

/**
 * Open a venue tradeUrl: prefer the Browser Studio managed-browser (find-or-create
 * a tab for the URL), fall back to window.open in the user's default browser when
 * the studio is not running (D2).
 */
export async function openBrokerTab(opts: { venueId: string; url: string }): Promise<OpenBrokerResult> {
  const { url } = opts
  if (!/^https:\/\//i.test(url)) return { attempt: false, fellBack: false }
  try {
    await browserTab({ action: "open", url })
    return { attempt: true, fellBack: false }
  } catch {
    // Studio closed / not running — plain new-tab fallback in the default browser.
    window.open(url, "_blank", "noopener")
    return { attempt: true, fellBack: true }
  }
}
