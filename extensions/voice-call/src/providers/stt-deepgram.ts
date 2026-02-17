/**
 * Deepgram Streaming STT Provider
 *
 * Uses Deepgram's WebSocket API for real-time speech-to-text with:
 * - Direct mu-law audio support (8kHz telephony audio)
 * - Low-latency streaming transcription
 * - Partial transcript callbacks for real-time UI updates
 * - Speaker diarization and advanced features
 *
 * @see https://developers.deepgram.com/docs/streaming
 */

import WebSocket from "ws";

/**
 * Configuration for Deepgram Streaming STT.
 */
export interface DeepgramSTTConfig {
  /** Deepgram API key */
  apiKey: string;
  /** Model to use (default: nova-2) */
  model?: string;
  /** Language code (default: en-US) */
  language?: string;
  /** Enable smart formatting */
  smartFormat?: boolean;
  /** Enable punctuation */
  punctuate?: boolean;
  /** Enable interim results (partial transcripts) */
  interimResults?: boolean;
  /** Endpointing delay in ms (default: 1000) */
  endpointing?: number;
}

/**
 * Session for streaming audio and receiving transcripts.
 */
export interface DeepgramSTTSession {
  /** Connect to the transcription service */
  connect(): Promise<void>;
  /** Send mu-law audio data (8kHz mono) */
  sendAudio(audio: Buffer): void;
  /** Wait for next complete transcript */
  waitForTranscript(timeoutMs?: number): Promise<string>;
  /** Set callback for partial transcripts (streaming) */
  onPartial(callback: (partial: string) => void): void;
  /** Set callback for final transcripts */
  onTranscript(callback: (transcript: string) => void): void;
  /** Set callback when speech starts */
  onSpeechStart(callback: () => void): void;
  /** Close the session */
  close(): void;
  /** Check if session is connected */
  isConnected(): boolean;
}

/**
 * Provider factory for Deepgram STT sessions.
 */
export class DeepgramSTTProvider {
  readonly name = "deepgram";
  private apiKey: string;
  private model: string;
  private language: string;
  private smartFormat: boolean;
  private punctuate: boolean;
  private interimResults: boolean;
  private endpointing: number;

  constructor(config: DeepgramSTTConfig) {
    if (!config.apiKey) {
      throw new Error("Deepgram API key required for STT");
    }
    this.apiKey = config.apiKey;
    this.model = config.model || "nova-2";
    this.language = config.language || "en-US";
    this.smartFormat = config.smartFormat ?? true;
    this.punctuate = config.punctuate ?? true;
    this.interimResults = config.interimResults ?? true;
    this.endpointing = config.endpointing || 1000;
  }

  /**
   * Create a new streaming transcription session.
   */
  createSession(): DeepgramSTTSession {
    return new DeepgramSTTSessionImpl(
      this.apiKey,
      this.model,
      this.language,
      this.smartFormat,
      this.punctuate,
      this.interimResults,
      this.endpointing,
    );
  }
}

/**
 * WebSocket-based session for real-time speech-to-text via Deepgram.
 */
