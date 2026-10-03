import { getToken } from "./auth"

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

/**
 * The room reads the CONFIGURATION surface, so this is a GATED call.
 *
 * WHY. `GET /api/integrations` and `GET /api/integrations/<ministry>` are
 * declared-public catalog reads and stay public, but the rows they serve are a
 * PROJECTION: they carry no `state`, no `configEvidence`, and no
 * `unconfiguredReason` (it is present and null), because all three are derived
 * from `process.env` and together say which credentials this deployment holds.
 * The authenticated sibling `/api/integrations/configuration` serves the same
 * catalog with them, and the Settings room needs them — `state` is the
 * "Configured / Unconfigured" badge, `configEvidence` is the "configured by …" line
 * under it, and `unconfiguredReason` is the named absence below a missing one.
 *
 * So the bearer header is not optional decoration here: without it this call is
 * refused and the room renders an empty table. That is a visible degradation
 * rather than a silent one, and it is the same shape as every other gated read in
 * this client.
 */
export async function fetchIntegrations(ministry?: string): Promise<IntegrationEntry[]> {
  const url = ministry
    ? `/api/integrations/configuration?ministry=${encodeURIComponent(ministry)}`
    : "/api/integrations/configuration"
  const token = getToken()
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : (data.entries ?? [])
}