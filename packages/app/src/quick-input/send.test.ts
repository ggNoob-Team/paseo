import { describe, expect, it } from "vitest";
import { decideQuickInputSend, resolveQuickInputSendAttempt } from "./send";

describe("decideQuickInputSend", () => {
  it.each([
    ["steer", false, false, { kind: "send", activeTurnBehavior: "steer" }],
    ["interrupt", false, false, { kind: "send", activeTurnBehavior: "interrupt" }],
    ["queue", false, false, { kind: "send", activeTurnBehavior: "interrupt" }],
    ["queue", false, true, { kind: "queue" }],
    ["queue", true, true, { kind: "send", activeTurnBehavior: "interrupt" }],
  ] as const)(
    "resolves %s with pendingPermission=%s and running=%s",
    (sendBehavior, hasPendingPermission, isRunning, expected) => {
      expect(decideQuickInputSend({ sendBehavior, hasPendingPermission, isRunning })).toEqual(
        expected,
      );
    },
  );
});

describe("resolveQuickInputSendAttempt", () => {
  it("reuses the message id for a retry to the same target with the same text", () => {
    let nextId = 0;
    const createMessageId = () => `message-${++nextId}`;
    const first = resolveQuickInputSendAttempt(
      null,
      "server-a:agent-a",
      "deploy this",
      createMessageId,
    );

    expect(
      resolveQuickInputSendAttempt(first, "server-a:agent-a", "deploy this", createMessageId),
    ).toBe(first);
    expect(first.messageId).toBe("message-1");
  });

  it("creates a new message id when the target or text changes", () => {
    let nextId = 0;
    const createMessageId = () => `message-${++nextId}`;
    const first = resolveQuickInputSendAttempt(
      null,
      "server-a:agent-a",
      "deploy this",
      createMessageId,
    );
    const changedTarget = resolveQuickInputSendAttempt(
      first,
      "server-a:agent-b",
      "deploy this",
      createMessageId,
    );
    const changedText = resolveQuickInputSendAttempt(
      changedTarget,
      "server-a:agent-b",
      "deploy that",
      createMessageId,
    );

    expect(changedTarget.messageId).toBe("message-2");
    expect(changedText.messageId).toBe("message-3");
  });
});
