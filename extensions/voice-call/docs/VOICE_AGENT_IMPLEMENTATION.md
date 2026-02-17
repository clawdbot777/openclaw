# Voice Agent API Implementation Plan

## Summary

Build Voice Agent API support for OpenClaw's voice-call plugin, starting with Deepgram Agent API, while maintaining backwards compatibility with legacy STT+TTS mode.

---

## Goals

1. ✅ **Backwards compatible** — Existing configs work without changes
2. ✅ **Cleaner architecture** — Unified agent API vs manual coordination
3. ✅ **Better performance** — 50% latency reduction, better turn detection
4. ✅ **Extensible** — Easy to add Retell, Vapi, future providers
5. ✅ **Production ready** — Error handling, reconnection, logging

---

## Repository Setup

### Branch Strategy

```bash
# 1. Sync openclaw/openclaw → clawdbot777/openclaw
# 2. Create fresh feature branch from main
git checkout main
git pull upstream main
git push origin main
git checkout -b feature/voice-agent-api

# 3. Implement changes
# 4. Test, iterate
# 5. Open PR when stable
```

### Test Environment

- **Repo:** `clawdbot777/openclaw`
- **Branch:** `feature/voice-agent-api`
- **Test:** Local Docker build + Twilio calls
- **Iterate:** Push → Pull → Rebuild → Test → Repeat

---

## Phase 1: Core Infrastructure

### 1.1 Create Provider Interface

**File:** `extensions/voice-call/src/providers/voice-agent/base.ts`

```typescript
/**
 * Base interface for Voice Agent API providers.
 * Providers handle unified STT→LLM→TTS pipeline.
 */
export interface IVoiceAgentProvider {
  /** Connect to agent service */
  connect(config: VoiceAgentConfig): Promise<void>;
  
  /** Send audio chunk (mu-law or linear16) */
  sendAudio(audio: Buffer): void;
  
  /** Update agent settings (prompt, voice, etc.) */
  updateSettings(settings: Partial<VoiceAgentSettings>): Promise<void>;
  
  /** Inject text to agent (for tool results, etc.) */
  injectText(text: string, role: "user" | "assistant"): Promise<void>;
  
  /** Request agent to speak (without user input) */
  speak(text: string): Promise<void>;
  
  /** Gracefully close connection */
  close(): Promise<void>;
  
  /** Check if connected */
  isConnected(): boolean;
  
  /** Event emitter */
  on(event: VoiceAgentEvent, handler: (...args: any[]) => void): void;
  off(event: VoiceAgentEvent, handler: (...args: any[]) => void): void;
}

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

export interface VoiceAgentConfig {
  provider: string;
  apiKey?: string;
  agent: {
    language: string;
    listen: { model: string; [key: string]: any };
    think: {
      provider: string;
      model: string;
      prompt?: string;
      [key: string]: any;
    };
    speak: { model: string; [key: string]: any };
    greeting?: string;
  };
  audio: {
    input: { encoding: string; sample_rate: number };
    output: { encoding: string; sample_rate: number; container: string };
  };
}

export interface VoiceAgentSettings {
  prompt?: string;
  greeting?: string;
  voice?: string;
}
```

### 1.2 Create Type Definitions

**File:** `extensions/voice-call/src/providers/voice-agent/types.ts`

```typescript
/** Event payloads from agent providers */

export interface WelcomeEvent {
  type: "Welcome";
  version?: string;
}

export interface SettingsAppliedEvent {
  type: "SettingsApplied";
}

export interface UserStartedSpeakingEvent {
  type: "UserStartedSpeaking";
}

export interface ConversationTextEvent {
  type: "ConversationText";
  role: "user" | "assistant";
  content: string;
}

export interface AgentThinkingEvent {
  type: "AgentThinking";
  content?: string;
}

export interface AgentStartedSpeakingEvent {
  type: "AgentStartedSpeaking";
  totalLatency?: number;
}

export interface AudioEvent {
  type: "Audio";
  data: Buffer;
}

export interface AgentAudioDoneEvent {
  type: "AgentAudioDone";
}

export interface ErrorEvent {
  type: "Error";
  code: string;
  message: string;
  description?: string;
}

export interface CloseEvent {
  type: "Close";
  code?: number;
  reason?: string;
}

export type VoiceAgentEventPayload =
  | WelcomeEvent
  | SettingsAppliedEvent
  | UserStartedSpeakingEvent
  | ConversationTextEvent
  | AgentThinkingEvent
  | AgentStartedSpeakingEvent
  | AudioEvent
  | AgentAudioDoneEvent
  | ErrorEvent
  | CloseEvent;
```

