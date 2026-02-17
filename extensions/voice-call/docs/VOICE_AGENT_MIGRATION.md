# Voice Agent API Migration Guide

This guide helps you migrate from legacy STT+TTS mode to Voice Agent API mode.

---

## Why Migrate?

**Benefits of Voice Agent API:**
- ⚡ **50% faster responses** — Optimized STT→LLM→TTS pipeline
- 🎯 **Better turn detection** — No more hanging on silence or false triggers
- 🛡️ **Built-in barge-in** — Natural interruptions without custom logic
- 📞 **Telephony-optimized** — Handles phone line noise, echo, etc.
- 🧩 **Simpler config** — One provider instead of coordinating three

---

## Migration Path

### Step 1: Check Current Config

**Legacy mode example:**
```json
{
  "plugins": {
    "entries": {
      "voice-call": {
        "config": {
          "streaming": {
            "enabled": true,
            "sttProvider": "deepgram",
            "ttsProvider": "deepgram",
            "deepgramModel": "nova-2",
            "deepgramTtsVoice": "aura-helios-en"
          },
          "responseModel": "bedrock-proxy/global.anthropic.claude-haiku-4-5-20251001-v1:0"
        }
      }
    }
  }
}
```

### Step 2: Convert to Agent API

**Agent API equivalent:**
```json
{
  "plugins": {
    "entries": {
      "voice-call": {
        "config": {
          "voiceProviderType": "voice-agent-api",
          "voiceAgentApi": {
            "provider": "deepgram-agent",
            "apiKey": "${DEEPGRAM_API_KEY}",
            "agent": {
              "language": "en",
              "listen": {
                "model": "nova-3"
              },
              "think": {
                "provider": "open_ai",
                "model": "gpt-4o-mini",
                "prompt": "You are Dave, a helpful voice assistant..."
              },
              "speak": {
                "model": "aura-2-helios-en"
              },
              "greeting": "Hey, it's Dave. What's up?"
            },
            "audio": {
              "input": {
                "encoding": "linear16",
                "sample_rate": 24000
              },
              "output": {
                "encoding": "linear16",
                "sample_rate": 24000,
                "container": "wav"
              }
            }
          }
        }
      }
    }
  }
}
```

### Step 3: Update System Prompt

**Legacy:**
- System prompt in `responseSystemPrompt`
- Generated per-response via `response-generator.ts`

**Agent API:**
- System prompt in `voiceAgentApi.agent.think.prompt`
- Set once during agent configuration

**Migration:**
```json
// OLD (legacy)
{
  "responseSystemPrompt": "You are Dave, a helpful assistant. Be concise."
}

// NEW (agent API)
{
  "voiceAgentApi": {
    "agent": {
      "think": {
        "prompt": "You are Dave, a helpful assistant. Be concise and conversational."
      }
    }
  }
}
```

**Tip:** Use `responseSystemPrompt` from your legacy config as the starting point for `think.prompt`.

### Step 4: Test & Iterate

1. **Make a test call** — Verify connection and basic responses
2. **Check latency** — Should be faster than legacy mode
3. **Test interruptions** — Speak over the agent, should handle gracefully
4. **Test silence** — Pause mid-sentence, should wait appropriately
5. **Check logs** — Look for agent events in `docker logs openclaw-gateway-1`

---

## Configuration Mapping

### STT Provider → Listen Model

| Legacy STT | Agent API Listen |
|------------|------------------|
| `deepgram` (nova-2) | `"listen": { "model": "nova-3" }` |
| `openai-realtime` | Use legacy mode (no agent API yet) |

### TTS Provider → Speak Model

| Legacy TTS | Agent API Speak |
|------------|-----------------|
| Deepgram `aura-helios-en` | `"speak": { "model": "aura-2-helios-en" }` |
| Deepgram `aura-asteria-en` | `"speak": { "model": "aura-2-asteria-en" }` |
| ElevenLabs | Use legacy mode (not supported in agent API) |
| OpenAI | Use legacy mode (not supported in agent API) |

### LLM Model → Think Provider

| Legacy Response Model | Agent API Think |
|-----------------------|-----------------|
| `openai/gpt-4o-mini` | `"think": { "provider": "open_ai", "model": "gpt-4o-mini" }` |
| `anthropic/claude-sonnet-4-5` | `"think": { "provider": "open_ai", "model": "gpt-4o-mini" }` * |
| `bedrock-proxy/...` | `"think": { "provider": "open_ai", "model": "gpt-4o-mini" }` * |

_* Deepgram Agent API currently only supports OpenAI LLMs. Use `"provider": "custom"` to route through OpenClaw's LLM (future feature)._

---

## Feature Comparison

