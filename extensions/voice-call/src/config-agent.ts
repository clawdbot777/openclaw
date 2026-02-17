/**
 * Voice Agent API Configuration Schema
 *
 * Zod schemas for voice agent API providers (Deepgram, Retell, Vapi, etc.)
 */

import { z } from "zod";

/**
 * Voice provider type: legacy (separate STT+TTS) or agent API (unified)
 */
export const VoiceProviderTypeSchema = z.enum(["legacy-stt-tts", "voice-agent-api"]);
export type VoiceProviderType = z.infer<typeof VoiceProviderTypeSchema>;

/**
 * Voice Agent API configuration
 */
export const VoiceAgentApiConfigSchema = z
  .object({
    /** Provider (deepgram-agent, retell, vapi, etc.) */
    provider: z.enum(["deepgram-agent"]).default("deepgram-agent"),

    /** API key (uses DEEPGRAM_API_KEY env if not set) */
    apiKey: z.string().min(1).optional(),

    /** Agent configuration */
    agent: z.object({
      /** Language code */
      language: z.string().default("en"),

      /** Listen (STT) settings */
      listen: z.object({
        model: z.string().default("nova-3"),
      }),

      /** Think (LLM) settings */
      think: z.object({
        provider: z.enum(["open_ai", "anthropic", "custom"]).default("open_ai"),
        model: z.string().default("gpt-4o-mini"),
        /** Override system prompt (if not set, uses responseSystemPrompt) */
        prompt: z.string().optional(),
      }),

      /** Speak (TTS) settings */
      speak: z.object({
        model: z.string().default("aura-2-helios-en"),
      }),

      /** Greeting message */
      greeting: z.string().optional(),
    }),

    /** Audio settings */
    audio: z.object({
      input: z.object({
        encoding: z.enum(["linear16", "mulaw"]).default("linear16"),
        sample_rate: z.number().default(24000),
      }),
      output: z.object({
        encoding: z.enum(["linear16", "mulaw"]).default("linear16"),
        sample_rate: z.number().default(24000),
        container: z.enum(["wav", "none"]).default("wav"),
      }),
    }),
  })
  .strict();

export type VoiceAgentApiConfig = z.infer<typeof VoiceAgentApiConfigSchema>;