### 1.3 Create Config Schema

**File:** `extensions/voice-call/src/config-agent.ts`

```typescript
import { z } from "zod";

export const VoiceProviderTypeSchema = z.enum(["legacy-stt-tts", "voice-agent-api"]);
export type VoiceProviderType = z.infer<typeof VoiceProviderTypeSchema>;

export const VoiceAgentApiConfigSchema = z
  .object({
    provider: z.enum(["deepgram-agent"]).default("deepgram-agent"),
    apiKey: z.string().min(1).optional(),
    agent: z.object({
      language: z.string().default("en"),
      listen: z.object({
        model: z.string().default("nova-3"),
      }),
      think: z.object({
        provider: z.enum(["open_ai", "anthropic", "custom"]).default("open_ai"),
        model: z.string().default("gpt-4o-mini"),
        prompt: z.string().optional(),
      }),
      speak: z.object({
        model: z.string().default("aura-2-helios-en"),
      }),
      greeting: z.string().optional(),
    }),
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
```

---

## Phase 2: Deepgram Implementation

### 2.1 Deepgram Agent Provider

**File:** `extensions/voice-call/src/providers/voice-agent/deepgram-agent.ts`

**Key features:**
- Use `@deepgram/sdk` Agent V1 API
- Handle all agent events (Welcome, ConversationText, etc.)
- Buffer audio chunks
- Reconnection logic
- Error handling

**Dependencies:**
```bash
npm install @deepgram/sdk@latest
```

**Implementation outline:**
```typescript
import { DeepgramClient } from "@deepgram/sdk";
import type { IVoiceAgentProvider, VoiceAgentConfig, VoiceAgentSettings } from "./base.js";
import EventEmitter from "events";

export class DeepgramVoiceAgentProvider extends EventEmitter implements IVoiceAgentProvider {
  private client: DeepgramClient;
  private connection: any; // DeepgramClient agent connection
  private config: VoiceAgentConfig;
  private connected = false;

  constructor() {
    super();
  }

  async connect(config: VoiceAgentConfig): Promise<void> {
    this.config = config;
    const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY;
    
    if (!apiKey) {
      throw new Error("Deepgram API key required");
    }

    this.client = new DeepgramClient(apiKey);
    this.connection = this.client.agent.v1.connect();

    // Setup event handlers
    this.connection.on("Welcome", (data: any) => {
      this.emit("welcome", data);
    });

    this.connection.on("SettingsApplied", () => {
      this.emit("settings_applied");
    });

    this.connection.on("UserStartedSpeaking", () => {
      this.emit("user_started_speaking");
    });

    this.connection.on("ConversationText", (data: any) => {
      this.emit("conversation_text", {
        role: data.role,
        content: data.content,
      });
    });

    this.connection.on("AgentThinking", (data: any) => {
      this.emit("agent_thinking", data);
    });

    this.connection.on("AgentStartedSpeaking", (data: any) => {
      this.emit("agent_started_speaking", data);
    });

    this.connection.on("Audio", (audioBuffer: Buffer) => {
      this.emit("audio", audioBuffer);
    });

    this.connection.on("AgentAudioDone", () => {
      this.emit("agent_audio_done");
    });

    this.connection.on("Error", (err: any) => {
      this.emit("error", err);
    });

    this.connection.on("Close", () => {
      this.connected = false;
      this.emit("close");
    });

    // Send initial settings
    await this.sendSettings();
    this.connected = true;
  }

  private async sendSettings(): Promise<void> {
    const settings = {
      audio: this.config.audio,
      agent: this.config.agent,
    };
    
    this.connection.configure(settings);
  }

  sendAudio(audio: Buffer): void {
    if (!this.connected) {
      throw new Error("Not connected");
    }
    this.connection.send(audio);
  }

  async updateSettings(settings: Partial<VoiceAgentSettings>): Promise<void> {
    // Update prompt, greeting, voice, etc.
    const update: any = {};
    
    if (settings.prompt) {
      update.agent = { ...this.config.agent };
      update.agent.think.prompt = settings.prompt;
    }
    
    if (settings.greeting) {
      update.agent = { ...this.config.agent };
      update.agent.greeting = settings.greeting;
    }
    
    this.connection.configure(update);
  }

  async injectText(text: string, role: "user" | "assistant"): Promise<void> {
    // Use Deepgram's injection API (if available)
    // Otherwise queue for next response
    console.warn("injectText not yet implemented for Deepgram");
  }

  async speak(text: string): Promise<void> {
    // Force agent to speak without user input
    // Use Deepgram's speak injection (if available)
    console.warn("speak not yet implemented for Deepgram");
  }

  async close(): Promise<void> {
    if (this.connection) {
      this.connection.finish();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

### 2.2 Provider Factory

**File:** `extensions/voice-call/src/providers/voice-agent/index.ts`

```typescript
import type { IVoiceAgentProvider, VoiceAgentConfig } from "./base.js";
import { DeepgramVoiceAgentProvider } from "./deepgram-agent.js";

