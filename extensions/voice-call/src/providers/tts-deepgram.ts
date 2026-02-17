/**
 * Deepgram TTS Provider (Aura)
 *
 * Generates speech audio using Deepgram's Aura text-to-speech API.
 * Handles audio format conversion for telephony (mu-law 8kHz).
 *
 * @see https://developers.deepgram.com/docs/tts-models
 */

/**
 * Deepgram TTS configuration.
 */
export interface DeepgramTTSConfig {
  /** Deepgram API key (uses DEEPGRAM_API_KEY env if not set) */
  apiKey?: string;
  /**
   * Voice to use.
   * Available voices:
   * - aura-asteria-en (female, warm, conversational)
   * - aura-luna-en (female, friendly, expressive)
   * - aura-stella-en (female, calm, professional)
   * - aura-athena-en (female, energetic, bright)
   * - aura-hera-en (female, clear, articulate)
   * - aura-orion-en (male, deep, confident)
   * - aura-arcas-en (male, warm, friendly)
   * - aura-perseus-en (male, clear, professional)
   * - aura-angus-en (male, Irish accent)
   * - aura-orpheus-en (male, smooth, storyteller)
   * - aura-helios-en (male, British, authoritative)
   * - aura-zeus-en (male, powerful, commanding)
   */
  voice?: string;
  /** Model to use (default: aura) */
  model?: string;
  /** Encoding format (default: mulaw for telephony) */
  encoding?: string;
  /** Sample rate in Hz (default: 8000 for telephony) */
  sampleRate?: number;
  /** Container format (default: none for raw audio) */
  container?: string;
}

/**
 * Supported Deepgram Aura voices.
 */
export const DEEPGRAM_AURA_VOICES = [
  "aura-asteria-en",
  "aura-luna-en",
  "aura-stella-en",
  "aura-athena-en",
  "aura-hera-en",
  "aura-orion-en",
  "aura-arcas-en",
  "aura-perseus-en",
  "aura-angus-en",
  "aura-orpheus-en",
  "aura-helios-en",
  "aura-zeus-en",
] as const;

export type DeepgramAuraVoice = (typeof DEEPGRAM_AURA_VOICES)[number];

/**
 * Deepgram TTS Provider for generating speech audio.
 */
export class DeepgramTTSProvider {
  private apiKey: string;
  private voice: DeepgramAuraVoice;
  private model: string;
  private encoding: string;
  private sampleRate: number;
  private container: string;

  constructor(config: DeepgramTTSConfig = {}) {
    this.apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY || "";
    this.voice = (config.voice as DeepgramAuraVoice) || "aura-arcas-en";
    this.model = config.model || "aura";
    this.encoding = config.encoding || "mulaw";
    this.sampleRate = config.sampleRate || 8000;
    this.container = config.container || "none";

    if (!this.apiKey) {
      throw new Error("Deepgram API key required (set DEEPGRAM_API_KEY or pass apiKey)");
    }
  }

  /**
   * Generate speech audio from text.
   * Returns mu-law audio data (8kHz, mono) ready for Twilio.
   */
  async synthesize(text: string): Promise<Buffer> {
    const params = new URLSearchParams({
      model: this.voice,
      encoding: this.encoding,
      sample_rate: this.sampleRate.toString(),
      container: this.container,
    });

    const response = await fetch(`https://api.deepgram.com/v1/speak?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Deepgram TTS failed: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate speech for Twilio (already in mu-law format).
   */
  async synthesizeForTwilio(text: string): Promise<Buffer> {
    // Deepgram already outputs mu-law at 8kHz when configured
    return this.synthesize(text);
  }
}

/**
 * Chunk audio buffer into 20ms frames for streaming.
 * At 8kHz mono, 20ms = 160 samples = 160 bytes (mu-law).
 */
export function chunkAudio(audio: Buffer, chunkSize = 160): Generator<Buffer, void, unknown> {
  return (function* () {
    for (let i = 0; i < audio.length; i += chunkSize) {
      yield audio.subarray(i, Math.min(i + chunkSize, audio.length));
    }
  })();
}
