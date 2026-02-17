/**
 * Voice Agent Media Stream Extensions
 *
 * Extensions to MediaStreamHandler to support Voice Agent API mode.
 * This integrates with the existing media-stream.ts without breaking legacy mode.
 */

import type { IVoiceAgentProvider } from "./providers/voice-agent/index.js";
import type { VoiceCallConfig } from "./config.js";
import { isVoiceAgentApiMode, initializeVoiceAgentProvider } from "./voice-agent-mode.js";

/**
 * Extended stream session that supports both legacy and agent modes
 */
export interface VoiceAgentStreamSession {
  callId: string;
  streamSid: string;
  ws: any; // WebSocket
  mode: "legacy" | "agent";
  
  // Legacy mode fields
  sttSession?: any;
  
  // Agent mode fields
  agentProvider?: IVoiceAgentProvider;
  audioBuffer?: Buffer[];
}

/**
 * Initialize appropriate provider based on config
 */
export async function initializeStreamProvider(
  config: VoiceCallConfig,
  callId: string,
): Promise<{
  mode: "legacy" | "agent";
  sttSession?: any;
  agentProvider?: IVoiceAgentProvider;
}> {
  if (isVoiceAgentApiMode(config)) {
    console.log(`[voice-agent-stream] Initializing agent mode for call ${callId}`);
    const agentProvider = await initializeVoiceAgentProvider(config);
    
    if (!agentProvider) {
      throw new Error("Failed to initialize agent provider");
    }
    
    return { mode: "agent", agentProvider };
  } else {
    console.log(`[voice-agent-stream] Using legacy mode for call ${callId}`);
    // Legacy STT initialization happens in existing code
    return { mode: "legacy" };
  }
}

/**
 * Setup agent event handlers for a stream session
 */
export function setupAgentEventHandlers(
  agent: IVoiceAgentProvider,
  session: VoiceAgentStreamSession,
  callbacks: {
    onTranscript?: (callId: string, transcript: string) => void;
    onPartialTranscript?: (callId: string, partial: string) => void;
    onSpeechStart?: (callId: string) => void;
  },
): void {
  const { callId, ws } = session;
  
  // Initialize audio buffer
  session.audioBuffer = [];
  
  agent.on("welcome", () => {
    console.log(`[voice-agent-stream] Agent connected for call ${callId}`);
  });
  
  agent.on("settings_applied", () => {
    console.log(`[voice-agent-stream] Agent settings applied for call ${callId}`);
  });
  
  agent.on("user_started_speaking", () => {
    console.log(`[voice-agent-stream] User started speaking on call ${callId}`);
    callbacks.onSpeechStart?.(callId);
    
    // Clear audio buffer (barge-in)
    if (session.audioBuffer) {
      session.audioBuffer.length = 0;
    }
  });
  
  agent.on("conversation_text", (event: any) => {
    console.log(`[voice-agent-stream] ${event.role}: ${event.content} (call ${callId})`);
    
    if (event.role === "user") {
      callbacks.onPartialTranscript?.(callId, event.content);
    }
    
    // Final transcript when agent receives full user message
    if (event.role === "user") {
      callbacks.onTranscript?.(callId, event.content);
    }
  });
  
  agent.on("agent_thinking", () => {
    console.log(`[voice-agent-stream] Agent thinking for call ${callId}`);
  });
  
  agent.on("agent_started_speaking", (event: any) => {
    console.log(`[voice-agent-stream] Agent speaking (latency: ${event.totalLatency}ms, call ${callId})`);
    
    // Clear buffer for new response
    if (session.audioBuffer) {
      session.audioBuffer.length = 0;
    }
  });
  
  agent.on("audio", (event: any) => {
    // Receive audio from agent TTS
    const audioBuffer = event.data;
    
    if (!audioBuffer || audioBuffer.length === 0) {
      return;
    }
    
    // Store in buffer
    session.audioBuffer?.push(audioBuffer);
    
    // Send to Twilio immediately (streaming)
    sendAudioToTwilio(ws, audioBuffer);
  });
  
  agent.on("agent_audio_done", () => {
    console.log(`[voice-agent-stream] Agent finished speaking for call ${callId}`);
    
    if (session.audioBuffer && session.audioBuffer.length > 0) {
      const totalBytes = session.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      console.log(`[voice-agent-stream] Total audio sent: ${totalBytes} bytes`);
    }
  });
  
  agent.on("error", (event: any) => {
    console.error(`[voice-agent-stream] Agent error for call ${callId}:`, event);
    // TODO: Consider fallback to legacy mode on persistent errors
  });
  
  agent.on("close", () => {
    console.log(`[voice-agent-stream] Agent connection closed for call ${callId}`);
  });
}

/**
 * Send audio to Twilio via WebSocket
 */
function sendAudioToTwilio(ws: any, audioBuffer: Buffer): void {
  try {
    // Convert to mu-law if needed
    // Deepgram outputs linear16 by default, Twilio expects mu-law
    // TODO: Add conversion if needed, or configure Deepgram for mu-law output
    
    const payload = audioBuffer.toString("base64");
    
    const message = {
      event: "media",
      streamSid: "", // Twilio doesn't require this for outbound
      media: {
        payload,
      },
    };
    
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error("[voice-agent-stream] Error sending audio to Twilio:", err);
  }
}

/**
 * Handle incoming audio from Twilio (route to appropriate provider)
 */
export function handleIncomingAudio(
  session: VoiceAgentStreamSession,
  audioPayload: string,
): void {
  const audioBuffer = Buffer.from(audioPayload, "base64");
  
  if (session.mode === "agent" && session.agentProvider) {
    // Send to agent provider
    session.agentProvider.sendAudio(audioBuffer);
  } else if (session.mode === "legacy" && session.sttSession) {
    // Send to legacy STT (existing code path)
    session.sttSession.sendAudio(audioBuffer);
  } else {
    console.warn(`[voice-agent-stream] No provider available for call ${session.callId}`);
  }
}

/**
 * Cleanup session resources
 */
export async function cleanupStreamSession(session: VoiceAgentStreamSession): Promise<void> {
  console.log(`[voice-agent-stream] Cleaning up session for call ${session.callId}`);
  
  if (session.mode === "agent" && session.agentProvider) {
    try {
      await session.agentProvider.close();
      console.log(`[voice-agent-stream] Agent provider closed for call ${session.callId}`);
    } catch (err) {
      console.error(`[voice-agent-stream] Error closing agent provider:`, err);
    }
  }
  
  // Legacy cleanup happens in existing code
}
