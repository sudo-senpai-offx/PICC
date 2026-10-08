// PICC scheduler job: eo-liveness (extracted Wave 2.1 — body moved verbatim
// from services/scheduler.mjs; intervals, gates and wording unchanged).
//
// Every 30s (stagger 5s): re-checks the live browser session behind the token
// + samples the 24h uptime ring. D2/AC-005 removed the EO stream, so this no
// longer ages a market-data transport; it samples browser session liveness
// and uptime only.
//
// The uptime-ring state lives HERE (not in the registry): sessionUptime24h()
// reads it, the run body writes it. scheduler.mjs re-exports
// sessionUptime24h for its existing importers (autopilot.mjs, trading.mjs).
import { getBrokerStats } from "../brokers/index.mjs"
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "eo-liveness"
export const intervalMs = 30 * 1000
export const staggerMs = 5_000

const UPTIME_RING_CAP = 2880 // 24h at 30s samples
const uptimeRing = []

export function sessionUptime24h() {
  const n = uptimeRing.length
  if (!n) return { samples: 0, connectedPct: null, livePct: null, windowHours: 0 }
  const connected = uptimeRing.filter((s) => s.connected).length
  const live = uptimeRing.filter((s) => s.live).length
  const spanMs = Date.now() - Number(uptimeRing[0]?.ts || Date.now())
  return {
    samples: n,
    connectedPct: Math.round((connected / n) * 1000) / 10,
    livePct: Math.round((live / n) * 1000) / 10,
    windowHours: Math.round((spanMs / 3_600_000) * 10) / 10
  }
}

export async function run() {
  try {
    const { getSessionLive, refreshSessionLiveCache } = await import("../autopilot.mjs")
    const verdict = await getSessionLive()
    refreshSessionLiveCache(verdict)
    const st = getBrokerStats() ?? {}
    uptimeRing.push({ ts: Date.now(), connected: st.status === "connected", live: Boolean(verdict.live) })
    if (uptimeRing.length > UPTIME_RING_CAP) uptimeRing.splice(0, uptimeRing.length - UPTIME_RING_CAP)
    // Transition warnings — silent degradation is the enemy.
    const prev = uptimeRing[uptimeRing.length - 2]
    if (prev && prev.live !== Boolean(verdict.live)) {
      import("../notificationCenter.mjs")
        .then((m) => m.emitEvent(verdict.live ? "session.live-restored" : "session.lost", { reason: verdict.reason, via: verdict.via }))
        .catch(() => {})
    }
  } catch (err) {
    log.warn("liveness check failed", { error: String(err?.message ?? err) })
  }
}
