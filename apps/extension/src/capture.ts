// PICC extension capture — the client-side data-collection layer.
//
// Reads the user's OWN logged-in ExpertOption session (no credential
// custody — the page is already authenticated in this browser) and forwards
// broker-shaped frames to the dashboard's /api/extension/ingest, which feeds
// the SAME candle/account buffers as any other broker.
//
// Hard rules:
//   • COLLECTOR ONLY — never builds an order, expiry, or trade intent.
//   • Honest — a frame is only built when its anchors are actually readable.
//     No zero-filled or fabricated observations.
//   • Throttled + deduped — identical prices are not re-sent.

import { extractActiveAssetLabel, extractBalance, extractLivePrice, type DocLike } from "./selectors/expertoption"

/** Normalize the page's instrument label to a buffer key ("EUR/USD" → "EURUSD"). */
export function assetKeyFromLabel(label: string): string {
  const key = label.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  return key || "EURUSD"
}

/**
 * Profile frame from the wallet header. Null when balance is not readable.
 * EO gateway contract: `{ action: "profile", message: { balance, ... } }`.
 */
export function buildEOProfileFrame(doc: DocLike): { action: string; message: Record<string, unknown> } | null {
  const { amount, currency } = extractBalance(doc)
  if (amount == null) return null
  return {
    action: "profile",
    message: {
      balance: amount,
      currency: currency ?? "USD",
      is_demo: 1 // the extension session is the user's demo dashboard tab
    }
  }
}

/**
 * Live tick frame from the chart header. Null unless BOTH the active asset
 * label AND a price blob are readable — the two anchors together are what
 * make "price visible" honest.
 * EO gateway contract: `{ action: "candles", message: { assetId, candles: [{tf:0, v:[price]}] } }`.
 */
export function buildEOTickFrame(doc: DocLike): { action: string; message: Record<string, unknown> } | null {
  const label = extractActiveAssetLabel(doc)
  if (!label) return null
  const price = extractLivePrice(doc)
  if (price == null) return null
  return {
    action: "candles",
    message: {
      assetId: assetKeyFromLabel(label),
      name: label,
      candles: [{ tf: 0, v: [price] }]
    }
  }
}

export interface CaptureResult {
  captured: number
  reason?: string
}

export interface CaptureOptions {
  onFrame?: (frame: Record<string, unknown>) => void
}

/**
 * Read the EO page once and forward every readable frame. Frames are emitted
 * to `onFrame` (injectable for tests) INSTEAD of fetching directly so the
 * module stays pure and testable; the caller supplies the transport.
 * Returns what was captured or why nothing was.
 */
export function captureExpertOptionPage(doc: DocLike, { onFrame }: CaptureOptions = {}): CaptureResult {
  const frames: Record<string, unknown>[] = []
  const profile = buildEOProfileFrame(doc)
  if (profile) frames.push(profile)
  const tick = buildEOTickFrame(doc)
  if (tick) frames.push(tick)

  if (frames.length === 0) {
    return { captured: 0, reason: "price and balance anchors not readable" }
  }
  for (const f of frames) onFrame?.(f)
  return { captured: frames.length }
}