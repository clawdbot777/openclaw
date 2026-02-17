/**
 * Voice Agent Mode Detection and Provider Initialization
 *
 * Determines whether to use legacy (STT+LLM+TTS) or Voice Agent API mode
 * and initializes the appropriate provider.
 */

import type { VoiceCallConfig } from "./config.js";
import type { IVoiceAgentProvider } from "./providers/voice-agent/index.js";
import { createVoiceAgentProvider } from "./providers/voice-agent/index.js";

/**
 * Check if Voice Agent API mode is enabled and configured
 */
export function isVoiceAgentApiMode(config: VoiceCallConfig): boolean {
  return (
    config.voiceProviderType === "voice-agent-api" &&
    config.voiceAgentApi !== undefined &&
    config.voiceAgentApi.provider !== undefined
  );
}

/**
 * Initialize Voice Agent API provider if configured
 */
export async function initializeVoiceAgentProvider(
  config: VoiceCallConfig,
): Promise<IVoiceAgentProvider | null> {
  if (!isVoiceAgentApiMode(config)) {
    return null;
  }

  if (!config.voiceAgentApi) {
    throw new Error("Voice Agent API config missing");
  }

  console.log(
    `[voice-agent-mode] Initializing Voice Agent API provider: ${config.voiceAgentApi.provider}`,
  );

  try {
    const provider = createVoiceAgentProvider(config.voiceAgentApi);
    await provider.connect(config.voiceAgentApi);
    console.log("[voice-agent-mode] Voice Agent provider connected successfully");
    return provider;
  } catch (err) {
    console.error("[voice-agent-mode] Failed to initialize Voice Agent provider:", err);
    throw err;
  }
}

/**
 * Get the greeting message for a call
 * - Voice Agent API mode: uses agent.greeting from config
 * - Legacy mode: uses inboundGreeting from config
 */
export function getCallGreeting(config: VoiceCallConfig): string | undefined {
  if (isVoiceAgentApiMode(config) && config.voiceAgentApi?.agent.greeting) {
    return config.voiceAgentApi.agent.greeting;
  }
  return config.inboundGreeting;
}
