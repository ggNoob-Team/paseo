import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import { resolveActiveSendBehavior, type SendBehavior } from "@/composer/input/state";
import { generateMessageId } from "@/types/stream";

export interface QuickInputSendAttempt {
  key: string;
  text: string;
  messageId: string;
}

export type QuickInputSendDecision =
  | { kind: "send"; activeTurnBehavior: ActiveTurnBehavior }
  | { kind: "queue" };

export function decideQuickInputSend(input: {
  sendBehavior: SendBehavior;
  hasPendingPermission: boolean;
  isRunning: boolean;
}): QuickInputSendDecision {
  const activeSendBehavior = resolveActiveSendBehavior(
    input.sendBehavior,
    input.hasPendingPermission,
  );
  if (activeSendBehavior === "queue" && input.isRunning) {
    return { kind: "queue" };
  }
  return {
    kind: "send",
    activeTurnBehavior: activeSendBehavior === "queue" ? "interrupt" : activeSendBehavior,
  };
}

export function resolveQuickInputSendAttempt(
  previous: QuickInputSendAttempt | null,
  key: string,
  text: string,
  createMessageId: () => string = generateMessageId,
): QuickInputSendAttempt {
  if (previous?.key === key && previous.text === text) {
    return previous;
  }
  return { key, text, messageId: createMessageId() };
}
