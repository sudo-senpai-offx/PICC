/**
 * Overlay settings model — fine-grained controls for the PICC overlay
 * that appears inside the headed browser window.
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

export interface OverlaySettings {
  /** Master toggle — when false the overlay is not injected */
  enabled: boolean
  /** Position in pixels from the bottom-left corner of the viewport */
  position: { x: number; y: number }
  /** Size in pixels */
  size: { width: number; height: number }
  /** Opacity 0.1–1.0 */
  opacity: number
  /** Whether the overlay body is collapsed (only header visible) */
  collapsed: boolean
  /** Per-feature toggles */
  features: OverlayFeatures
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
