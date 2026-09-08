import { AutopilotSuite, ProAnalysisCard, PredictionCard } from "@/components/TradingSuite"
import { ModelMatrixPanel } from "@/components/ModelMatrixPanel"

export function AutopilotRoom() {
  return (
    <div className="stack">
      <header data-room="autopilot">
        <h2>Autopilot</h2>
        <p className="muted small">Automated demo-trading engine — configure scope and risk, monitor the engine, and inspect prediction and model confidence.</p>
      </header>
      <AutopilotSuite />
      <ProAnalysisCard />
      <PredictionCard recordSignal={() => {}} />
      <ModelMatrixPanel assetId="EURUSD" />
    </div>
  )
}
