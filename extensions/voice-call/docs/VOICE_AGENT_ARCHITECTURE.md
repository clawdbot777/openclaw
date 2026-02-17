# Voice Agent API Architecture

## Overview

OpenClaw's voice-call plugin supports two architectural patterns for voice interactions:

1. **Legacy Mode** (STT + LLM + TTS) — Separate components with manual coordination
2. **Voice Agent API Mode** — Unified provider handles STT→LLM→TTS pipeline

This document describes the Voice Agent API architecture and design decisions.

---

## Problem Statement

### Legacy Mode Challenges:
- **Manual turn-taking** — OpenClaw must detect when user stops speaking
- **No built-in VAD** — Voice Activity Detection handled in separate STT provider
- **Coordination complexity** — Must manually orchestrate: audio → transcript → LLM → TTS → audio
- **Latency issues** — Each step adds delay, no optimization across pipeline
- **Barge-in handling** — Interruptions require custom logic
- **Provider-specific quirks** — Phone line noise breaks endpointing

### Voice Agent API Solution:
- **Integrated turn-taking** — Provider handles EndOfTurn detection
- **Unified pipeline** — Single WebSocket connection for entire conversation
- **Optimized latency** — Provider can optimize across STT/LLM/TTS
- **Built-in barge-in** — Native interruption support
- **Production-ready** — Tested for telephony environments

---

## Architecture

### Provider Abstraction

```typescript
// Base interface all voice agent providers implement
interface IVoiceAgentProvider {
  /** Connect to agent service */
  connect(config: VoiceAgentConfig): Promise<void>;
  
  /** Send audio chunk */
  sendAudio(audio: Buffer): void;
  
  /** Update agent configuration (prompt, voice, etc.) */
  updateSettings(settings: Partial<VoiceAgentSettings>): Promise<void>;
  
  /** Inject text to agent (e.g., for tool results) */
  injectText(text: string, role: "user" | "assistant"): Promise<void>;
  
  /** Gracefully close connection */
  close(): Promise<void>;
  
  /** Event handlers */
  on(event: VoiceAgentEvent, handler: (...args: any[]) => void): void;
}

// Events emitted by agent providers
type VoiceAgentEvent =
  | "welcome"              // Connection established
  | "settings_applied"     // Configuration updated
  | "user_started_speaking" // User began talking (VAD)
  | "conversation_text"    // Transcript (partial or final)
  | "agent_thinking"       // LLM processing
  | "agent_started_speaking" // TTS generation started
  | "audio"                // Audio chunk received
  | "agent_audio_done"     // TTS complete
  | "error"                // Error occurred
  | "close";               // Connection closed
```

### Configuration

```typescript
// Top-level: Choose provider type
{
  "voiceProviderType": "voice-agent-api",  // or "legacy-stt-tts"
  
  // Agent API config (when voiceProviderType="voice-agent-api")
  "voiceAgentApi": {
    "provider": "deepgram-agent",
    "apiKey": "...",
    "agent": {
      "language": "en",
      "listen": { "model": "nova-3" },
      "think": {
        "provider": "open_ai",
        "model": "gpt-4o-mini",
        "prompt": "You are a helpful assistant..."
      },
      "speak": { "model": "aura-2-helios-en" },
      "greeting": "Hello! How can I help you?"
    },
    "audio": {
      "input": { "encoding": "linear16", "sample_rate": 24000 },
      "output": { "encoding": "linear16", "sample_rate": 24000, "container": "wav" }
    }
  },
  
  // Legacy config (when voiceProviderType="legacy-stt-tts")
  "streaming": { ... },
  "stt": { ... },
  "tts": { ... }
}
```

### Call Flow

**Legacy Mode:**
```
Inbound Call → Twilio WebSocket → OpenClaw
  ↓
STT Provider (Deepgram/OpenAI) → Transcript
  ↓
LLM (via response-generator.ts) → Response text
  ↓
TTS Provider (Deepgram/ElevenLabs) → Audio
  ↓
Twilio → Caller
```

**Voice Agent API Mode:**
```
Inbound Call → Twilio WebSocket → OpenClaw
  ↓
Voice Agent Provider (Deepgram/Retell/Vapi)
  [STT → LLM → TTS happens inside provider]
  ↓
Audio + Transcript events
  ↓
Twilio → Caller
```

---

## Provider Implementations

### 1. Deepgram Agent API (`deepgram-agent`)

**Features:**
- Flux STT with advanced turn detection
- Any LLM via API (OpenAI, Anthropic, etc.)
- Aura-2 TTS voices
- Sub-second latency
- Built-in barge-in

**Configuration:**
```json
{
  "provider": "deepgram-agent",
  "agent": {
    "listen": { "model": "nova-3" },
    "think": {
      "provider": "open_ai",
      "model": "gpt-4o-mini",
      "prompt": "..."
    },
    "speak": { "model": "aura-2-helios-en" }
  }
}
```

**Events Flow:**
1. `welcome` — Connection ready
2. `settings_applied` — Config confirmed
3. [User speaks] → `user_started_speaking`
4. `conversation_text` (role: "user") — Transcript
5. `agent_thinking` — LLM processing
6. `agent_started_speaking` — TTS started
7. `audio` (repeated) — Audio chunks
8. `conversation_text` (role: "assistant") — Agent's text
9. `agent_audio_done` — Response complete
10. [Repeat from step 3]

### 2. Future Providers

