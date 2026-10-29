import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { describe, expect, it } from "vitest";
import { groupTurnActivityBlocks, isShellToolCallItem } from "./turn-activity-blocks";

function shellCall(id: string, command: string): ToolCallItem {
  const detail: ToolCallDetail = {
    type: "shell",
    command,
    cwd: "/tmp/workspace",
    output: "",
    exitCode: 0,
  };
  return {
    kind: "tool_call",
    id: `tool-${id}`,
    timestamp: new Date(1_000),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "bash",
        status: "completed",
        error: null,
        detail,
      },
    },
  };
}

function readCall(id: string): ToolCallItem {
  return {
    kind: "tool_call",
    id: `tool-${id}`,
    timestamp: new Date(1_000),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "/tmp/workspace/README.md" },
      },
    },
  };
}

function commentary(id: string, text: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    messageId: id,
    text,
    timestamp: new Date(1000),
  };
}

describe("groupTurnActivityBlocks", () => {
  it("merges consecutive shell calls into one group", () => {
    const first = shellCall("1", "git status");
    const second = shellCall("2", "git diff");
    const third = shellCall("3", "git log");

    const blocks = groupTurnActivityBlocks([first, second, third]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "shell_group",
      items: [first, second, third],
    });
  });

  it("splits command runs around commentary", () => {
    const first = shellCall("1", "git status");
    const note = commentary("note", "Now checking the diff.");
    const second = shellCall("2", "git diff");

    const blocks = groupTurnActivityBlocks([first, note, second]);

    expect(blocks.map((block) => block.kind)).toEqual(["shell_group", "item", "shell_group"]);
  });

  it("keeps non-shell tools as individual rows", () => {
    const read = readCall("1");
    const shell = shellCall("2", "git status");

    const blocks = groupTurnActivityBlocks([read, shell]);

    expect(blocks.map((block) => block.kind)).toEqual(["item", "shell_group"]);
    expect(blocks[0]).toMatchObject({ kind: "item", item: read });
  });

  it("does not merge shell calls separated by another tool", () => {
    const blocks = groupTurnActivityBlocks([
      shellCall("1", "git status"),
      readCall("2"),
      shellCall("3", "git diff"),
    ]);

    expect(blocks.map((block) => block.kind)).toEqual(["shell_group", "item", "shell_group"]);
  });

  it("recognizes orchestrator bash calls as shell calls", () => {
    const orchestratorCall: StreamItem = {
      kind: "tool_call",
      id: "tool-orchestrator",
      timestamp: new Date(1_000),
      payload: {
        source: "orchestrator",
        data: {
          toolCallId: "orchestrator",
          toolName: "Bash",
          arguments: {},
          status: "completed",
        },
      },
    };

    expect(isShellToolCallItem(orchestratorCall)).toBe(true);
    expect(groupTurnActivityBlocks([orchestratorCall])[0]?.kind).toBe("shell_group");
  });
});
