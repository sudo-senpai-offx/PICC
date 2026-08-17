export type FeatureKey = "simulator" | "agents" | "opportunities" | "overlay" | "content" | "income" | "trading" | "browser"

export interface FeatureDef {
  label: string
  desc: string
}

export const FEATURES: Record<FeatureKey, FeatureDef> = {
  simulator: { label: "Financial Twin", desc: "Monte Carlo projections with live market data (Yahoo)." },
  agents: { label: "Agents", desc: "Live CrewAI research, content, and listing crews (free Groq)." },
  opportunities: { label: "Opportunities", desc: "2026 income-classification research — verified automation backlog, workflows, bounty boards." },
  overlay: { label: "Overlay & Listing Optimizer", desc: "Browser-extension suggestions and listing analysis." },
  content: { label: "Content Studio", desc: "Blog, YouTube, affiliate, and social drafts." },
  income: { label: "Income Channels", desc: "Payment links for BTCPay and TNG eWallet." },
  trading: { label: "Trading Suite", desc: "Multi-model prediction, read-only ExpertOption bridge, and paper trading." },
  browser: { label: "Browser Studio", desc: "Integrated browser for all income sources — PICC can overlay, cast, and control it." }
}

const DEFAULTS: Record<FeatureKey, boolean> = {
  simulator: true,
  agents: true,
  opportunities: true,
  overlay: true,
  content: true,
  income: true,
  trading: true,
  browser: true
}

const STORAGE_KEY = "picc.features"

export function getFeatureFlags(): Record<FeatureKey, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<FeatureKey, boolean>>) : {}
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function isFeatureOn(key: FeatureKey): boolean {
  return getFeatureFlags()[key]
}

export function setFeatureFlag(key: FeatureKey, value: boolean): Record<FeatureKey, boolean> {
  const flags = getFeatureFlags()
  flags[key] = value
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags))
  } catch {
    /* storage unavailable */
  }
  return flags
}
