import type { Agent } from "@/stores/session-store";

export interface TerminalPromptAgentSelectionInput {
  agents: Iterable<Agent>;
  workspaceId: string;
  workspaceDirectory: string;
  focusedAgentId: string | null;
}

function isAgentInWorkspace(
  agent: Agent,
  workspaceId: string,
  workspaceDirectory: string,
): boolean {
  if (agent.archivedAt) {
    return false;
  }
  if (agent.workspaceId) {
    return agent.workspaceId === workspaceId;
  }
  return agent.cwd === workspaceDirectory;
}

function pickById(agents: Agent[], agentId: string | null | undefined): Agent | null {
  if (!agentId) {
    return null;
  }
  return agents.find((agent) => agent.id === agentId) ?? null;
}

/**
 * The terminal tab does not own an agent. "Current agent" therefore resolves to
 * the workspace's focused agent, then the workspace agent with the most recent
 * activity.
 */
export function selectTerminalPromptAgent(input: TerminalPromptAgentSelectionInput): Agent | null {
  const agents = [...input.agents]
    .filter((agent) => isAgentInWorkspace(agent, input.workspaceId, input.workspaceDirectory))
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());

  return pickById(agents, input.focusedAgentId) ?? agents[0] ?? null;
}
