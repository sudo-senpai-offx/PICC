import { connectSession } from "../apps/dashboard/server/services/expertoption.mjs"
import { getCredentials } from "../apps/dashboard/server/services/trading.mjs"

const { expertoptionToken: token, expertoptionDemo } = await getCredentials()
const s = await connectSession({ token, isDemo: expertoptionDemo !== false })
const raw = await s.assets()
const assets = (Array.isArray(raw) ? raw : raw?.assets ?? raw?.result ?? []) || []
const out = assets.filter((a) => {
  const n = String(a.name ?? "").toLowerCase()
  return /btc|bitcoin|eth|ether|us500|sp500|\b500\b|crypto|index|wall|dax|nasdaq/i.test(n)
})
console.log(out.map((a) => `${a.id}\t${a.name}\tvis=${a.visible}\t${a.type ?? ""}\t${a.currency ?? ""}`).join("\n"))
s.close()
process.exit(0)
