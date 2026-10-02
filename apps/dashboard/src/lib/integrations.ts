export interface IntegrationEntry {
  id: string
  ministry: string
  name: string
  url: string
  purpose: string
  boundary: { freeTier: string; rateLimit: string; keyRequired: boolean }
  state: "unconfigured" | "connected" | "degraded"
  /**
   * WS-7 T18 / D17. Present on the news/sentiment rows, absent on the older
   * market-data rows. `retrievalMode` is one of the four modes D17:241 permits
   * (licensed API / licensed feed / licensed websocket / PICC's own browser), and
   * `licensedBasis` says why this source is trusted. They are OPTIONAL rather
   * than required because the room renders the rows that predate D17 too, and a
   * required field would mean inventing a mode for Twelve Data — which is
   * precisely the kind of unearned licence claim D17 exists to stop.
   */
  retrievalMode?: "licensed-api" | "licensed-feed" | "licensed-websocket" | "picc-own-browser"
  licensedBasis?: string
  /** The named reason this source is absent. Null when it is configured. */
  unconfiguredReason?: string | null
  /** What configured it — the env var names. Null when nothing did. */
  configEvidence?: string | null
}

export async function fetchIntegrations(ministry?: string): Promise<IntegrationEntry[]> {
  const url = ministry ? `/api/integrations/${ministry}` : "/api/integrations"
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : (data.entries ?? [])
}