class DeepgramSTTSessionImpl implements DeepgramSTTSession {
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private explicitClose = false; // Track whether close() was called intentionally
  private reconnectAttempts = 0;
  private reconnecting = false; // Prevent multiple concurrent reconnection attempts
  private onTranscriptCallback: ((transcript: string) => void) | null = null;
  private onPartialCallback: ((partial: string) => void) | null = null;
  private onSpeechStartCallback: (() => void) | null = null;
  private transcriptQueue: string[] = [];
  private transcriptResolvers: Array<(value: string) => void> = [];
  private audioBuffer: Buffer[] = []; // Buffer audio packets until WebSocket is connected
  private currentTranscript = ""; // Accumulate transcript for UtteranceEnd fallback
  private currentUtteranceFired = false; // Prevent duplicate firing from speech_final + UtteranceEnd

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly language: string,
    private readonly smartFormat: boolean,
    private readonly punctuate: boolean,
    private readonly interimResults: boolean,
    private readonly endpointing: number,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      smart_format: this.smartFormat.toString(),
      punctuate: this.punctuate.toString(),
      interim_results: this.interimResults.toString(),
      endpointing: this.endpointing.toString(),
      utterance_end_ms: "1000", // Fallback for noisy phone lines - triggers on word gaps
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
    });

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
        },
      });

      this.ws.on("open", () => {
        this.connected = true;
        console.log("[deepgram-stt] Connected, flushing audio buffer...");
        this.flushAudioBuffer();
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (err) {
          console.error("[deepgram-stt] Failed to parse message:", err);
        }
      });

      this.ws.on("error", (error) => {
        console.error("[deepgram-stt] WebSocket error:", error);
        if (!this.connected) {
          reject(error);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        // Only attempt reconnection if not explicitly closed
        if (!this.explicitClose && !this.closed) {
          void this.attemptReconnect();
        } else {
          this.closed = true;
        }
      });
    });
  }

  private fireTranscript(transcript: string): void {
    // Fire transcript callback
    if (this.onTranscriptCallback) {
      this.onTranscriptCallback(transcript);
    }
    // Resolve any waiting promises
    const resolver = this.transcriptResolvers.shift();
    if (resolver) {
      resolver(transcript);
    } else {
      this.transcriptQueue.push(transcript);
    }
  }

  private handleMessage(message: any): void {
    // Handle transcript results
    if (message.type === "Results") {
      const channel = message.channel?.alternatives?.[0];
      if (!channel) return;

      const transcript = channel.transcript?.trim();
      if (!transcript) return;

      const isFinal = message.is_final || false;
      const speechFinal = message.speech_final || false;

      // Update accumulating transcript (for UtteranceEnd fallback)
      if (transcript) {
        this.currentTranscript = transcript;
      }

      // CASE 1: Standard endpointing (clean audio, normal silence detection)
      if (isFinal && speechFinal) {
        // Only fire if we haven't already fired for this utterance
        if (!this.currentUtteranceFired) {
          this.fireTranscript(this.currentTranscript);
          this.currentUtteranceFired = true;
        }
        // Clear accumulated transcript
        this.currentTranscript = "";
      } else if (this.interimResults && !isFinal) {
        // Partial/interim transcript (just update display, don't fire)
        if (this.onPartialCallback) {
          this.onPartialCallback(transcript);
        }
      }
    }

    // CASE 2: UtteranceEnd (noisy phone lines, word-gap detection)
    // This fires when no new words detected for utterance_end_ms (1000ms)
    if (message.type === "UtteranceEnd") {
      // Only fire if we have a transcript AND haven't already fired for this utterance
      if (this.currentTranscript.length > 0 && !this.currentUtteranceFired) {
        this.fireTranscript(this.currentTranscript);
      }
      // Clear accumulated transcript and reset flag for next utterance
      this.currentTranscript = "";
      this.currentUtteranceFired = false;
    }

    // Handle speech start detection
    if (message.type === "SpeechStarted") {
      // Reset flag when new speech starts
      this.currentUtteranceFired = false;
      if (this.onSpeechStartCallback) {
        this.onSpeechStartCallback();
      }
    }

    // Handle metadata/errors
    if (message.type === "Metadata") {
      // console.log("[deepgram-stt] Metadata:", message);
    }
    if (message.type === "Error") {
      console.error("[deepgram-stt] Error:", message);
    }
  }

  private flushAudioBuffer(): void {
    if (this.audioBuffer.length > 0 && this.ws && this.connected) {
      console.log(`[deepgram-stt] Flushing ${this.audioBuffer.length} buffered packets`);
      for (const packet of this.audioBuffer) {
        this.ws.send(packet);
      }
      this.audioBuffer = [];
    }
  }

  sendAudio(audio: Buffer): void {
    if (!this.ws || !this.connected) {
      // Buffer audio instead of throwing error
      this.audioBuffer.push(audio);
      // Prevent memory leak - keep only last 100 packets (~2 seconds)
      if (this.audioBuffer.length > 100) {
        this.audioBuffer.shift();
      }
      return;
    }

    // Send current audio (buffer is flushed in connect())
    this.ws.send(audio);
  }

  async waitForTranscript(timeoutMs = 10000): Promise<string> {
    // Return queued transcript if available
    if (this.transcriptQueue.length > 0) {
      return this.transcriptQueue.shift()!;
    }

    // Wait for next transcript
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.transcriptResolvers.indexOf(resolve);
        if (index >= 0) {
          this.transcriptResolvers.splice(index, 1);
        }
        reject(new Error("Transcript timeout"));
      }, timeoutMs);

      this.transcriptResolvers.push((transcript: string) => {
        clearTimeout(timer);
        resolve(transcript);
      });
    });
  }

  onPartial(callback: (partial: string) => void): void {
    this.onPartialCallback = callback;
  }

  onTranscript(callback: (transcript: string) => void): void {
    this.onTranscriptCallback = callback;
  }

  onSpeechStart(callback: () => void): void {
    this.onSpeechStartCallback = callback;
  }

  private async attemptReconnect(): Promise<void> {
    if (this.closed || this.explicitClose || this.reconnecting) return;

    this.reconnecting = true;

    if (this.reconnectAttempts >= DeepgramSTTSessionImpl.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[deepgram-stt] Max reconnect attempts (${DeepgramSTTSessionImpl.MAX_RECONNECT_ATTEMPTS}) reached`,
      );
      this.closed = true;
      this.reconnecting = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10000); // Exponential backoff, max 10s

    console.log(
      `[deepgram-stt] Reconnecting ${this.reconnectAttempts}/${DeepgramSTTSessionImpl.MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`,
    );

    await new Promise((r) => setTimeout(r, delay));

    try {
      await this.connect();
      console.log("[deepgram-stt] Reconnection successful");
      this.reconnectAttempts = 0; // Reset on successful reconnection
      this.reconnecting = false;
    } catch (err) {
      console.error("[deepgram-stt] Reconnection failed:", err);
      this.reconnecting = false;
      void this.attemptReconnect(); // Try again
    }
  }

  close(): void {
    this.explicitClose = true; // Mark as intentional close
    if (this.ws) {
      // Send close frame to indicate end of audio
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.closed = true;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
