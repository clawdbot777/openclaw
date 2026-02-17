/**
 * Media Stream Configuration Builder
 *
 * Creates MediaStreamConfig for both legacy and Voice Agent API modes.
 * This integrates with webhook.ts to support both provider types.
 */

import type { MediaStreamConfig } from "./media-stream.js";
import type { VoiceCallConfig } from "./config.js";
import type { CallManager } from "./manager.js";
import { OpenAIRealtimeSTTProvider } from "./providers/stt-openai-realtime.js";
import { DeepgramSTTProvider } from "./providers/stt-deepgram.js";
import { isVoiceAgentApiMode } from "./voice-agent-mode.js";
import type { TwilioProvider } from "./providers/twilio.js";

/**
 * Build MediaStreamConfig based on voice provider type
 */
export function buildMediaStreamConfig(
  config: VoiceCallConfig,
  manager: CallManager,
  provider: any, // VoiceCallProvider
): MediaStreamConfig | null {
  if (!config.streaming?.enabled) {
    return null;
  }

  // Voice Agent API mode uses different initialization
  // (handled directly in media stream connection)
  if (isVoiceAgentApiMode(config)) {
    console.log("[voice-call] Media streaming in Voice Agent API mode");
    return buildVoiceAgentMediaStreamConfig(config, manager, provider);
  }

  // Legacy mode: OpenAI or Deepgram STT
  console.log("[voice-call] Media streaming in legacy mode");
  return buildLegacyMediaStreamConfig(config, manager, provider);
}

/**
 * Build legacy STT+TTS mode stream config
 */
function buildLegacyMediaStreamConfig(
  config: VoiceCallConfig,
  manager: CallManager,
  provider: any,
): MediaStreamConfig | null {
  const sttProviderType = config.streaming?.sttProvider || "openai-realtime";

  let sttProvider: any;

  if (sttProviderType === "openai-realtime") {
    const apiKey = config.streaming?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[voice-call] OpenAI streaming enabled but no API key found");
      return null;
    }

    sttProvider = new OpenAIRealtimeSTTProvider({
      apiKey,
      model: config.streaming?.sttModel,
      silenceDurationMs: config.streaming?.silenceDurationMs,
      vadThreshold: config.streaming?.vadThreshold,
    });
  } else if (sttProviderType === "deepgram") {
    const apiKey = config.streaming?.deepgramApiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      console.warn("[voice-call] Deepgram streaming enabled but no API key found");
      return null;
    }

    sttProvider = new DeepgramSTTProvider({
      apiKey,
      model: config.streaming?.deepgramModel || "nova-2",
      language: config.streaming?.deepgramLanguage || "en-US",
    });
  } else {
    console.warn(`[voice-call] Unknown STT provider: ${sttProviderType}`);
    return null;
  }

  return {
    sttProvider,
    voiceConfig: config, // Pass config for mode detection
    shouldAcceptStream: (params) => {
      const call = manager.getCallByProviderCallId(params.callId);
      if (!call) {
        console.warn(`[voice-call] Rejecting stream for unknown call: ${params.callId}`);
        return false;
      }
      return true;
    },
    onTranscript: (callId, transcript) => {
      console.log(`[voice-call] Transcript for ${callId}: ${transcript}`);
      manager.notifyTranscript(callId, transcript);
    },
    onPartialTranscript: (callId, partial) => {
      console.log(`[voice-call] Partial for ${callId}: ${partial}`);
    },
    onConnect: (callId, streamSid) => {
      console.log(`[voice-call] Media stream connected: ${callId} -> ${streamSid}`);
      if (provider.name === "twilio") {
        (provider as TwilioProvider).registerCallStream(callId, streamSid);
      }

      setTimeout(() => {
        manager.speakInitialMessage(callId).catch((err) => {
          console.warn(`[voice-call] Failed to speak initial message:`, err);
        });
      }, 500);
    },
    onSpeechStart: (callId) => {
      console.log(`[voice-call] Speech started for ${callId} (barge-in)`);
    },
    onDisconnect: (callId) => {
      console.log(`[voice-call] Media stream disconnected: ${callId}`);
      const disconnectedCall = manager.getCallByProviderCallId(callId);
      if (disconnectedCall) {
        console.log(`[voice-call] Auto-ending call ${disconnectedCall.callId} on stream disconnect`);
        void manager.endCall(disconnectedCall.callId).catch((err) => {
          console.warn(`[voice-call] Failed to auto-end call ${disconnectedCall.callId}:`, err);
        });
      }
      if (provider.name === "twilio") {
        (provider as TwilioProvider).unregisterCallStream(callId);
      }
    },
  };
}

/**
 * Build Voice Agent API mode stream config
 *
 * Note: In agent mode, the MediaStreamHandler still exists but uses
 * a different flow. The agent provider is initialized per-connection
 * in the media stream handler itself.
 */
function buildVoiceAgentMediaStreamConfig(
  config: VoiceCallConfig,
  manager: CallManager,
  provider: any,
): MediaStreamConfig {
  // For Voice Agent API mode, we still need an STT provider for the
  // MediaStreamConfig type, but it won't be used. We create a dummy one.
  const apiKey = process.env.OPENAI_API_KEY || "dummy";
  const dummySTT = new OpenAIRealtimeSTTProvider({
    apiKey,
    model: "gpt-4o-transcribe",
  });

  return {
    sttProvider: dummySTT, // Not used in agent mode
    voiceConfig: config, // Pass config for agent mode detection
    shouldAcceptStream: (params) => {
      const call = manager.getCallByProviderCallId(params.callId);
      if (!call) {
        console.warn(`[voice-agent] Rejecting stream for unknown call: ${params.callId}`);
        return false;
      }
      return true;
    },
    onTranscript: (callId, transcript) => {
      console.log(`[voice-agent] Transcript for ${callId}: ${transcript}`);
      manager.notifyTranscript(callId, transcript);
    },
    onPartialTranscript: (callId, partial) => {
      console.log(`[voice-agent] Partial for ${callId}: ${partial}`);
    },
    onConnect: (callId, streamSid) => {
      console.log(`[voice-agent] Media stream connected: ${callId} -> ${streamSid}`);
      if (provider.name === "twilio") {
        (provider as TwilioProvider).registerCallStream(callId, streamSid);
      }
      // Initial greeting handled by agent provider internally
    },
    onSpeechStart: (callId) => {
      console.log(`[voice-agent] User speaking on ${callId} (barge-in)`);
    },
    onDisconnect: (callId) => {
      console.log(`[voice-agent] Media stream disconnected: ${callId}`);
      const disconnectedCall = manager.getCallByProviderCallId(callId);
      if (disconnectedCall) {
        console.log(`[voice-agent] Auto-ending call ${disconnectedCall.callId} on stream disconnect`);
        void manager.endCall(disconnectedCall.callId).catch((err) => {
          console.warn(`[voice-agent] Failed to auto-end call ${disconnectedCall.callId}:`, err);
        });
      }
      if (provider.name === "twilio") {
        (provider as TwilioProvider).unregisterCallStream(callId);
      }
    },
  };
}
