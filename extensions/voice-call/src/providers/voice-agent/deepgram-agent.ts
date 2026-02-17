/**
 * Deepgram Voice Agent Provider
 *
 * Implements IVoiceAgentProvider using Deepgram's Agent V1 API.
 * Handles unified STT→LLM→TTS pipeline with automatic turn detection.
 */

import { EventEmitter } from "node:events";
import type {
  IVoiceAgentProvider,
  VoiceAgentConfig,
  VoiceAgentSettings,
} from "./base.js";
import type {
  ConversationTextEvent,
  AgentThinkingEvent,
  AgentStartedSpeakingEvent,
} from "./types.js";

// Deepgram SDK types (will be imported when @deepgram/sdk is added)
interface DeepgramClient {
  agent: {
    v1: {
      connect(): DeepgramAgentConnection;
    };
  };
}

interface DeepgramAgentConnection {
  configure(settings: any): void;
  send(audio: Buffer): void;
  on(event: string, handler: (...args: any[]) => void): void;
  finish(): void;
}

/**
 * Deepgram Voice Agent Provider
 *
 * Features:
 * - Flux STT with advanced turn detection
 * - OpenAI LLM integration
 * - Aura-2 TTS voices
 * - Sub-second latency
 * - Built-in barge-in support
 */
export class DeepgramVoiceAgentProvider
  extends EventEmitter
  implements IVoiceAgentProvider
{
  private client: DeepgramClient | null = null;
  private connection: DeepgramAgentConnection | null = null;
  private config: VoiceAgentConfig | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    super();
  }

  async connect(config: VoiceAgentConfig): Promise<void> {
    this.config = config;
    const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Deepgram API key required (set DEEPGRAM_API_KEY or pass apiKey in config)",
      );
    }

    // Dynamically import Deepgram SDK
    // TODO: Add @deepgram/sdk to package.json dependencies
    let DeepgramClientConstructor: any;
    try {
      const deepgramModule = await import("@deepgram/sdk");
      DeepgramClientConstructor = deepgramModule.DeepgramClient;
    } catch (err) {
      throw new Error(
        "Deepgram SDK not installed. Run: npm install @deepgram/sdk",
      );
    }

    this.client = new DeepgramClientConstructor(apiKey);
    this.connection = this.client.agent.v1.connect();

    // Setup event handlers
    this.setupEventHandlers();

    // Send initial configuration
    await this.sendSettings();

    this.connected = true;
    console.log("[deepgram-agent] Connected successfully");
  }

  private setupEventHandlers(): void {
    if (!this.connection) {
      throw new Error("No connection established");
    }

    this.connection.on("Welcome", (data: any) => {
      console.log("[deepgram-agent] Welcome event received");
      this.emit("welcome", { type: "Welcome", version: data?.version });
    });

    this.connection.on("SettingsApplied", () => {
      console.log("[deepgram-agent] Settings applied");
      this.emit("settings_applied", { type: "SettingsApplied" });
    });

    this.connection.on("UserStartedSpeaking", () => {
      console.log("[deepgram-agent] User started speaking");
      this.emit("user_started_speaking", { type: "UserStartedSpeaking" });
    });

    this.connection.on("ConversationText", (data: any) => {
      console.log(`[deepgram-agent] ConversationText: ${data.role}: ${data.content}`);
      const event: ConversationTextEvent = {
        type: "ConversationText",
        role: data.role,
        content: data.content,
      };
      this.emit("conversation_text", event);
    });

    this.connection.on("AgentThinking", (data: any) => {
      console.log("[deepgram-agent] Agent thinking");
      const event: AgentThinkingEvent = {
        type: "AgentThinking",
        content: data?.content,
      };
      this.emit("agent_thinking", event);
    });

    this.connection.on("AgentStartedSpeaking", (data: any) => {
      console.log(
        `[deepgram-agent] Agent started speaking (latency: ${data?.totalLatency}ms)`,
      );
      const event: AgentStartedSpeakingEvent = {
        type: "AgentStartedSpeaking",
        totalLatency: data?.totalLatency,
      };
      this.emit("agent_started_speaking", event);
    });

    this.connection.on("Audio", (audioBuffer: Buffer) => {
      // Audio chunks received from TTS
      this.emit("audio", { type: "Audio", data: audioBuffer });
    });

    this.connection.on("AgentAudioDone", () => {
      console.log("[deepgram-agent] Agent audio done");
      this.emit("agent_audio_done", { type: "AgentAudioDone" });
    });

    this.connection.on("Error", (err: any) => {
      console.error("[deepgram-agent] Error:", err);
      this.emit("error", {
        type: "Error",
        code: err.code || "UNKNOWN",
        message: err.message || String(err),
        description: err.description,
      });

      // Attempt reconnection on error
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.attemptReconnect();
      }
    });

    this.connection.on("Close", () => {
      console.log("[deepgram-agent] Connection closed");
      this.connected = false;
      this.emit("close", { type: "Close" });
    });
  }

  private async sendSettings(): Promise<void> {
    if (!this.connection || !this.config) {
      throw new Error("Not connected or no config available");
    }

    const settings = {
      audio: this.config.audio,
      agent: this.config.agent,
    };

    console.log("[deepgram-agent] Sending settings:", JSON.stringify(settings, null, 2));
    this.connection.configure(settings);
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000); // Exponential backoff, max 30s

    console.log(
      `[deepgram-agent] Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      if (this.config) {
        await this.connect(this.config);
        this.reconnectAttempts = 0; // Reset on successful reconnection
      }
    } catch (err) {
      console.error("[deepgram-agent] Reconnection failed:", err);
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.attemptReconnect();
      } else {
        console.error("[deepgram-agent] Max reconnection attempts reached");
        this.emit("error", {
          type: "Error",
          code: "MAX_RECONNECT_FAILED",
          message: "Failed to reconnect after maximum attempts",
        });
      }
    }
  }

  sendAudio(audio: Buffer): void {
    if (!this.connected || !this.connection) {
      throw new Error("Not connected to Deepgram");
    }
    this.connection.send(audio);
  }

  async updateSettings(settings: Partial<VoiceAgentSettings>): Promise<void> {
    if (!this.connection || !this.config) {
      throw new Error("Not connected");
    }

    const update: any = {};

    if (settings.prompt && this.config.agent.think) {
      update.agent = { ...this.config.agent };
      update.agent.think.prompt = settings.prompt;
    }

    if (settings.greeting) {
      update.agent = update.agent || { ...this.config.agent };
      update.agent.greeting = settings.greeting;
    }

    if (settings.voice && this.config.agent.speak) {
      update.agent = update.agent || { ...this.config.agent };
      update.agent.speak.model = settings.voice;
    }

    if (Object.keys(update).length > 0) {
      console.log("[deepgram-agent] Updating settings:", JSON.stringify(update, null, 2));
      this.connection.configure(update);
    }
  }

  async injectText(text: string, role: "user" | "assistant"): Promise<void> {
    // Deepgram Agent API may not support text injection directly
    // This would require a custom implementation or waiting for Deepgram to add it
    console.warn(
      `[deepgram-agent] injectText not yet implemented (role: ${role}, text: ${text})`,
    );
    // TODO: Implement when Deepgram adds text injection API
  }

  async speak(text: string): Promise<void> {
    // Force agent to speak without user input
    // Deepgram Agent API may not support this directly yet
    console.warn(`[deepgram-agent] speak not yet implemented (text: ${text})`);
    // TODO: Implement when Deepgram adds proactive speak API
  }

  async close(): Promise<void> {
    if (this.connection) {
      console.log("[deepgram-agent] Closing connection");
      this.connection.finish();
      this.connected = false;
      this.connection = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
