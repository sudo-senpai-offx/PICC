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

/** Per-dockable configuration */
export interface DockableConfig {
  id: string
  title: string
  icon: string
  defaultPosition: string
  defaultSize: { width: number; height: number }
  defaultCollapsed: boolean
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
  /** Position in pixels from the top-left corner of the viewport */
  position: { x: number; y: number }
  /** Size in pixels */
  size: { width: number; height: number }
  /** Opacity 0.1–1.0 */
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
  position: { x: 16, y: 16 },
  size: { width: 340, height: 400 },
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
    { id: "price-ticker", title: "Price Ticker", icon: "📈", defaultPosition: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
    { id: "portfolio", title: "Portfolio", icon: "📊", defaultPosition: "top-left", defaultSize: { width: 300, height: 180 }, defaultCollapsed: true },
    { id: "ai-signals", title: "AI Signals", icon: "🧠", defaultPosition: "right", defaultSize: { width: 260, height: 260 }, defaultCollapsed: true },
    { id: "risk-mgr", title: "Risk Manager", icon: "⚠️", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 140 }, defaultCollapsed: true },
    { id: "autopilot", title: "Autopilot", icon: "🤖", defaultPosition: "bottom-left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: false },
    { id: "kelly-sizing", title: "Kelly Sizing", icon: "🎯", defaultPosition: "left", defaultSize: { width: 260, height: 180 }, defaultCollapsed: true },
    { id: "regime-detect", title: "Regime Detection", icon: "📡", defaultPosition: "top-left", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
    { id: "order-flow", title: "Order Flow", icon: "🌊", defaultPosition: "bottom-left", defaultSize: { width: 280, height: 200 }, defaultCollapsed: true },
    { id: "expiry-opt", title: "Expiry Optimizer", icon: "⏱️", defaultPosition: "right", defaultSize: { width: 260, height: 200 }, defaultCollapsed: true },
    { id: "sentiment", title: "Sentiment", icon: "🎭", defaultPosition: "top-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
  ],
  bandwidth: [
    { id: "speed", title: "Speed Monitor", icon: "📡", defaultPosition: "top-right", defaultSize: { width: 280, height: 200 }, defaultCollapsed: false },
    { id: "connectors", title: "Connectors", icon: "🔌", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
  ],
  affiliate: [
    { id: "tracker", title: "Affiliate Tracker", icon: "💰", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
    { id: "optimizer", title: "Link Optimizer", icon: "🔗", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
  ],
  content: [
    { id: "analytics", title: "Content Analytics", icon: "📊", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
    { id: "scheduler", title: "Post Scheduler", icon: "📅", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
  ],
  dividend: [
    { id: "portfolio", title: "Dividend Portfolio", icon: "💎", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
    { id: "calendar", title: "Ex-Date Calendar", icon: "📅", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 180 }, defaultCollapsed: true },
  ],
  defi: [
    { id: "yield", title: "Yield Tracker", icon: "🌱", defaultPosition: "top-right", defaultSize: { width: 300, height: 220 }, defaultCollapsed: false },
    { id: "gas", title: "Gas Tracker", icon: "⛽", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultCollapsed: true },
  ],
  generic: [
    { id: "general", title: "PICC Panel", icon: "🧠", defaultPosition: "bottom-right", defaultSize: { width: 280, height: 160 }, defaultCollapsed: false },
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