export function createVoiceAgentProvider(config: VoiceAgentConfig): IVoiceAgentProvider {
  switch (config.provider) {
    case "deepgram-agent":
      return new DeepgramVoiceAgentProvider();
    default:
      throw new Error(`Unknown voice agent provider: ${config.provider}`);
  }
}

export * from "./base.js";
export * from "./types.js";
export { DeepgramVoiceAgentProvider };
```

---

## Phase 3: Call Handler Integration

### 3.1 Voice Agent Call Handler

**File:** `extensions/voice-call/src/voice-agent-handler.ts`

```typescript
/**
 * Call handler for Voice Agent API mode.
 * Manages conversation flow using unified agent provider.
 */
import type { IVoiceAgentProvider } from "./providers/voice-agent/index.js";
import type { VoiceCallConfig } from "./config.js";

export class VoiceAgentCallHandler {
  private agent: IVoiceAgentProvider;
  private config: VoiceCallConfig;
  private audioBuffer: Buffer[] = [];
  private conversationLog: Array<{ role: string; content: string }> = [];

  constructor(agent: IVoiceAgentProvider, config: VoiceCallConfig) {
    this.agent = agent;
    this.config = config;
    this.setupAgentListeners();
  }

  private setupAgentListeners(): void {
    this.agent.on("welcome", () => {
      console.log("[voice-agent] Connection established");
    });

    this.agent.on("settings_applied", () => {
      console.log("[voice-agent] Settings applied");
    });

    this.agent.on("conversation_text", (data: any) => {
      console.log(`[voice-agent] ${data.role}: ${data.content}`);
      this.conversationLog.push(data);
    });

    this.agent.on("audio", (audioBuffer: Buffer) => {
      this.audioBuffer.push(audioBuffer);
    });

    this.agent.on("agent_audio_done", () => {
      console.log("[voice-agent] Agent finished speaking");
      // Audio buffer ready to send to telephony provider
    });

    this.agent.on("error", (err: any) => {
      console.error("[voice-agent] Error:", err);
    });

    this.agent.on("close", () => {
      console.log("[voice-agent] Connection closed");
    });
  }

  async handleIncomingAudio(audio: Buffer): Promise<void> {
    this.agent.sendAudio(audio);
  }

  getAudioBuffer(): Buffer[] {
    return this.audioBuffer;
  }

  clearAudioBuffer(): void {
    this.audioBuffer = [];
  }