| Feature | Legacy Mode | Agent API Mode |
|---------|-------------|----------------|
| **Turn detection** | Manual (VAD + silence timeout) | Built-in (Flux EndOfTurn) |
| **Barge-in** | Custom logic required | Native support |
| **Latency** | 2-4 seconds | 1-2 seconds |
| **Phone noise handling** | Requires UtteranceEnd workaround | Built-in |
| **LLM choice** | Any (OpenAI, Anthropic, Bedrock, etc.) | OpenAI only (or custom route) |
| **TTS choice** | Any (Deepgram, ElevenLabs, OpenAI) | Deepgram Aura only |
| **Workspace context** | Full (SOUL.md, USER.md, etc.) | Limited (via custom think) |
| **Tool access** | Full (memory, web search, etc.) | Limited (via function calling) |
| **Cost** | Pay-per-use STT + TTS + LLM | Bundled STT/TTS, separate LLM |

---

## Common Issues

### Issue 1: "Agent not responding"

**Symptoms:** Call connects, you speak, no response

**Causes:**
- Missing or invalid `DEEPGRAM_API_KEY`
- Wrong model names
- Network/firewall blocking WebSocket

**Fix:**
```bash
# Check logs
docker logs openclaw-gateway-1 | grep -i "deepgram\|agent\|error"

# Verify API key
echo $DEEPGRAM_API_KEY

# Test key manually
curl -H "Authorization: Token $DEEPGRAM_API_KEY" \
  https://api.deepgram.com/v1/projects
```

### Issue 2: "Audio cutting out"

**Symptoms:** Responses start but stop mid-sentence

**Causes:**
- Sample rate mismatch
- Container format incompatible with telephony provider
- Buffer overflow

**Fix:**
```json
{
  "audio": {
    "input": { "encoding": "linear16", "sample_rate": 24000 },
    "output": { "encoding": "linear16", "sample_rate": 24000, "container": "wav" }
  }
}
```

### Issue 3: "Agent interrupts itself"

**Symptoms:** Agent speaks, then cuts off and starts over

**Causes:**
- VAD threshold too sensitive
- Echo from speaker to microphone

**Fix:**
```json
{
  "agent": {
    "listen": {
      "model": "nova-3",
      "vad": { "threshold": 0.7 }  // Higher = less sensitive
    }
  }
}
```

### Issue 4: "Wrong LLM being used"

**Symptoms:** Responses don't match expected model behavior

**Current Limitation:**
Deepgram Agent API only supports OpenAI LLMs natively. To use Anthropic, Bedrock, etc., we need to implement custom think routing (coming soon).

**Workaround:**
Use OpenAI `gpt-4o-mini` or `gpt-4o` for now:
```json
{
  "think": {
    "provider": "open_ai",
    "model": "gpt-4o-mini"
  }
}
```

---

## Rollback Plan

If agent API mode doesn't work for you, rollback is simple:

**Option 1: Remove agent config**
```json
{
  // Remove this:
  // "voiceProviderType": "voice-agent-api",
  // "voiceAgentApi": { ... }
  
  // Keep this:
  "streaming": { "enabled": true, ... },
  "stt": { ... },
  "tts": { ... }
}
```

**Option 2: Explicit legacy mode**
```json
{
  "voiceProviderType": "legacy-stt-tts",
  "streaming": { "enabled": true, ... }
}
```

Gateway restart required: `openclaw gateway restart`

---

## Advanced: Custom LLM Routing

**Coming soon:** Route agent `think` through OpenClaw's LLM instead of directly to OpenAI.

**Benefits:**
- Use any OpenClaw-configured model (Anthropic, Bedrock, etc.)
- Access workspace context (SOUL.md, USER.md)
- Use OpenClaw tools (memory, web search)

**Config:**
```json
{
  "voiceAgentApi": {
    "agent": {
      "think": {
        "provider": "custom",
        "endpoint": "http://localhost:18789/voice-agent/think"
      }
    }
  }
}
```

**How it works:**
1. Agent sends transcript to OpenClaw endpoint
2. OpenClaw runs `response-generator.ts` with full context
3. Returns response text to agent
4. Agent synthesizes to speech

---

## Next Steps

1. ✅ Update config with agent API settings
2. ✅ Restart gateway: `openclaw gateway restart`
3. ✅ Make test call
4. ✅ Monitor logs: `docker logs -f openclaw-gateway-1`
5. ✅ Iterate on prompt, voice, settings
6. 🎉 Enjoy faster, more natural voice calls!

---

## Need Help?

- [Architecture Doc](./VOICE_AGENT_ARCHITECTURE.md) — How it works
- [Provider Guide](./VOICE_AGENT_PROVIDERS.md) — Adding new providers
- [OpenClaw Discord](https://discord.com/invite/clawd) — Community support
- [GitHub Issues](https://github.com/openclaw/openclaw/issues) — Bug reports
