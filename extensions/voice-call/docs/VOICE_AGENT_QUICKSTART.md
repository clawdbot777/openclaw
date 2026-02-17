# Voice Agent API - Quick Start

## Summary

We're rebuilding OpenClaw's voice-call plugin to use **Deepgram Voice Agent API** instead of manually coordinating STT + LLM + TTS. This fixes the delays, hanging responses, and turn-taking issues you've been experiencing.

---

## What's Been Prepared

### Documentation (in `/home/node/.openclaw/workspace/`)

1. **`VOICE_AGENT_ARCHITECTURE.md`** — Technical design and architecture
2. **`VOICE_AGENT_MIGRATION.md`** — How to migrate from legacy to agent API
3. **`VOICE_AGENT_IMPLEMENTATION.md`** — Step-by-step build plan
4. **`voice-agent-setup.sh`** — Script to setup git branch

### The Plan

**Phase 1:** Core infrastructure (interfaces, types, config schemas)
**Phase 2:** Deepgram Agent API provider implementation  
**Phase 3:** Call handler integration + routing logic
**Phase 4:** Testing and iteration
**Phase 5:** Documentation and PR

---

## How to Get Started

### Step 1: Setup Branch

From your `openclaw` repo (not the container):

```bash
cd ~/path/to/your/openclaw-repo
./voice-agent-setup.sh
```

This will:
1. Sync `openclaw/openclaw` → `clawdbot777/openclaw` main
2. Create `feature/voice-agent-api` branch
3. Prepare for code pushes

### Step 2: I'll Push Code

I'll create the implementation files and push to:
- **Repo:** `clawdbot777/openclaw`
- **Branch:** `feature/voice-agent-api`

### Step 3: You Pull & Test

```bash
git pull origin feature/voice-agent-api
docker compose build gateway
docker compose up -d gateway
```

### Step 4: Make a Test Call

Call your Twilio number and test:
- ✅ Connection
- ✅ Response latency
- ✅ Turn detection
- ✅ Interruptions
- ✅ Voice quality

### Step 5: Iterate

Report issues → I fix → Push → You pull → Rebuild → Test → Repeat

---

## Key Benefits

| Issue | Legacy Mode | Voice Agent API |
|-------|-------------|-----------------|
| **Hanging responses** | Manual silence detection fails with phone noise | Built-in Flux EndOfTurn detection |
| **2-4s delays** | Sequential STT → LLM → TTS | Optimized pipeline (~1-2s) |
| **No interruptions** | Custom barge-in logic | Native interruption support |
| **Clueless voice** | Workspace disabled (too slow) | Can route through OpenClaw LLM |

---

## What's Being Built

### New Files

```
extensions/voice-call/src/
  config-agent.ts                          # Agent API config schemas
  voice-agent-handler.ts                   # Call handler for agent mode
  providers/voice-agent/
    base.ts                                # IVoiceAgentProvider interface
    types.ts                               # Event types
    deepgram-agent.ts                      # Deepgram implementation
    index.ts                               # Provider factory
```

### Modified Files

```
extensions/voice-call/src/
  config.ts                                # Add voiceProviderType + voiceAgentApi
  (routing logic in main handler)          # Route to agent vs legacy
```

### Config Example

```json
{
  "plugins": {
    "entries": {
      "voice-call": {
        "config": {
          "voiceProviderType": "voice-agent-api",
          "voiceAgentApi": {
            "provider": "deepgram-agent",
            "agent": {
              "listen": { "model": "nova-3" },
              "think": { "provider": "open_ai", "model": "gpt-4o-mini" },
              "speak": { "model": "aura-2-helios-en" },
              "greeting": "Hey, it's Dave. What's up?"
            }
          }
        }
      }
    }
  }
}
```

---

## Timeline

**Today:** Documentation + branch setup  
**Tomorrow:** Implementation (Phases 1-3)  
**Next:** Testing and iteration until it works  
**Then:** Open PR, close #19346

---

## Questions?

- Check `VOICE_AGENT_ARCHITECTURE.md` for technical details
- Check `VOICE_AGENT_MIGRATION.md` for config examples
- Check `VOICE_AGENT_IMPLEMENTATION.md` for build plan

---

## Ready?

Run `./voice-agent-setup.sh` when you're ready and let me know. I'll start pushing code!
