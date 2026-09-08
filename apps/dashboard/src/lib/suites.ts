export type SuiteId = "trading" | "earnings" | "intelligence"
export type SuiteStatus = "production" | "under-development"

export interface SuiteMeta {
  id: string
  label: string
  icon: string
  blurb: string
  status: SuiteStatus
}

/** Client display metadata for every ministry id. Server owns feature/overlay flags. */
export const SUITE_META: Record<string, SuiteMeta> = {
  trading: {
    id: "trading",
    label: "Trading",
    icon: "📈",
    blurb: "Market execution, venues, models and P&L. Paper/demo until the go-live gate passes.",
    status: "production"
  },
  earnings: {
    id: "earnings",
    label: "Earnings",
    icon: "💰",
    blurb: "The broad income ministry: cashback, micro-task, UX, referral, affiliate, royalty, yield and agent-income.",
    status: "under-development"
  },
  intelligence: {
    id: "intelligence",
    label: "Intelligence for PICC",
    icon: "🧭",
    blurb: "Prime-minister suite: the governor, decision support, and zero-to-one guidance toward profitability.",
    status: "under-development"
  }
}

/** Resolve display metadata for a ministry id (falls back to null). */
export function suiteMeta(id?: string | null): SuiteMeta | null {
  if (id && Object.hasOwn(SUITE_META, id)) return SUITE_META[id]
  return null
}