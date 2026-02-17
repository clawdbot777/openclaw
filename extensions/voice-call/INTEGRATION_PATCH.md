# Integration Patch Guide

This document describes the minimal changes needed to integrate Voice Agent API into the existing codebase.

## Files to Modify

### 1. `src/webhook.ts`

**Replace:** The `initializeMediaStreaming()` method

**Current:**
```typescript
private initializeMediaStreaming(): void {
  const apiKey = this.config.streaming?.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[voice-call] Streaming enabled but no OpenAI API key found");
    return;
  }

  const sttProvider = new OpenAIRealtimeSTTProvider({
    apiKey,
    model: this.config.streaming?.sttModel,
    silenceDurationMs: this.config.streaming?.silenceDurationMs,
    vadThreshold: this.config.streaming?.vadThreshold,
  });

  const streamConfig: MediaStreamConfig = {
    sttProvider,
    shouldAcceptStream: ...
    // ... rest of config
  };

  this.mediaStreamHandler = new MediaStreamHandler(streamConfig);
}
```

**New:**
```typescript
private initializeMediaStreaming(): void {
  // Use the new config builder
  const streamConfig = buildMediaStreamConfig(this.config, this.manager, this.provider);
  
  if (!streamConfig) {
    console.warn("[voice-call] Failed to build media stream config");
    return;
  }

  this.mediaStreamHandler = new MediaStreamHandler(streamConfig);
  console.log("[voice-call] Media streaming initialized");
}
```

**Add import:**
```typescript
import { buildMediaStreamConfig } from "./media-stream-config.js";
```

---

### 2. `src/media-stream.ts`

**Add:** Voice Agent support to `handleStart()` method

**After line where STT session is created**, add:

```typescript
// Check if Voice Agent API mode
import { isVoiceAgentApiMode, initializeVoiceAgentProvider } from "./voice-agent-mode.js";
import { setupAgentEventHandlers, VoiceAgentStreamSession } from "./media-stream-agent.js";

// In handleStart(), after creating sttSession:
let agentProvider: IVoiceAgentProvider | null = null;

// Check if we're in agent mode
if (isVoiceAgentApiMode(config)) {
  try {
    agentProvider = await initializeVoiceAgentProvider(config);
    console.log(`[MediaStream] Voice Agent provider initialized for call ${callSid}`);
  } catch (err) {
    console.error(`[MediaStream] Failed to initialize agent:`, err);
    // Fall back to legacy mode
  }
}
```

**In the session object:**
```typescript
const session: VoiceAgentStreamSession = {
  callId: callSid,
  streamSid,
  ws,
  mode: agentProvider ? "agent" : "legacy",
  sttSession: agentProvider ? undefined : sttSession,
  agentProvider: agentProvider || undefined,
};
```

**Setup agent event handlers if in agent mode:**
```typescript
if (agentProvider) {
  setupAgentEventHandlers(agentProvider, session, {
    onTranscript: (callId, transcript) => {
      this.config.onTranscript?.(callId, transcript);
    },
    onPartialTranscript: (callId, partial) => {
      this.config.onPartialTranscript?.(callId, partial);
    },
    onSpeechStart: (callId) => {
      this.config.onSpeechStart?.(callId);
    },
  });
}
```

**In the media event handler:**
```typescript
case "media":
  if (session && message.media?.payload) {
    const audioBuffer = Buffer.from(message.media.payload, "base64");
    
    if (session.mode === "agent" && session.agentProvider) {
      // Send to agent
      session.agentProvider.sendAudio(audioBuffer);
    } else if (session.sttSession) {
      // Legacy: send to STT
      session.sttSession.sendAudio(audioBuffer);
    }
  }
  break;
```

**In the stop handler:**
```typescript
case "stop":
  if (session) {
    if (session.mode === "agent" && session.agentProvider) {
      await session.agentProvider.close();
    }
    this.handleStop(session);
    session = null;
  }
  break;
```

---

## Alternative: Minimal Changes

If the above is too invasive, we can:

1. **Keep existing `media-stream.ts` as-is**
2. **Create `media-stream-agent.ts`** with a parallel implementation
3. **In `webhook.ts`**: detect mode and use appropriate handler:

```typescript
if (isVoiceAgentApiMode(this.config)) {
  this.mediaStreamHandler = new VoiceAgentMediaStreamHandler(streamConfig);
} else {
  this.mediaStreamHandler = new MediaStreamHandler(streamConfig);
}
```

This keeps legacy code untouched and minimizes risk.

---

## Testing the Changes

1. **Legacy mode test:**
   - Set `voiceProviderType: "legacy-stt-tts"`
   - Make test call
   - Verify existing functionality unchanged

2. **Agent mode test:**
   - Set `voiceProviderType: "voice-agent-api"`
   - Configure `voiceAgentApi` section
   - Make test call
   - Verify agent responds

3. **Regression test:**
   - Test both modes work
   - No crashes or errors
   - Clean resource cleanup

---

## Status

- ✅ Helper files created (media-stream-config.ts, media-stream-agent.ts)
- 🚧 Actual patches to webhook.ts and media-stream.ts
- 🔜 Testing and validation

---

Next: Apply these changes and test!
