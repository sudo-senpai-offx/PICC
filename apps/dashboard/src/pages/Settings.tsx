import { useEffect, useState } from "react"
import { getHealth } from "@/lib/api"
import type { HealthInfo } from "@/lib/api"
import { getAgentSettings, saveAgentSettings } from "@/lib/api"
import type { AgentSettings } from "@/lib/api"
import {
  getLLMSettings,
  saveLLMSettings,
  testLLMProvider
} from "@/lib/api"
import type { LLMSettingsView, LLMTestResult } from "@/lib/api"
import { FEATURES, getFeatureFlags, setFeatureFlag } from "@/lib/settings"
import type { FeatureKey } from "@/lib/settings"

export function Settings() {
  const [flags, setFlags] = useState(getFeatureFlags())
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [agent, setAgent] = useState<AgentSettings | null>(null)
  const [model, setModel] = useState("openai/llama-3.3-70b-versatile")
  const [baseUrl, setBaseUrl] = useState("https://api.groq.com/openai/v1")
  const [apiKey, setApiKey] = useState("")
  const [agentEnabled, setAgentEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [llm, setLlm] = useState<LLMSettingsView | null>(null)
  const [llmKeys, setLlmKeys] = useState<Record<string, string>>({})
  const [llmModels, setLlmModels] = useState<Record<string, string>>({})
  const [llmBaseUrls, setLlmBaseUrls] = useState<Record<string, string>>({})
  const [llmOrder, setLlmOrder] = useState<string[]>([])
  const [llmTests, setLlmTests] = useState<Record<string, LLMTestResult | "busy">>({})
  const [llmMsg, setLlmMsg] = useState<string | null>(null)

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {})
    getAgentSettings()
      .then((s) => {
        setAgent(s)
        setModel(s.model)
        setBaseUrl(s.base_url)
        setAgentEnabled(s.enabled)
      })
      .catch(() => {})
    getLLMSettings()
      .then((v) => {
        setLlm(v)
        setLlmOrder(v.order)
        const models: Record<string, string> = {}
        const baseUrls: Record<string, string> = {}
        for (const p of Object.values(v.providers)) {
          models[p.id] = p.model
          if (p.baseUrl != null) baseUrls[p.id] = p.baseUrl
        }
        setLlmModels(models)
        setLlmBaseUrls(baseUrls)
      })
      .catch(() => {})
  }, [])

  const toggle = (key: FeatureKey) => {
    const next = setFeatureFlag(key, !flags[key])
    setFlags(next)
  }

  const saveAgent = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const saved = await saveAgentSettings({ model, base_url: baseUrl, api_key: apiKey, enabled: agentEnabled })
      setAgent(saved)
      setApiKey("")
      setMessage("Agent settings saved — they take effect on the next crew run.")
    } catch (err) {
      setMessage(`Failed to save: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const saveLLM = async () => {
    setLlmMsg(null)
    const providers: Record<string, { apiKey?: string; model?: string; baseUrl?: string; enabled?: boolean }> = {}
    for (const [id, key] of Object.entries(llmKeys)) {
      if (key.trim()) providers[id] = { ...(providers[id] ?? {}), apiKey: key.trim() }
    }
    for (const [id, model] of Object.entries(llmModels)) {
      if (model.trim()) providers[id] = { ...(providers[id] ?? {}), model: model.trim() }
    }
    for (const [id, url] of Object.entries(llmBaseUrls)) {
      if (url.trim()) providers[id] = { ...(providers[id] ?? {}), baseUrl: url.trim() }
    }
    try {
      await saveLLMSettings({ providers, order: llmOrder })
      setLlmKeys({})
      setLlmMsg("AI provider settings saved — the next LLM call uses them immediately.")
      getLLMSettings()
        .then((v) => {
          setLlm(v)
          setLlmOrder(v.order)
          const models: Record<string, string> = {}
          const baseUrls: Record<string, string> = {}
          for (const p of Object.values(v.providers)) {
            models[p.id] = p.model
            if (p.baseUrl != null) baseUrls[p.id] = p.baseUrl
          }
          setLlmModels(models)
          setLlmBaseUrls(baseUrls)
        })
        .catch(() => {})
    } catch (err) {
      setLlmMsg(`Failed to save: ${String(err)}`)
    }
  }

  const runLLMTest = async (id: string) => {
    setLlmTests((t) => ({ ...t, [id]: "busy" }))
    try {
      const res = await testLLMProvider(id)
      setLlmTests((t) => ({ ...t, [id]: res }))
    } catch (err) {
      setLlmTests((t) => ({ ...t, [id]: { ok: false, error: String(err) } }))
    }
  }

  const moveOrder = (id: string, dir: -1 | 1) => {
    setLlmOrder((order) => {
      const i = order.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= order.length) return order
      const next = [...order]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">Enable, disable, and configure every PICC feature from one place.</p>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Features</h2>
        <div className="stack">
          {(Object.keys(FEATURES) as FeatureKey[]).map((key) => (
            <label key={key} className="row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={() => toggle(key)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>{FEATURES[key].label}</strong>
                <span className="muted"> — {FEATURES[key].desc}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="muted">Disabled features disappear from the sidebar and are blocked when visited.</p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Agents — LLM provider</h2>
        <p className="muted">
          The crews run on a free OpenAI-compatible endpoint by default (Groq). Switch model or base
          URL to use a different provider — the API key is sent as a Bearer token to base_url.
        </p>
        <div className="stack">
          <label>
            Model
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="openai/llama-3.3-70b-versatile" />
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" />
          </label>
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={agent?.api_key_configured ? "•••••••• (currently set, leave blank to keep)" : "Enter an API key"}
            />
          </label>
          <label className="row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={agentEnabled} onChange={(e) => setAgentEnabled(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Run live crews (off = local fallback responses)</span>
          </label>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={saveAgent} disabled={busy}>
              {busy ? "Saving…" : "Save agent settings"}
            </button>
            {health && <span className="muted">Agents service: {health.agents?.ok ? "online" : "offline"}</span>}
          </div>
          {message && <p className="muted">{message}</p>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>AI models &amp; providers</h2>
        <p className="muted">
          These power PICC's decision-support features (pro-analysis narratives, autopilot gates,
          research). Keys are stored on the server and never exposed back to the browser. An empty
          key field keeps the current value (or the matching .env key).
        </p>
        {!llm ? (
          <p className="muted">Loading providers…</p>
        ) : (
          <div className="stack">
            {Object.values(llm.providers).map((p) => {
              const test = llmTests[p.id]
              return (
                <div key={p.id} style={{ borderTop: "1px solid #333", paddingTop: 10 }}>
                  <div className="row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <strong>{p.label}</strong>
                    <span className="muted">
                      {p.configured ? `configured${p.apiKeySet ? " (key set)" : p.serviceAccountSet ? " (service account)" : ""}` : "not configured"}
                    </span>
                  </div>
                  <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                    <label style={{ flex: "1 1 220px" }}>
                      Model
                      <input
                        value={llmModels[p.id] ?? p.model}
                        onChange={(e) => setLlmModels((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="model id"
                      />
                    </label>
                    <label style={{ flex: "1 1 260px" }}>
                      API key
                      <input
                        type="password"
                        value={llmKeys[p.id] ?? ""}
                        onChange={(e) => setLlmKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                        placeholder={p.apiKeySet ? "•••••••• (leave blank to keep)" : "Enter a key"}
                      />
                    </label>
                    {p.id === "custom" && (
                      <label style={{ flex: "1 1 280px" }}>
                        Base URL (OpenAI-compatible)
                        <input
                          value={llmBaseUrls[p.id] ?? p.baseUrl ?? ""}
                          onChange={(e) => setLlmBaseUrls((b) => ({ ...b, [p.id]: e.target.value }))}
                          placeholder="https://host/v1"
                        />
                      </label>
                    )}
                  </div>
                  <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    <button onClick={() => runLLMTest(p.id)} disabled={test === "busy"}>
                      {test === "busy" ? "Testing…" : "Test"}
                    </button>
                    {test === "busy" ? null : test ? (
                      <span className="muted">
                        {test.ok
                          ? `OK — ${test.model ?? p.id} · ${test.latencyMs}ms · "${test.reply}"`
                          : `Failed: ${test.error}`}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}

            <div style={{ borderTop: "1px solid #333", paddingTop: 10 }}>
              <strong>Failover order</strong>
              <p className="muted">Providers are tried top to bottom on every request.</p>
              <div className="stack">
                {llmOrder.map((id, i) => {
                  const p = llm?.providers?.[id]
                  return (
                    <div key={id} className="row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="muted" style={{ width: 18 }}>
                        {i + 1}.
                      </span>
                      <span style={{ flex: 1 }}>{p?.label ?? id}</span>
                      <button onClick={() => moveOrder(id, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button onClick={() => moveOrder(id, 1)} disabled={i === llmOrder.length - 1}>
                        ↓
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button onClick={saveLLM}>Save AI provider settings</button>
            </div>
            {llmMsg && <p className="muted">{llmMsg}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
