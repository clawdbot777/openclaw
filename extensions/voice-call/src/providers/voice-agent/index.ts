/**
 * Voice Agent Provider Factory
 *
 * Creates voice agent providers based on configuration.
 */

import type { IVoiceAgentProvider, VoiceAgentConfig } from "./base.js";
import { DeepgramVoiceAgentProvider } from "./deepgram-agent.js";

/**
 * Create a voice agent provider instance
 * @param config Voice agent configuration
 * @returns Provider instance
 */
export function createVoiceAgentProvider(
  config: VoiceAgentConfig,
): IVoiceAgentProvider {
  switch (config.provider) {
    case "deepgram-agent":
      return new DeepgramVoiceAgentProvider();
    default:
      throw new Error(`Unknown voice agent provider: ${config.provider}`);
  }
}

// Re-export types and classes
export * from "./base.js";
export * from "./types.js";
export { DeepgramVoiceAgentProvider };
