import { connectSession } from "../apps/dashboard/server/services/expertoption.mjs"
import { createMockExpertOptionServer } from "../apps/dashboard/server/__tests__/helpers/mockExpertOption.mjs"

const mock = createMockExpertOptionServer()
await mock.start()
const session = await connectSession({ token: "tok", isDemo: true, wsUrl: mock.url, regionUrls: [], timeoutMs: 5000 })
try {
  const candles = await session.candles("EURUSD", 60, 30)
  console.log("count:", candles.count, "ohlc:", candles.ohlc.length)
} catch (e) {
  console.log("ERR:", e?.message ?? e)
}
console.log("received actions:", mock.received.map((m) => `${m.action}:${m.ns ?? "no-ns"}`).join(" | "))
console.log("sent actions:", mock.sent.map((m) => `${m.action}:${m.id ?? m.ns ?? "no-id"}:${Array.isArray(m.message) ? "array:" + m.message.length : typeof m.message}`).join(" | "))
session.close()
await mock.stop()
process.exit(0)
