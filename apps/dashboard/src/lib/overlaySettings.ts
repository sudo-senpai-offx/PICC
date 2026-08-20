/**
 * Overlay settings model — fine-grained controls for the PICC overlay
 * that appears inside the headed browser window.
 *
 * Two levels of settings:
 * - Default preset: per-suite type defaults applied to ALL sites of that suite
 * - Per-site override: saved per individual site, overrides the default preset
 */

export interface OverlayFeatures {
  /** Show real-time assistance prompts on the page */
  assistance: boolean
  /** Show buy/sell decision signals */
  decisionSupport: boolean
  /** Allow PICC to automate form fills and clicks */
  automation: boolean
  /** Enable autopilot mode (fully autonomous actions) */
  autopilot: boolean
  /** Show market analysis and interpretation */
  analysis: boolean
  /** Enable AI-powered insights and recommendations */
  ai: boolean
}

/** Per-dockable configuration — static defaults for each panel */
export interface DockableConfig {
  id: string
  title: string
  icon: string
  defaultPosition: string
  defaultSize: { width: number; height: number }
  defaultOpacity: number
  defaultCollapsed: boolean
  description: string
}

/** Persisted layout for a single dockable (position, size, opacity after user adjustments) */
export interface DockableLayout {
  position?: { x: number; y: number } | null
  size?: { width: number; height: number } | null
  opacity?: number | null
}

export interface OverlaySettings {
  /** Master toggle — when false the overlay is not injected */
  enabled: boolean
  /** Global overlay opacity 0.1–1.0 */
  opacity: number
  /** Whether the overlay body is collapsed (only header visible) */
  collapsed: boolean
  /** Per-feature toggles */
  features: OverlayFeatures
  /** Per-dockable visibility (keyed by dockable id) */
  dockables: Record<string, boolean>
  /** Persisted dockable layouts (position, size, opacity per dockable) */
  dockableLayout: Record<string, DockableLayout>
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  enabled: true,
  opacity: 0.92,
  collapsed: false,
  features: {
    assistance: true,
    decisionSupport: true,
    automation: false,
    autopilot: false,
    analysis: true,
    ai: true,
  },
  dockables: {},
  dockableLayout: {},
}

/** Default dockable presets per suite type */
export const SUITE_DOCKABLES: Record<string, DockableConfig[]> = {
  trading: [
    { id: "price-ticker", title: "Price Ticker", icon: "📈", defaultPosition: "top-right", defaultSize: { width: 280, height: 200 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Real-time asset prices with percentage change" },
    { id: "portfolio", title: "Portfolio", icon: "📊", defaultPosition: "top-left", defaultSize: { width: 300, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Paper trading balance, PnL, and win rate" },
    { id: "ai-signals", title: "AI Signals", icon: "🧠", defaultPosition: "right", defaultSize: { width: 260, height: 260 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Live confluence decisions with verdict badges" },
    { id: "risk-mgr", title: "Risk Manager", icon: "⚠️", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 140 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Daily loss limit, concurrent trades, cooldown" },
    { id: "autopilot", title: "Autopilot", icon: "🤖", defaultPosition: "bottom-left", defaultSize: { width: 260, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Start/stop autopilot, status, today PnL" },
    { id: "kelly-sizing", title: "Kelly Sizing", icon: "🎯", defaultPosition: "left", defaultSize: { width: 260, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Kelly criterion sizing with suggested positions" },
    { id: "regime-detect", title: "Regime Detection", icon: "📡", defaultPosition: "top-left", defaultSize: { width: 280, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Market regime: trending, ranging, volatile, breakout" },
    { id: "order-flow", title: "Order Flow", icon: "🌊", defaultPosition: "bottom-left", defaultSize: { width: 280, height: 200 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Cumulative delta, imbalance, and divergence signals" },
    { id: "expiry-opt", title: "Expiry Optimizer", icon: "⏱️", defaultPosition: "right", defaultSize: { width: 260, height: 200 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Optimal expiry selection with volatility analysis" },
    { id: "sentiment", title: "Sentiment", icon: "🎭", defaultPosition: "top-right", defaultSize: { width: 280, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "News + social sentiment fusion with extremes" },
  ],
  bandwidth: [
    { id: "speed", title: "Speed Monitor", icon: "📡", defaultPosition: "top-right", defaultSize: { width: 280, height: 200 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Real-time bandwidth speed tests and history" },
    { id: "connectors", title: "Connectors", icon: "🔌", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Connected services and API health" },
  ],
  affiliate: [
    { id: "tracker", title: "Affiliate Tracker", icon: "💰", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Referral links, clicks, and earnings" },
    { id: "optimizer", title: "Link Optimizer", icon: "🔗", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "A/B test results and link performance" },
  ],
  content: [
    { id: "analytics", title: "Content Analytics", icon: "📊", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Views, engagement, and revenue per post" },
    { id: "scheduler", title: "Post Scheduler", icon: "📅", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Scheduled posts queue and calendar" },
  ],
  dividend: [
    { id: "portfolio", title: "Dividend Portfolio", icon: "💎", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Dividend holdings, yield, and ex-dates" },
    { id: "calendar", title: "Ex-Date Calendar", icon: "📅", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Upcoming ex-dividend dates and amounts" },
  ],
  defi: [
    { id: "yield", title: "Yield Tracker", icon: "🌱", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "LP positions, APR, and IL tracking" },
    { id: "gas", title: "Gas Tracker", icon: "⛽", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "Gas price estimates and optimal swap timing" },
  ],
  generic: [
    { id: "general", title: "PICC Panel", icon: "🧠", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultOpacity: 0.92, defaultCollapsed: false, description: "General PICC status and controls" },
  ],
}

/** Get default settings for a suite type, with all dockables enabled by default */
export function getSuiteDefaultSettings(suiteId: string): OverlaySettings {
  const dockableConfigs = SUITE_DOCKABLES[suiteId] || SUITE_DOCKABLES.generic
  const dockables: Record<string, boolean> = {}
  for (const d of dockableConfigs) {
    dockables[d.id] = true
  }
  return {
    ...DEFAULT_OVERLAY_SETTINGS,
    dockables,
    dockableLayout: {},
  }
}

export const FEATURE_LABELS: Record<keyof OverlayFeatures, { label: string; desc: string; icon: string }> = {
  assistance: {
    label: "Assistance",
    desc: "Real-time prompts and guidance overlaid on the page",
    icon: "💡",
  },
  decisionSupport: {
    label: "Decision Support",
    desc: "Buy/sell signals, win probability, expected value",
    icon: "📊",
  },
  automation: {
    label: "Automation",
    desc: "Form fills, clicks, and safe page interactions",
    icon: "⚙️",
  },
  autopilot: {
    label: "Autopilot",
    desc: "Fully autonomous trading and income actions",
    icon: "🤖",
  },
  analysis: {
    label: "Analysis",
    desc: "Market analysis, trend interpretation, and reporting",
    icon: "🔍",
  },
  ai: {
    label: "AI Insights",
    desc: "AI-powered recommendations and predictions",
    icon: "🧠",
  },
}
