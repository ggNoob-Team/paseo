import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";

const BACKGROUND_GENERATOR_LABEL = "paseo.archify.generator";

type QuickInputCandidateAgent = Pick<Agent, "archivedAt" | "parentAgentId" | "labels">;
type QuickInputCandidateWorkspace = Pick<WorkspaceDescriptor, "archivingAt" | "background">;

export function isQuickInputCandidate(
  agent: QuickInputCandidateAgent,
  workspace: QuickInputCandidateWorkspace | undefined,
): boolean {
  if (agent.archivedAt || agent.parentAgentId !== null) {
    return false;
  }
  if (agent.labels[BACKGROUND_GENERATOR_LABEL] === "true") {
    return false;
  }
  return workspace?.background !== true && !workspace?.archivingAt;
}
