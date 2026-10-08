// PICC scheduler job: news-digest (extracted Wave 2.1 — body moved verbatim
// from services/scheduler.mjs; intervals, gates and wording unchanged).
//
// Phase 6b (spec PICC_PACK1_LOCAL_TRADING_CORE_v1.md, S3/T3.1) — P1-3 news
// digest RUN leg: fetch the configured free RSS/Atom feeds (owner decision
// 2026-09-13: Serper REPLACED by free sources via the global PICC webfetch
// capability) on the 10min envelope cadence. No credentials, no keys, no
// paid APIs. Envelope caps ride inside runDigest (per-source ≤6 fetches /
// 10min, B5-strict) and the global webfetch fair-use limiter. Honesty floor:
// an empty PICC_NEWS_FEEDS config runs NOTHING and stores NOTHING — the p1-3
// observation above then reports skipped-unconfigured (never a fabricated
// pass); a gate/rate-limit/parse failure records the observed kind per source,
// and only ONE bounded summary row is persisted per pass (storeDigestRun
// prunes to 200 rows / 30 days). Summary synthesis stays OFF unless the
// operator sets PICC_NEWS_DIGEST_SYNTHESIS=on (governor-routed async chatText;
// digestSynthesis has no caller in this job — grep verified).
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "news-digest"
export const intervalMs = 600 * 1000
export const staggerMs = 90_000

export async function run() {
  const { newsFeedsConfig, runDigest, storeDigestRun, digestBudgetFromEnv } = await import("../newsDigest.mjs")
  const feeds = newsFeedsConfig()
  if (feeds.length === 0) {
    log.info("news digest pass skipped — no feeds configured (honest skip)")
    return
  }
  const outcome = await runDigest({ feeds, budget: digestBudgetFromEnv() })
  const row = await storeDigestRun(outcome)
  log.info("news digest pass", { feeds: row.feeds, ok: row.fetchedOk, gated: row.gated, rateLimited: row.rateLimited, items: row.items })
}
