// Additive realtime surface for the dispatch inbox — glued into realtimeSuite's
// SECTIONS and the SSE handler. Additive only; nothing here edits legacy bytes.
import { listDispatch, unreadDispatchCount, onDispatch } from "./dispatch.mjs"

export function dispatchSection() {
  return { unread: unreadDispatchCount(), entries: listDispatch({ limit: 10 }) }
}

export const onDispatchLive = onDispatch