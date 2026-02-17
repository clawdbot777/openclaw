/**
 * Voice Agent API Event Types
 *
 * Standardized event payloads emitted by voice agent providers.
 */

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
