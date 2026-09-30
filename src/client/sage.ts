// The live connection to Sage through the ElevenLabs browser SDK (@elevenlabs/client
// 1.25.0, typings checked). Decision: Sage is private (enable_auth), reached with a
// single-use conversation token over WebRTC; no overrides, so Sage always speaks as Jen and the
// Voice clone never enters the Conversation. Loaded lazily so the SDK only downloads
// when a Round starts.
import { Conversation } from "@elevenlabs/client";
import type { StartSession } from "./round";

export const startSageSession: StartSession = async (options) => {
  const conversation = await Conversation.startSession({
    conversationToken: options.conversationToken,
    connectionType: "webrtc",
    dynamicVariables: options.dynamicVariables,
    clientTools: options.clientTools,
    onModeChange: options.onModeChange,
    onDisconnect: options.onDisconnect,
    onError: (message) => options.onError(message),
  });
  return conversation;
};
