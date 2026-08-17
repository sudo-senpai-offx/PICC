import { connectSession } from "../apps/dashboard/server/services/expertoption.mjs"
import { getCredentials } from "../apps/dashboard/server/services/trading.mjs"

const { expertoptionToken: token, expertoptionDemo } = await getCredentials()
const s = await connectSession({ token, isDemo: expertoptionDemo !== false })
for (const [label, id, period] of [["BTCUSD", 160, 60], ["ETHUSD", 162, 60], ["S&P500ETF", 252, 60], ["GBPUSD", 155, 60], ["USDJPY", 159, 60], ["GOLD", 176, 60]]) {
  try {
    const hist = await s.candles(id, period, 60)
    const last = hist?.ohlc?.at(-1)
    console.log(`${label}(${id}): ${hist?.ohlc?.length ?? 0} bars, last=${last ? JSON.stringify(last) : "none"}`)
  } catch (e) {
    console.log(`${label}(${id}): ERROR ${e?.message ?? e}`)
  }
}
s.close()
process.exit(0)
