// Server-side configuration for the PICC backend.
// Loads the dashboard `.env` file (when present) for both the dev middleware
// and the standalone production server. Secrets here never reach the browser.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  llmConfigured as runtimeLLMConfigured,
  configuredLLMProviders as runtimeConfiguredLLMProviders
} from "./services/llmSettings.mjs"

if (!process.env.PICC_ENV_LOADED) {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url))
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath)
    } catch (err) {
      console.warn("[picc] failed to load .env:", err.message)
    }
  }
  process.env.PICC_ENV_LOADED = "1"
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  // Cloud LLM providers — free tiers, no credit card needed.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiServiceAccountFile: process.env.GEMINI_SERVICE_ACCOUNT_FILE ?? "",
  // Vertex AI (service-account auth): project + region, e.g. "gemini-app" / "us-central1".
  geminiProjectId: process.env.GEMINI_PROJECT_ID ?? "",
  geminiLocation: process.env.GEMINI_LOCATION ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  mistralApiKey: process.env.MISTRAL_API_KEY ?? "",
  mistralModel: process.env.MISTRAL_MODEL ?? "open-mistral-nemo",
  cerebrasApiKey: process.env.CEREBRAS_API_KEY ?? "",
  cerebrasModel: process.env.CEREBRAS_MODEL ?? "llama-3.3-70b",
  // Generic OpenAI-compatible provider (OpenRouter, DeepSeek, xAI, local
  // Ollama/LM-Studio/llama.cpp, ...) — point at any /v1 chat completions API.
  customLlmBaseUrl: process.env.CUSTOM_LLM_BASE_URL ?? "",
  customLlmApiKey: process.env.CUSTOM_LLM_API_KEY ?? "",
  customLlmModel: process.env.CUSTOM_LLM_MODEL ?? "",
  // Optional comma-separated failover order, e.g. "gemini,groq,mistral,cerebras,openai".
  llmProviders: process.env.LLM_PROVIDERS ?? "",
  serperApiKey: process.env.SERPER_API_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
  stripePriceBusiness: process.env.STRIPE_PRICE_BUSINESS ?? "",
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  paypalMode: process.env.PAYPAL_MODE ?? "sandbox",
  btcpayUrl: process.env.BTCPAY_URL ?? "",
  btcpayApiKey: process.env.BTCPAY_API_KEY ?? "",
  btcpayStoreId: process.env.BTCPAY_STORE_ID ?? "",
  ewalletTngNumber: process.env.EWALLET_TNG_NUMBER ?? "",
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  agentsUrl: (process.env.PICC_AGENTS_URL ?? "").replace(/\/+$/, ""),
  // Amazon SP-API (LWA application + IAM SigV4 keys). See docs/SETUP.md.
  amazonClientId: process.env.SP_AMAZON_CLIENT_ID ?? "",
  amazonClientSecret: process.env.SP_AMAZON_CLIENT_SECRET ?? "",
  amazonRefreshToken: process.env.SP_AMAZON_REFRESH_TOKEN ?? "",
  amazonAccessKey: process.env.SP_AMAZON_ACCESS_KEY ?? "",
  amazonSecretKey: process.env.SP_AMAZON_SECRET_KEY ?? "",
  amazonMarketplace: process.env.SP_AMAZON_MARKETPLACE ?? "US"
}

/**
 * Provider ids (respecting saved runtime order, then LLM_PROVIDERS) that have a
 * key configured. Delegates to the runtime settings store so keys and models
 * entered in the Settings page take effect without a restart.
 */
export function configuredLLMProviders() {
  return runtimeConfiguredLLMProviders()
}

/** True when at least one cloud LLM provider is configured (env or runtime). */
export function llmConfigured() {
  return runtimeLLMConfigured()
}

/** Which real providers are currently configured (used by /api/health and badges). */
export function providers() {
  return {
    yahoo: true,
    llm: llmConfigured(),
    llmProviders: configuredLLMProviders(),
    serper: Boolean(env.serperApiKey),
    stripe: Boolean(env.stripeSecretKey),
    paypal: Boolean(env.paypalClientId && env.paypalClientSecret),
    btcpay: Boolean(env.btcpayUrl && env.btcpayApiKey && env.btcpayStoreId),
    ewallet: Boolean(env.ewalletTngNumber), // manual Touch 'n Go orders need a real TNG number
    crypto: true, // CoinGecko public API — free, no key required
    agents: Boolean(env.agentsUrl),
    amazon: Boolean(
      env.amazonClientId &&
        env.amazonClientSecret &&
        env.amazonRefreshToken &&
        env.amazonAccessKey &&
        env.amazonSecretKey
    )
  }
}
