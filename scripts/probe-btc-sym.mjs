import { connectSession } from "../apps/dashboard/server/services/expertoption.mjs"
import { getCredentials } from "../apps/dashboard/server/services/trading.mjs"

const { expertoptionToken: token, expertoptionDemo } = await getCredentials()
const s = await connectSession({ token, isDemo: expertoptionDemo !== false })
for (const [label, arg] of [["BTC/USD sym", "BTC/USD"], ["BTCUSD sym", "BTCUSD"], ["160 num", 160]]) {
  try {
    const hist = await s.candles(arg, 60, 5)
    console.log(`${label}(${arg}): count=${hist?.count} ohlc=${hist?.ohlc?.length}`)
  } catch (e) {
    console.log(`${label}(${arg}): ERROR ${e?.message ?? e}`)
  }
}
s.close()
process.exit(0)
