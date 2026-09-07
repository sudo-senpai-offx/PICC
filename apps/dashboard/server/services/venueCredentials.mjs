// PICC venue credentials — at-rest vault-backed store for trading-venue
// config: the ExpertOption session token and the configured CCXT exchange
// pairs used by the cross-venue spread route and the order rail.
//
// This is the trading-scoped successor of the removed bandwidth automator
// credential store: the file was migrated to a trading-only shape
// (venue-credentials.json, token fields for bandwidth providers dropped at
// migration time), and the vault keeps the at-rest encryption rule intact.
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
    expertoptionToken: String(saved?.expertoptionToken ?? ""),
    ccxtExchanges: Array.isArray(saved?.ccxtExchanges) ? saved.ccxtExchanges.slice(0, 20) : []
  }
}

/**
 * Persist trading venue config. Blank/absent expertoptionToken keeps the
 * saved value (the UI never sends masked secrets back); an explicit null
 * clears it. ccxtExchanges is replaced wholesale when provided.
 */
export async function saveCredentials(patch) {
  const current = await getCredentials()
  const token =
    typeof patch?.expertoptionToken === "string"
      ? patch.expertoptionToken.trim()
      : patch?.expertoptionToken === null
        ? ""
        : current.expertoptionToken
  const exchanges = Array.isArray(patch?.ccxtExchanges)
    ? patch.ccxtExchanges.slice(0, 20)
    : current.ccxtExchanges
  const next = { expertoptionToken: token, ccxtExchanges: exchanges }
  await writeSecretJson(CREDS_FILE, next)
  return next
}