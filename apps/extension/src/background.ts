export interface PiccSettings {
  enabled: boolean
  platforms: { amazon: boolean; youtube: boolean; brokerage: boolean }
  auto_suggest: boolean
  tier0_autospin: boolean
  backendUrl?: string
}

export const DEFAULT_SETTINGS: PiccSettings = {
  enabled: true,
  platforms: { amazon: true, youtube: true, brokerage: true },
  auto_suggest: true,
  tier0_autospin: true,
  backendUrl: "http://localhost:5173"
}

const STORAGE_KEY = "piccSettings"

export async function getSettings(): Promise<PiccSettings> {
  const { [STORAGE_KEY]: stored } = await chrome.storage.sync.get(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
}

export async function setSettings(settings: PiccSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings })
}

function platformOf(url: string): keyof PiccSettings["platforms"] | null {
  const host = new URL(url).hostname
  if (host.includes("amazon")) return "amazon"
  if (host.includes("youtube")) return "youtube"
  if (host.includes("fidelity") || host.includes("schwab") || host.includes("etrade")) {
    return "brokerage"
  }
  return null
}

interface LocalSuggestion {
  id: string
  title: string
  body: string
  confidence: number
}

function localSuggestions(platform: string, pageTitle: string): LocalSuggestion[] {
  if (platform === "amazon") {
    return [
      {
        id: "amz-title",
        title: "Optimize listing title",
        body: `Based on "${pageTitle}", front-load the top search keyword and move brand/colour to the middle to lift CTR.`,
        confidence: 0.7
      },
      {
        id: "amz-bullets",
        title: "Lead with a benefit bullet",
        body: "Reorder bullets so the first states the #1 customer benefit, not a spec. Keep each under 200 characters.",
        confidence: 0.64
      }
    ]
  }
  if (platform === "youtube") {
    return [
      {
        id: "yt-title",
        title: "Stronger title pattern",
        body: `Titles that start with a concrete outcome or number outperform. Try a variant of: "${pageTitle}" → outcome-first phrasing.`,
        confidence: 0.66
      },
      {
        id: "yt-tags",
        title: "Expand tag coverage",
        body: "Add 3-5 long-tail tags from the passive income niche plus a competitor channel name (tag) to broaden discovery.",
        confidence: 0.58
      }
    ]
  }
  return [
    {
      id: "brk-screenshot",
      title: "Re-balance check",
      body: "Page detected as a brokerage. Compare current holdings against a 60/30/10 equity/bond/cash target; rebalance only if drift exceeds 5%.",
      confidence: 0.62
    },
    {
      id: "brk-dca",
      title: "Dollar-cost averaging",
      body: "Historical data suggests regular contributions beat lump-sum timing. Set an auto-invest schedule at your own brokerage.",
      confidence: 0.6
    }
  ]
}

async function remoteSuggestions(settings: PiccSettings, platform: string, pageTitle: string, pageData?: unknown) {
  const url = `${settings.backendUrl?.replace(/\/+$/, "")}/api/extension/suggest`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, pageTitle, pageData })
  })
  if (!res.ok) throw new Error(`suggest endpoint failed: ${res.status}`)
  const data = (await res.json()) as { suggestions: LocalSuggestion[] }
  return data.suggestions
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "PICC_GET_SUGGESTIONS") {
    void (async () => {
      try {
        const settings = await getSettings()
        if (!settings.enabled) {
          sendResponse({ suggestions: [], source: "disabled" })
          return
        }
        const platform = platformOf(msg.url)
        if (!platform || !settings.platforms[platform]) {
          sendResponse({ suggestions: [], source: "unsupported" })
          return
        }
        try {
          const suggestions = await remoteSuggestions(settings, platform, msg.pageTitle, msg.pageData)
          sendResponse({ suggestions, source: "remote" })
        } catch {
          sendResponse({ suggestions: localSuggestions(platform, msg.pageTitle), source: "local" })
        }
      } catch (err) {
        sendResponse({ suggestions: [], source: "error", error: String(err) })
      }
    })()
    return true
  }
  return undefined
})

// ---------------------------------------------------------------------------
// Keep-alive presence — the extension reports itself online to the PICC
// server every 30 minutes so Tier 0 dashboards show it as active. No stealth,
// just a polite heartbeat from software the user owns.
// ---------------------------------------------------------------------------
const PRESENCE_ALARM = "PICC_PRESENCE"

async function pingPresence() {
  try {
    const settings = await getSettings()
    if (!settings.enabled) return
    const base = settings.backendUrl?.replace(/\/+$/, "")
    if (!base) return
    await fetch(`${base}/api/automator/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "extension" })
    })
  } catch {
    /* server offline — retry on next alarm */
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.alarms.create(PRESENCE_ALARM, { periodInMinutes: 30 })
  } catch {
    /* alarms unavailable (e.g. some MV2 hosts) — content script still pings */
  }
})

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === PRESENCE_ALARM) void pingPresence()
})

export {};
