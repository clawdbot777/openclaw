/**
 * Voice Agent API Base Interface
 *
 * Abstract interface that all voice agent providers must implement.
 * Providers handle unified STT→LLM→TTS pipeline in a single connection.
 */

import type EventEmitter from "node:events";

export interface IVoiceAgentProvider extends EventEmitter {
  /**
   * Connect to the agent service and establish WebSocket connection.
   * @param config Voice agent configuration
   */
  connect(config: VoiceAgentConfig): Promise<void>;

  /**
   * Send audio chunk to the agent for transcription.
   * Audio format must match the configured input encoding/sample_rate.
   * @param audio Audio buffer (mu-law or linear16)
   */
  sendAudio(audio: Buffer): void;

  /**
   * Update agent settings dynamically (prompt, voice, greeting, etc.).
   * @param settings Partial settings to update
   */
  updateSettings(settings: Partial<VoiceAgentSettings>): Promise<void>;

  /**
   * Inject text into the conversation (e.g., tool results, context).
   * @param text Text to inject
   * @param role Role (user or assistant)
   */
  injectText(text: string, role: "user" | "assistant"): Promise<void>;

  /**
   * Request the agent to speak without waiting for user input.
   * Useful for proactive messages or notifications.
   * @param text Text to synthesize
   */
  speak(text: string): Promise<void>;

  /**
   * Gracefully close the connection.
   */
  close(): Promise<void>;

  /**
   * Check if the provider is currently connected.
   */
  isConnected(): boolean;
}

/**
 * Voice agent configuration passed to connect()
 */
export interface VoiceAgentConfig {
  /** Provider identifier (e.g., "deepgram-agent") */
  provider: string;

  /** API key for the service (optional if provided via env) */
  apiKey?: string;

  /** Agent behavior configuration */
  agent: {
    /** Language code (e.g., "en", "es") */
    language: string;

    /** STT (listen) settings */
    listen: {
      /** Model name (e.g., "nova-3") */
      model: string;
      /** Additional provider-specific settings */
      [key: string]: unknown;
    };

    /** LLM (think) settings */
    think: {
      /** LLM provider (e.g., "open_ai", "anthropic", "custom") */
      provider: string;
      /** Model name (e.g., "gpt-4o-mini") */
      model: string;
      /** System prompt (optional) */
      prompt?: string;
      /** Additional provider-specific settings */
      [key: string]: unknown;
    };

    /** TTS (speak) settings */
    speak: {
      /** Voice model name (e.g., "aura-2-helios-en") */
      model: string;
      /** Additional provider-specific settings */
      [key: string]: unknown;
    };

    /** Initial greeting message (optional) */
    greeting?: string;
  };

  /** Audio encoding configuration */
  audio: {
    /** Input audio settings (from telephony provider) */
    input: {
      /** Encoding format */
      encoding: "linear16" | "mulaw";
      /** Sample rate in Hz */
      sample_rate: number;
    };
    /** Output audio settings (to telephony provider) */
    output: {
      /** Encoding format */
      encoding: "linear16" | "mulaw";
      /** Sample rate in Hz */
      sample_rate: number;
      /** Container format */
      container: "wav" | "none";
    };
  };
}

/**
 * Settings that can be updated dynamically
 */
export interface VoiceAgentSettings {
  /** Update system prompt */
  prompt?: string;
  /** Update greeting message */
  greeting?: string;
  /** Update voice model */
  voice?: string;
}

/**
 * Event types emitted by voice agent providers
 */
export type VoiceAgentEvent =
  | "welcome"
  | "settings_applied"
  | "user_started_speaking"
  | "conversation_text"
  | "agent_thinking"
  | "agent_started_speaking"
  | "audio"
  | "agent_audio_done"
  | "error"
  | "close";
