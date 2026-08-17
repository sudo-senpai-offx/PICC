// Runtime LLM provider settings — merged over .env defaults so providers and
// models can be configured from the Settings page without restarting or
// touching environment files. Stored in server/data/llm-settings.json
// (gitignored). API keys never leave the server.
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { env } from "../config.mjs"

const DEFAULT_FILE = fileURLToPath(new URL("../data/llm-settings.json", import.meta.url))

let FILE = process.env.PICC_LLM_SETTINGS_FILE || DEFAULT_FILE

export const PROVIDER_IDS = ["gemini", "groq", "mistral", "cerebras", "openai", "custom"]

export const PROVIDER_LABELS = {
  gemini: "Google Gemini",
  groq: "Groq",
  mistral: "Mistral",
  cerebras: "Cerebras",
  openai: "OpenAI",
  custom: "Custom (OpenAI-compatible)"
}

export const PROVIDER_DEFAULT_MODELS = {
  gemini: "gemini-3.6-flash",
  groq: "llama-3.3-70b-versatile",
  mistral: "open-mistral-nemo",
  cerebras: "llama-3.3-70b",
  openai: "gpt-4o-mini",
  custom: "gpt-3.5-turbo"
}

const DEFAULT_ORDER = ["gemini", "groq", "mistral", "cerebras", "openai"]

let cache = { providers: {}, order: [] }
let cacheStamp = -1

function load() {
  try {
    const st = statSync(FILE)
    if (st.mtimeMs !== cacheStamp) {
      cache = JSON.parse(readFileSync(FILE, "utf8"))
      cacheStamp = st.mtimeMs
      cache.providers = cache.providers ?? {}
      cache.order = Array.isArray(cache.order) ? cache.order : []
    }
  } catch {
    cache = { providers: {}, order: [] }
    cacheStamp = Date.now()
  }
  return cache
}

/** Override the settings file path (used by tests). */
export function _setSettingsFile(path) {
  FILE = path
  cache = { providers: {}, order: [] }
  cacheStamp = -1
}

/** Drop the file cache (used by tests to read fresh state). */
export function _resetSettingsCache() {
  cache = { providers: {}, order: [] }
  cacheStamp = -1
}

/**
 * Persist provider overrides. A blank apiKey clears the saved override so the
 * .env value (if any) takes over again. Returns the full next settings state.
 */
export function saveLLMSettings(patch = {}) {
  const cur = load()
  const providers = { ...cur.providers }
  const clean = (v) => (typeof v === "string" ? v.trim() : "")
  for (const id of PROVIDER_IDS) {
    const p = patch.providers?.[id]
    if (!p) continue
    const next = { ...(providers[id] ?? {}) }
    if (typeof p.apiKey === "string") next.apiKey = clean(p.apiKey)
    if (typeof p.model === "string") next.model = clean(p.model) || undefined
    if (id === "custom") {
      if (typeof p.baseUrl === "string") next.baseUrl = clean(p.baseUrl)
      if (p.enabled != null) next.enabled = Boolean(p.enabled)
    }
    providers[id] = next
  }
  const order = Array.isArray(patch.order)
    ? patch.order.map((s) => clean(s)).filter(Boolean)
    : cur.order
  const next = { providers, order }
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8")
  cache = next
  cacheStamp = Date.now()
  return JSON.parse(JSON.stringify(next))
}

/**
 * Effective configuration for one provider id: runtime override first, then
 * the .env value, then a sane default. `hasKey` says whether the provider is
 * actually usable right now.
 */
export function llmProviderConfig(id) {
  const saved = load().providers?.[id] ?? {}
  switch (id) {
    case "gemini": {
      const apiKey = saved.apiKey !== undefined && saved.apiKey !== "" ? saved.apiKey : env.geminiApiKey
      const serviceAccount = env.geminiServiceAccountFile
      // Service-account auth needs the Vertex project + region on top of the
      // JSON key file — a bare key file alone gets rejected by the API.
      const vertexReady = Boolean(serviceAccount && env.geminiProjectId && env.geminiLocation)
      return {
        id,
        label: PROVIDER_LABELS.gemini,
        apiKey,
        serviceAccount,
        projectId: env.geminiProjectId,
        location: env.geminiLocation,
        model: saved.model || env.geminiModel || PROVIDER_DEFAULT_MODELS.gemini,
        hasKey: Boolean(apiKey || vertexReady)
      }
    }
    case "custom": {
      const baseUrl = saved.baseUrl !== undefined && saved.baseUrl !== "" ? saved.baseUrl : env.customLlmBaseUrl
      const enabled = saved.enabled !== undefined ? saved.enabled : Boolean(env.customLlmBaseUrl)
      return {
        id,
        label: PROVIDER_LABELS.custom,
        apiKey: saved.apiKey !== undefined && saved.apiKey !== "" ? saved.apiKey : env.customLlmApiKey,
        baseUrl,
        model: saved.model || env.customLlmModel || PROVIDER_DEFAULT_MODELS.custom,
        enabled,
        hasKey: Boolean(enabled && baseUrl)
      }
    }
    default: {
      const apiKey = saved.apiKey !== undefined && saved.apiKey !== "" ? saved.apiKey : env[`${id}ApiKey`]
      return {
        id,
        label: PROVIDER_LABELS[id] ?? id,
        apiKey,
        model: saved.model || env[`${id}Model`] || PROVIDER_DEFAULT_MODELS[id],
        hasKey: Boolean(apiKey)
      }
    }
  }
}

/** Failover order: saved order first, then LLM_PROVIDERS, then the default. */
export function llmFailoverOrder() {
  const saved = load().order.filter((id) => PROVIDER_IDS.includes(id))
  if (saved.length) return saved
  const raw = env.llmProviders
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return (raw.length ? raw : DEFAULT_ORDER).filter((id) => PROVIDER_IDS.includes(id))
}

/** Provider ids in failover order that have a key/base URL configured. */
export function configuredLLMProviders() {
  return llmFailoverOrder().filter((id) => llmProviderConfig(id).hasKey)
}

/** True when at least one provider is configured right now. */
export function llmConfigured() {
  return configuredLLMProviders().length > 0
}

/**
 * Masked view for the Settings UI: shows what is configured and which models /
 * base URLs are in use, but never the key material itself.
 */
export function llmSettingsView() {
  const providers = {}
  for (const id of PROVIDER_IDS) {
    const cfg = llmProviderConfig(id)
    providers[id] = {
      id,
      label: cfg.label,
      configured: cfg.hasKey,
      model: cfg.model,
      apiKeySet: Boolean(cfg.apiKey),
      serviceAccountSet: Boolean(cfg.serviceAccount),
      ...(id === "custom" ? { baseUrl: cfg.baseUrl, enabled: cfg.enabled } : {}),
      ...(id === "gemini" ? { projectId: cfg.projectId, location: cfg.location } : {})
    }
  }
  return { providers, order: llmFailoverOrder() }
}
