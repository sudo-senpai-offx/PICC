// PICC scheduler job: yield-refresh (extracted Wave 2.1 — body moved verbatim
// from services/scheduler.mjs; intervals, gates and wording unchanged).
//
// Every 30 min (stagger 20s): warms the DeFi/staking cache (harmless when the
// cache is already warm — single-flight).
import { yieldSnapshot } from "../yields.mjs"

export const name = "yield-refresh"
export const intervalMs = 30 * 60 * 1000
export const staggerMs = 20_000

export async function run() {
  await yieldSnapshot()
}
