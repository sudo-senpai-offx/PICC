// PICC venue credentials — at-rest vault-backed store for trading-venue
// config: the configured CCXT exchange pairs used by the cross-venue spread
// route and the order rail.
//
// This is the trading-scoped successor of the removed bandwidth automator
// credential store: the file was migrated to a trading-only shape
// (venue-credentials.json, token fields for bandwidth providers dropped at
// migration time), and the vault keeps the at-rest encryption rule intact.
//
// D2/AC-005: the `expertoptionToken` field is REMOVED with the venue. T2 deleted
// `captureExpertOptionSession`, the only writer, so nothing has set it since; a
// credentials file written before that change may still carry the key on disk
// and it is simply no longer read, defaulted or written back, so a stale key is
// inert rather than resurrected. It is NOT migrated out of existing files —
// silently rewriting a user's credential store is not this task's authority.
// This mirrors the treatment `trading.mjs` already gives the same three fields
// in its own `DEFAULT_CREDS`.
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readSecretJson, writeSecretJson } from "./vault.mjs"

const DATA_DIR = process.env.PICC_AUTOMATOR_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const CREDS_FILE = join(DATA_DIR, "venue-credentials.json")

/**
 * Read the trading venue config. Missing/unreadable file → empty config
 * (never a fake token): the spread route then simply quotes whatever venues
 * are actually configured.
 */
export async function getCredentials() {
  const saved = await readSecretJson(CREDS_FILE, {})
  return {
    ccxtExchanges: Array.isArray(saved?.ccxtExchanges) ? saved.ccxtExchanges.slice(0, 20) : []
  }
}

/**
 * Persist trading venue config. ccxtExchanges is replaced wholesale when provided.
 */
export async function saveCredentials(patch) {
  const current = await getCredentials()
  const exchanges = Array.isArray(patch?.ccxtExchanges)
    ? patch.ccxtExchanges.slice(0, 20)
    : current.ccxtExchanges
  const next = { ccxtExchanges: exchanges }
  await writeSecretJson(CREDS_FILE, next)
  return next
}