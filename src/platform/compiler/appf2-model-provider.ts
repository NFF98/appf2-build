import {
  ModelGatewayConfigError,
  openAiCompatibleConfigFromEnv,
  type OpenAiCompatibleConfig
} from "./openai-compatible-gateway.js";

export type Appf2ModelProvider = "openai" | "xai" | "deepseek";

function alternateProviderConfig(
  provider: "xai" | "deepseek", env: Readonly<Record<string, string | undefined>>
): { readonly provider: Appf2ModelProvider; readonly config: OpenAiCompatibleConfig } {
  const keyVariable = provider === "xai" ? "APPF2_XAI_API_KEY" : "APPF2_DEEPSEEK_API_KEY";
  const modelVariable = provider === "xai" ? "APPF2_XAI_MODEL_NAME" : "APPF2_DEEPSEEK_MODEL_NAME";
  const missing = [keyVariable, modelVariable].filter(name => !env[name]?.trim());
  if (missing.length) throw new ModelGatewayConfigError(missing);
  const config = openAiCompatibleConfigFromEnv({
    APPF2_MODEL_BASE_URL: provider === "xai" ? "https://api.x.ai/v1" : "https://api.deepseek.com",
    APPF2_MODEL_NAME: env[modelVariable],
    APPF2_MODEL_API_KEY: env[keyVariable]
  });
  return {
    provider,
    config: provider === "deepseek" ? {...config, outputFormat: "json_object"} : config
  };
}

/** Exactly one configured provider per request: no surprise third-party data transfers or costful failover. */
export function appf2ModelProviderConfig(
  env: Readonly<Record<string, string | undefined>>
): { readonly provider: Appf2ModelProvider; readonly config: OpenAiCompatibleConfig } {
  const value = (env.APPF2_MODEL_PROVIDER || "openai").trim().toLowerCase();
  if (value !== "openai" && value !== "xai" && value !== "deepseek") {
    throw new ModelGatewayConfigError(["APPF2_MODEL_PROVIDER (expected openai, xai, or deepseek)"]);
  }
  const provider = value as Appf2ModelProvider;
  if (provider === "openai") {
    // Legacy APPF2_MODEL_* variables remain the one default configuration.
    const config = openAiCompatibleConfigFromEnv({
      ...env,
      APPF2_MODEL_BASE_URL: env.APPF2_MODEL_BASE_URL?.trim() || "https://api.openai.com/v1",
      APPF2_MODEL_NAME: env.APPF2_MODEL_NAME?.trim() || "gpt-4.1"
    });
    if (new URL(config.baseUrl).origin !== "https://api.openai.com") {
      throw new ModelGatewayConfigError(["APPF2_MODEL_BASE_URL (OpenAI provider must use api.openai.com)"]);
    }
    return { provider, config };
  }
  return alternateProviderConfig(provider, env);
}

/** Explicit opt-in only. Fallback never selects itself or transfers to an
 * unconfigured provider; no key or model name is emitted to logs. */
export function appf2ModelFallbackConfig(
  env: Readonly<Record<string, string | undefined>>
): { readonly provider: Appf2ModelProvider; readonly config: OpenAiCompatibleConfig } | undefined {
  const value = env.APPF2_MODEL_FALLBACK_PROVIDER?.trim().toLowerCase() || "";
  if (!value) return undefined;
  if (value !== "xai" && value !== "deepseek") {
    throw new ModelGatewayConfigError(["APPF2_MODEL_FALLBACK_PROVIDER (expected xai or deepseek)"]);
  }
  const primary = (env.APPF2_MODEL_PROVIDER || "openai").trim().toLowerCase();
  if (value === primary) {
    throw new ModelGatewayConfigError(["APPF2_MODEL_FALLBACK_PROVIDER (must differ from primary)"]);
  }
  return alternateProviderConfig(value, env);
}
