/**
 * Voice Agent Media Stream Handler (Proof of Concept)
 *
 * This is a simplified example showing how to integrate Voice Agent API
 * with Twilio media streams. The full implementation would go in media-stream.ts.
 */

import type { IVoiceAgentProvider } from "./providers/voice-agent/index.js";
import type { VoiceCallConfig } from "./config.js";
import { isVoiceAgentApiMode, initializeVoiceAgentProvider } from "./voice-agent-mode.js";

/**
 * Example: Handle inbound call with Voice Agent API
 *
 * This demonstrates the simplified flow when using agent mode:
 * 1. Initialize agent provider
 * 2. Send audio chunks to agent
 * 3. Receive audio back from agent
 * 4. Forward to Twilio
 *
 * Compare to legacy mode which requires:
 * 1. Initialize STT provider
 * 2. Send audio to STT
 * 3. Wait for transcript
 * 4. Call LLM via response-generator
 * 5. Wait for text response
 * 6. Send to TTS provider
 * 7. Wait for audio
 * 8. Forward to Twilio
 */
export async function handleCallWithVoiceAgent(config: VoiceCallConfig) {
  // Check if agent mode is enabled
  if (!isVoiceAgentApiMode(config)) {
    console.log("[example] Not in agent mode, using legacy flow");
    return;
  }

  // Initialize agent provider
  const agent = await initializeVoiceAgentProvider(config);
  if (!agent) {
    throw new Error("Failed to initialize agent provider");
  }

  // Buffer for outgoing audio (to Twilio)
  const audioBuffer: Buffer[] = [];

  // Setup event listeners
  agent.on("welcome", () => {
    console.log("[example] Agent connected and ready");
  });

  agent.on("user_started_speaking", () => {
    console.log("[example] User started speaking (barge-in)");
    // TODO: Stop any outgoing TTS playback
  });

  agent.on("conversation_text", (event: any) => {
    console.log(`[example] ${event.role}: ${event.content}`);
    // Could log to call transcript
  });

  agent.on("agent_thinking", () => {
    console.log("[example] Agent is thinking...");
  });

  agent.on("agent_started_speaking", (event: any) => {
    console.log(`[example] Agent started speaking (latency: ${event.totalLatency}ms)`);
    audioBuffer.length = 0; // Reset buffer for new response
  });

  agent.on("audio", (event: any) => {
    console.log(`[example] Received audio chunk: ${event.data.length} bytes`);
    audioBuffer.push(event.data);
    // TODO: Forward to Twilio immediately (streaming)
  });

  agent.on("agent_audio_done", () => {
    console.log("[example] Agent finished speaking");
    const totalAudio = Buffer.concat(audioBuffer);
    console.log(`[example] Total audio: ${totalAudio.length} bytes`);
    // TODO: Ensure all audio sent to Twilio
  });

  agent.on("error", (event: any) => {
    console.error(`[example] Agent error: ${event.code} - ${event.message}`);
    // TODO: Handle error gracefully, possibly fall back to legacy mode
  });

  agent.on("close", () => {
    console.log("[example] Agent connection closed");
    // TODO: Clean up resources
  });

  // Simulate receiving audio from Twilio
  // In real implementation, this comes from WebSocket
  console.log("[example] Simulating audio stream from Twilio...");

  // Example: Send initial greeting audio (if configured)
  if (config.voiceAgentApi?.agent.greeting) {
    console.log(`[example] Agent will speak greeting: "${config.voiceAgentApi.agent.greeting}"`);
    // Agent handles this internally on connect
  }

  // Example: User speaks
  console.log("[example] Simulating user audio...");
  const mockUserAudio = Buffer.alloc(8000); // 8KB of audio
  agent.sendAudio(mockUserAudio);

  // Agent will:
  // 1. Transcribe audio (STT)
  // 2. Generate response (LLM)
  // 3. Synthesize speech (TTS)
  // 4. Emit audio events
  // All automatically!

  // Wait a bit for processing
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Close agent when call ends
  await agent.close();
  console.log("[example] Example complete");
}

/**
 * Integration points for media-stream.ts:
 *
 * 1. In handleConnection():
 *    - Check if isVoiceAgentApiMode(config)
 *    - If yes: initialize agent provider
 *    - If no: use existing STT provider
 *
 * 2. On receiving media from Twilio:
 *    - If agent mode: call agent.sendAudio(buffer)
 *    - If legacy: call sttSession.sendAudio(buffer)
 *
 * 3. On agent "audio" event:
 *    - Forward to Twilio's media stream
 *    - Same mechanism as TTS audio in legacy mode
 *
 * 4. On agent "user_started_speaking" event:
 *    - Interrupt any ongoing TTS playback (barge-in)
 *
 * 5. On agent "error" or "close":
 *    - Clean up resources
 *    - Possibly fall back to legacy mode
 */