**Retell AI** (`retell-agent`)
- Similar API to Deepgram
- Focus on customer service use cases
- Built-in interruption handling

**Vapi** (`vapi-agent`)
- Unified voice agent platform
- Multiple voice/LLM options

**OpenAI Agent API** (`openai-agent`)
- If/when OpenAI releases unified agent API
- Would integrate with GPT-4o audio

---

## Backwards Compatibility

### Migration Strategy:

**Existing users (using legacy mode):**
- No changes required
- `voiceProviderType` defaults to `"legacy-stt-tts"`
- Existing `streaming`, `stt`, `tts` configs work as before

**New users:**
- Can choose either mode
- Agent API recommended for new deployments

**Configuration detection:**
```typescript
// Auto-detect mode from config
if (config.voiceAgentApi && config.voiceAgentApi.provider) {
  // Use agent API mode
  const agent = createVoiceAgentProvider(config.voiceAgentApi);
  return new VoiceAgentCallHandler(agent, config);
} else {
  // Use legacy mode
  const stt = createSTTProvider(config.streaming.sttProvider);
  const tts = createTTSProvider(config.tts.provider);
  return new LegacyCallHandler(stt, tts, config);
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure ✅
- [x] Define `IVoiceAgentProvider` interface
- [x] Create config schema for agent APIs
- [x] Add provider type detection logic

### Phase 2: Deepgram Integration 🚧
- [ ] Implement `DeepgramVoiceAgentProvider`
- [ ] Handle all agent events
- [ ] Audio buffering and streaming
- [ ] Error handling and reconnection

### Phase 3: Call Handler Integration 🔜
- [ ] Create `VoiceAgentCallHandler`
- [ ] Route calls based on `voiceProviderType`
- [ ] Preserve conversation state
- [ ] Handle interruptions

### Phase 4: Testing & Refinement 🔜
- [ ] Test with Twilio calls
- [ ] Verify latency improvements
- [ ] Test interruption handling
- [ ] Load testing

### Phase 5: Documentation & PR 🔜
- [ ] Update README with agent API examples
- [ ] Create migration guide
- [ ] Add provider implementation guide
- [ ] Open PR to openclaw/openclaw

---

## Design Decisions

### Why Not Force Agent API?

**Decision:** Keep legacy mode as default, agent API opt-in

**Reasons:**
1. **Backwards compatibility** — Don't break existing deployments
2. **Provider flexibility** — Some users may prefer specific STT/TTS combos
3. **Cost considerations** — Agent APIs may have different pricing
4. **Gradual adoption** — Let community validate before deprecating legacy

### Why Abstract Interface?

**Decision:** Create `IVoiceAgentProvider` instead of Deepgram-specific code

**Reasons:**
1. **Future-proof** — Easy to add Retell, Vapi, OpenAI agent APIs
2. **Testing** — Can mock providers for unit tests
3. **Maintainability** — Clear contract for what providers must implement
4. **Community contributions** — Others can add providers without core changes

### Why Keep Response Generator?

**Decision:** Legacy `response-generator.ts` still used in agent mode

**Reasons:**
1. **Workspace context** — Agent APIs don't load SOUL.md, USER.md, etc.
2. **Tool access** — OpenClaw tools (memory, web search, etc.) need to be available
3. **Consistency** — Same prompt engineering for legacy and agent modes
4. **Flexibility** — Can override agent LLM with OpenClaw's LLM routing

**How it works:**
- Agent API handles STT and TTS
- OpenClaw handles "think" (LLM) step via response-generator
- Agent's `think.provider: "custom"` delegates to OpenClaw

---

## Performance Considerations

### Latency Improvements:

**Legacy Mode:**
- STT latency: ~500-800ms (after silence detection)
- LLM latency: ~1-3s (depending on model)
- TTS latency: ~200-500ms (first audio chunk)
- **Total:** ~2-4 seconds

**Agent API Mode:**
- Combined latency: ~800-1500ms
- Optimized pipeline (parallel processing where possible)
- Eager EndOfTurn detection reduces perceived latency
- **Total:** ~1-2 seconds (50% improvement)

### Cost Considerations:

**Legacy Mode:**
- Pay per minute for STT
- Pay per token for LLM
- Pay per character for TTS
- Separate billing for each component

**Agent API Mode (Deepgram):**
- Bundled pricing (STT+TTS included)
- LLM billed separately (OpenAI, Anthropic, etc.)
- May be cheaper at scale due to optimization

---

## Security & Privacy

### API Key Management:
- Agent API keys stored in config or env vars
- Never logged or exposed in responses
- Rotate keys via config updates

### Audio Data:
- Streamed directly to provider (not stored by OpenClaw)
- Provider policies apply (check Deepgram/Retell TOS)
- Call logs store transcripts only (not audio)

### LLM Prompts:
- Agent system prompts configurable
- OpenClaw workspace context opt-in
- Sensitive data (MEMORY.md) not sent to agent by default

---

## References

- [Deepgram Voice Agent API](https://developers.deepgram.com/docs/voice-agent)
- [Deepgram Flux Documentation](https://developers.deepgram.com/docs/flux/agent)
- [OpenClaw Voice Call Plugin](../src/index.ts)
- [Legacy STT/TTS Providers](../src/providers/)

---

## Questions?

For implementation questions, see:
- [Provider Implementation Guide](./VOICE_AGENT_PROVIDERS.md)
- [Migration Guide](./VOICE_AGENT_MIGRATION.md)
- [OpenClaw Discord](https://discord.com/invite/clawd)