  getConversationLog(): Array<{ role: string; content: string }> {
    return this.conversationLog;
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
```

### 3.2 Update Main Config

**File:** `extensions/voice-call/src/config.ts`

Add to existing schema:

```typescript
import {
  VoiceProviderTypeSchema,
  VoiceAgentApiConfigSchema,
} from "./config-agent.js";

export const VoiceCallConfigSchema = z.object({
  // ... existing fields ...

  /** Voice provider type (legacy or agent API) */
  voiceProviderType: VoiceProviderTypeSchema.default("legacy-stt-tts"),

  /** Voice Agent API configuration */
  voiceAgentApi: VoiceAgentApiConfigSchema.optional(),
  
  // ... rest of schema ...
});
```

### 3.3 Route Calls Based on Provider Type

**File:** `extensions/voice-call/src/call-handler.ts` (or similar)

```typescript
import { createVoiceAgentProvider } from "./providers/voice-agent/index.js";
import { VoiceAgentCallHandler } from "./voice-agent-handler.js";
import type { VoiceCallConfig } from "./config.js";

export function createCallHandler(config: VoiceCallConfig) {
  if (config.voiceProviderType === "voice-agent-api" && config.voiceAgentApi) {
    // Use Voice Agent API mode
    const provider = createVoiceAgentProvider(config.voiceAgentApi);
    return new VoiceAgentCallHandler(provider, config);
  } else {
    // Use legacy STT + LLM + TTS mode
    return new LegacyCallHandler(config);
  }
}
```

---

## Phase 4: Testing

### 4.1 Unit Tests

**File:** `extensions/voice-call/src/providers/voice-agent/deepgram-agent.test.ts`

```typescript
describe("DeepgramVoiceAgentProvider", () => {
  it("should connect and emit welcome event", async () => {
    // Mock Deepgram SDK
    // Test connection flow
  });

  it("should send audio chunks", () => {
    // Test sendAudio()
  });

  it("should handle agent events", () => {
    // Test event emission
  });

  it("should reconnect on disconnect", () => {
    // Test reconnection logic
  });
});
```

### 4.2 Integration Tests

**Twilio call flow:**
1. Make test call
2. Speak test phrase
3. Verify agent responds
4. Test interruption
5. Verify clean hangup

**Log monitoring:**
```bash
docker logs -f openclaw-gateway-1 | grep -i "voice-agent\|deepgram"
```

---

## Phase 5: Documentation & PR

### 5.1 Update README

**File:** `extensions/voice-call/README.md`

Add section:
- Voice Agent API Overview
- Configuration examples
- Migration from legacy mode

### 5.2 Create Migration Guide

Already created: `VOICE_AGENT_MIGRATION.md`

### 5.3 Open Pull Request

**Title:** `feat(voice-call): Add Voice Agent API support (Deepgram, Retell, Vapi)`

**Description:**
- Overview of Voice Agent API architecture
- Benefits vs legacy mode
- Backwards compatibility guaranteed
- Testing performed
- Screenshots/demos of latency improvements

**PR Checklist:**
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Backwards compatible
- [ ] No breaking changes
- [ ] Example configs provided
- [ ] Migration guide included

---

## Timeline

| Phase | Tasks | Time Estimate |
|-------|-------|---------------|
| Phase 1 | Core infrastructure (interfaces, types, config) | 2-3 hours |
| Phase 2 | Deepgram provider implementation | 3-4 hours |
| Phase 3 | Call handler integration + routing | 2-3 hours |
| Phase 4 | Testing + iteration | 2-4 hours |
| Phase 5 | Documentation + PR | 1-2 hours |
| **Total** | | **10-16 hours** |

---

## Success Criteria

✅ **Functionality:**
- [ ] Agent connects successfully
- [ ] Audio streams bidirectionally
- [ ] Transcripts appear in logs
- [ ] Agent responds with voice
- [ ] Interruptions handled gracefully
- [ ] Clean disconnection on hangup

✅ **Performance:**
- [ ] Response latency <2s (target <1.5s)
- [ ] No audio dropouts
- [ ] Turn detection works reliably
- [ ] Phone noise doesn't break endpointing

✅ **Compatibility:**
- [ ] Legacy configs still work
- [ ] No breaking changes
- [ ] Migration path clear
- [ ] Rollback trivial

✅ **Code Quality:**
- [ ] TypeScript types complete
- [ ] Error handling robust
- [ ] Logging informative
- [ ] Tests pass
- [ ] Documentation complete

---

## Next Steps

1. ✅ Run `voice-agent-setup.sh` to create feature branch
2. 🚧 Implement Phase 1 (interfaces + config)
3. 🚧 Implement Phase 2 (Deepgram provider)
4. 🚧 Implement Phase 3 (call handler)
5. 🧪 Test with real calls
6. 📝 Document findings
7. 🚀 Open PR when stable

Ready to start coding! 🎉
