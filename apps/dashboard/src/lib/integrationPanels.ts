// Pure display models for the T5 integration panels (spread + aggregate).
// Extracted so honesty rules are unit-testable without a React DOM harness:
//   - an unmeasured spread renders "n/a", NEVER a fabricated 0 edge;
//   - an empty portfolio renders "no open positions", never a fake zero entry;
//   - the risk check mirrors the server's allowed/warnings verdict verbatim.

import type { AccountMetricsResult, AggregateResult, SpreadResult, SystemCapabilitiesResult } from "./trading"

export type SpreadDisplay =
  | {
      state: "unmeasured"
      quoteCount: number
      note: string
      edgePct: null
      opportunity: false
    }
  | {
      state: "measured"
      quoteCount: number
      quotes: { venue: string; price: number }[]
      edgePct: number
      opportunity: boolean
      best: { buyVenue: string; sellVenue: string; buyPrice: number; sellPrice: number; grossPct: number }
      note: string
    }

export function spreadPanelModel(res: SpreadResult): SpreadDisplay {
  const quoteCount = res.venuesPolled.length
  if (quoteCount < 2 || !res.best) {
    return { state: "unmeasured", quoteCount, note: res.note, edgePct: null, opportunity: false }
  }
  return {
    state: "measured",
    quoteCount,
    quotes: res.venuesPolled.map((q) => ({ venue: q.venue, price: q.price })),
    edgePct: res.best.netPct,
    opportunity: res.best.opportunity,
    best: {
      buyVenue: res.best.buyVenue,
      sellVenue: res.best.sellVenue,
      buyPrice: res.best.buyPrice,
      sellPrice: res.best.sellPrice,
      grossPct: res.best.grossPct
    },
    note: res.note
  }
}

export interface AggregateDisplay {
  totals: { openPositions: number; notional: number; instruments: number }
  todayPnl: { pnl: number; trades: number } | null
  riskCheck: {
    allowed: boolean
    warnings: string[]
    proposedSymbol: string | null
    afterNotional: number | null
  } | null
}

export function aggregatePanelModel(res: AggregateResult): AggregateDisplay {
  return {
    totals: res.totals,
    // todayPnl.total is a real observed ledger aggregation — when nothing
    // traded today it is genuinely 0 trades / 0 pnl, which is honest.
    todayPnl: res.todayPnl?.total ?? null,
    riskCheck: res.riskCheck
      ? {
          allowed: res.riskCheck.allowed,
          warnings: res.riskCheck.warnings,
          proposedSymbol: res.riskCheck.proposed?.symbol ?? null,
          afterNotional: res.riskCheck.after?.totalNotional ?? null
        }
      : null
  }
}

// ---------------------------------------------------------------------
// T6 — account metrics + capabilities display models
// ---------------------------------------------------------------------

export interface MetricsVenueDisplay {
  venueId: string
  balance: number | null
  currency: string
  active: "demo" | "real" | null
  stale: boolean
  observedAt: string | null
}

export interface MetricsDisplay {
  venues: MetricsVenueDisplay[]
  observedVenueCount: number
}

export function metricsPanelModel(res: AccountMetricsResult): MetricsDisplay {
  const venues = Object.entries(res.venues ?? {}).map(([vid, rec]) => ({
    venueId: vid,
    // Strict honesty: a genuine observed 0 stays 0, an unobserved balance is
    // null — the UI renders one as 0.00 and the other as "—".
    balance: typeof rec?.balance === "number" ? rec.balance : null,
    currency: rec?.currency ?? "USD",
    active: rec?.active ?? null,
    stale: Boolean(rec?.stale),
    observedAt: rec?.observedAt ?? null
  }))
  return { venues, observedVenueCount: venues.length }
}

export interface CapabilitiesDisplay {
  browserFound: boolean
  sensorSeen: boolean
  sensorLastSeen: number | null
  notifierChannels: { inApp: boolean; webpush: boolean }
  signalEngine: boolean
  uptimeSec: number
  node: string
  platform: string
  arch: string
}

export function capabilitiesPanelModel(res: SystemCapabilitiesResult): CapabilitiesDisplay | null {
  if (!res?.ok) return null
  return {
    browserFound: Boolean(res.browserFound),
    sensorSeen: Boolean(res.extensionSensor?.seen),
    sensorLastSeen: res.extensionSensor?.lastSeen ?? null,
    notifierChannels: res.notifierChannels ?? { inApp: true, webpush: false },
    signalEngine: Boolean(res.signalEngine),
    uptimeSec: Number(res.uptime) || 0,
    node: res.node ?? "unknown",
    platform: res.platform ?? "unknown",
    arch: res.arch ?? "unknown"
  }
}