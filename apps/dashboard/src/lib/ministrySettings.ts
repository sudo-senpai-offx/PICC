import type { SuiteId } from "@/lib/suites"

export type AutopilotMode = "auto" | "copilot"

export interface MinistrySettings {
  mode: AutopilotMode
  confidenceThreshold: number
}

const DEFAULTS: MinistrySettings = { mode: "auto", confidenceThreshold: 0.6 }

const key = (id: SuiteId) => `picc.ministry.${id}.settings`

export function getMinistrySettings(id: SuiteId): MinistrySettings {
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<MinistrySettings>
    return {
      mode: parsed.mode === "copilot" ? "copilot" : "auto",
      confidenceThreshold: clamp(parsed.confidenceThreshold ?? DEFAULTS.confidenceThreshold)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveMinistrySettings(id: SuiteId, patch: Partial<MinistrySettings>): MinistrySettings {
  const next = { ...getMinistrySettings(id), ...patch }
  next.confidenceThreshold = clamp(next.confidenceThreshold)
  try {
    localStorage.setItem(key(id), JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
  return next
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return DEFAULTS.confidenceThreshold
  return Math.min(1, Math.max(0, n))
}