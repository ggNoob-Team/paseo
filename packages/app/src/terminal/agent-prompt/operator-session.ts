import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { CreateWorkspaceRequestOptions } from "@getpaseo/client/internal/daemon-client";

export const TERMINAL_OPERATOR_TITLE = "Terminal operator";

const TERMINAL_OPERATOR_SYSTEM_PROMPT = [
  "You help the user operate a terminal that is already open on their machine.",
  "When asked to plan, reply with only the shell commands, one per line, and never execute them yourself.",
  "When asked to summarize command output, reply with a short, factual summary.",
].join("\n");

export interface TerminalOperatorSession {
  workspaceId: string;
  agentId: string;
  provider: AgentProvider;
  model: string | null;
}

export type TerminalOperatorErrorCode = "unsupported_host" | "create_failed";

export class TerminalOperatorError extends Error {
  constructor(
    readonly code: TerminalOperatorErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TerminalOperatorError";
  }
}

interface CreatedWorkspacePayload {
  error?: string | null;
  workspace: { id: string } | null;
  agent?: { id: string } | null;
}

export interface TerminalOperatorClient {
  supportsBackgroundWorkspaces(): boolean;
  createWorkspace(
    input: CreateWorkspaceRequestOptions,
    requestId?: string,
  ): Promise<CreatedWorkspacePayload>;
  setAgentModel(agentId: string, modelId: string | null): Promise<void>;
  archiveWorkspace(workspaceId: string, requestId?: string): Promise<unknown>;
}

export interface EnsureTerminalOperatorSessionInput {
  client: TerminalOperatorClient;
  existing: TerminalOperatorSession | null;
  provider: AgentProvider;
  model: string | null;
  cwd: string;
  projectId: string | null;
}

/**
 * The terminal operator must stay independent from the workspace's own agents,
 * so its conversation lives in an ephemeral background workspace. Background
 * workspaces are hidden from the normal sidebar listing and are archived when
 * the terminal pane closes.
 */
export async function ensureTerminalOperatorSession(
  input: EnsureTerminalOperatorSessionInput,
): Promise<TerminalOperatorSession> {
  const { client, existing, provider, model, cwd, projectId } = input;
  if (existing) {
    if (existing.provider === provider) {
      if (model && existing.model !== model) {
        await client.setAgentModel(existing.agentId, model);
      }
      return { ...existing, model: model ?? existing.model };
    }
    await archiveTerminalOperatorSession(client, existing);
  }

  if (!client.supportsBackgroundWorkspaces()) {
    throw new TerminalOperatorError(
      "unsupported_host",
      "The host does not support background workspaces",
    );
  }

  const payload = await client.createWorkspace({
    background: true,
    title: TERMINAL_OPERATOR_TITLE,
    source: {
      kind: "directory",
      path: cwd,
      ...(projectId ? { projectId } : {}),
    },
    agent: {
      config: {
        provider,
        cwd,
        ...(model ? { model } : {}),
        systemPrompt: TERMINAL_OPERATOR_SYSTEM_PROMPT,
        title: TERMINAL_OPERATOR_TITLE,
      },
      title: TERMINAL_OPERATOR_TITLE,
    },
    idempotencyKey: `terminal-operator-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });

  if (payload.error || !payload.workspace || !payload.agent) {
    throw new TerminalOperatorError(
      "create_failed",
      payload.error ?? "The daemon did not create the terminal operator session",
    );
  }

  return {
    workspaceId: payload.workspace.id,
    agentId: payload.agent.id,
    provider,
    model,
  };
}

export async function archiveTerminalOperatorSession(
  client: Pick<TerminalOperatorClient, "archiveWorkspace">,
  session: TerminalOperatorSession,
): Promise<void> {
  try {
    await client.archiveWorkspace(session.workspaceId);
  } catch {
    // The terminal is closing; a failed cleanup must not block the UI.
  }
}
