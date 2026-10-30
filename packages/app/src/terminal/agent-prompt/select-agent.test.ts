import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { selectTerminalPromptAgent } from "./select-agent";

function agent(input: Partial<Agent> & Pick<Agent, "id" | "lastActivityAt">): Agent {
  return {
    serverId: "server-1",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle" },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: input.lastActivityAt,
    lastUserMessageAt: null,
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: input.id,
    cwd: "/repo",
    workspaceId: "workspace-1",
    model: null,
    parentAgentId: null,
    labels: {},
    ...input,
  } as Agent;
}

describe("selectTerminalPromptAgent", () => {
  const newer = agent({ id: "newer", lastActivityAt: new Date("2026-01-02T00:00:00Z") });
  const older = agent({ id: "older", lastActivityAt: new Date("2026-01-01T00:00:00Z") });

  it("falls back to the focused agent", () => {
    expect(
      selectTerminalPromptAgent({
        agents: [newer, older],
        workspaceId: "workspace-1",
        workspaceDirectory: "/repo",
        focusedAgentId: "older",
      })?.id,
    ).toBe("older");
  });

  it("falls back to the most recently active workspace agent", () => {
    expect(
      selectTerminalPromptAgent({
        agents: [older, newer],
        workspaceId: "workspace-1",
        workspaceDirectory: "/repo",
        focusedAgentId: null,
      })?.id,
    ).toBe("newer");
  });

  it("falls back to cwd when an agent has no workspace id", () => {
    const legacy = agent({
      id: "legacy",
      workspaceId: "",
      lastActivityAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(
      selectTerminalPromptAgent({
        agents: [legacy],
        workspaceId: "workspace-1",
        workspaceDirectory: "/repo",
        focusedAgentId: null,
      })?.id,
    ).toBe("legacy");
  });

  it("ignores agents from other workspaces and archived agents", () => {
    expect(
      selectTerminalPromptAgent({
        agents: [
          agent({
            id: "other-workspace",
            workspaceId: "workspace-2",
            lastActivityAt: new Date("2026-02-01T00:00:00Z"),
          }),
          agent({
            id: "archived",
            archivedAt: new Date("2026-02-01T00:00:00Z"),
            lastActivityAt: new Date("2026-02-01T00:00:00Z"),
          }),
        ],
        workspaceId: "workspace-1",
        workspaceDirectory: "/repo",
        focusedAgentId: null,
      }),
    ).toBeNull();
  });
});
