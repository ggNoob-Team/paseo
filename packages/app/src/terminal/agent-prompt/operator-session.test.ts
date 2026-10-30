import { describe, expect, it } from "vitest";
import {
  ensureTerminalOperatorSession,
  TerminalOperatorError,
  type TerminalOperatorClient,
  type TerminalOperatorSession,
} from "./operator-session";

function createClient(overrides: Partial<TerminalOperatorClient> = {}) {
  const calls = {
    create: [] as unknown[],
    setModel: [] as Array<[string, string | null]>,
    archive: [] as string[],
  };
  const client: TerminalOperatorClient = {
    supportsBackgroundWorkspaces: () => true,
    createWorkspace: async (input) => {
      calls.create.push(input);
      return { error: null, workspace: { id: "wks-operator" }, agent: { id: "agent-operator" } };
    },
    setAgentModel: async (agentId, modelId) => {
      calls.setModel.push([agentId, modelId]);
    },
    archiveWorkspace: async (workspaceId) => {
      calls.archive.push(workspaceId);
      return {};
    },
    ...overrides,
  };
  return { client, calls };
}

const baseInput = {
  provider: "codex" as const,
  model: "deepseek-flash",
  cwd: "/repo",
  projectId: "prj-1",
};

describe("ensureTerminalOperatorSession", () => {
  it("creates an isolated background workspace with its own agent", async () => {
    const { client, calls } = createClient();

    const session = await ensureTerminalOperatorSession({ client, existing: null, ...baseInput });

    expect(session).toEqual({
      workspaceId: "wks-operator",
      agentId: "agent-operator",
      provider: "codex",
      model: "deepseek-flash",
    });
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]).toMatchObject({
      background: true,
      source: { kind: "directory", path: "/repo", projectId: "prj-1" },
      agent: { config: { provider: "codex", cwd: "/repo", model: "deepseek-flash" } },
    });
  });

  it("reuses the same provider session and updates its model", async () => {
    const { client, calls } = createClient();
    const existing: TerminalOperatorSession = {
      workspaceId: "wks-operator",
      agentId: "agent-operator",
      provider: "codex",
      model: "deepseek-flash",
    };

    const session = await ensureTerminalOperatorSession({
      client,
      existing,
      ...baseInput,
      model: "deepseek-v4-pro",
    });

    expect(calls.create).toHaveLength(0);
    expect(calls.setModel).toEqual([["agent-operator", "deepseek-v4-pro"]]);
    expect(session.model).toBe("deepseek-v4-pro");
  });

  it("replaces the session when the provider changes", async () => {
    const { client, calls } = createClient();
    const existing: TerminalOperatorSession = {
      workspaceId: "wks-operator",
      agentId: "agent-operator",
      provider: "codex",
      model: "deepseek-flash",
    };

    const session = await ensureTerminalOperatorSession({
      client,
      existing,
      ...baseInput,
      provider: "claude",
      model: "sonnet",
    });

    expect(calls.archive).toEqual(["wks-operator"]);
    expect(calls.create).toHaveLength(1);
    expect(session.provider).toBe("claude");
  });

  it("fails clearly when the host cannot create background workspaces", async () => {
    const { client } = createClient({ supportsBackgroundWorkspaces: () => false });

    await expect(
      ensureTerminalOperatorSession({ client, existing: null, ...baseInput }),
    ).rejects.toMatchObject({ code: "unsupported_host" });
  });

  it("surfaces daemon creation errors", async () => {
    const { client } = createClient({
      createWorkspace: async () => ({ error: "nope", workspace: null, agent: null }),
    });

    const failure = ensureTerminalOperatorSession({ client, existing: null, ...baseInput });
    await expect(failure).rejects.toBeInstanceOf(TerminalOperatorError);
    await expect(failure).rejects.toMatchObject({ code: "create_failed", message: "nope" });
  });
});
