import type { ArchifyArtifactSummary } from "@getpaseo/protocol/messages";

export interface ArchifyArtifactDelivery {
  workspaceId: string;
  generatorAgentId: string | null;
  artifact: ArchifyArtifactSummary;
}

type DeliveryListener = (delivery: ArchifyArtifactDelivery) => void;

/**
 * The generator agent delivers diagrams through the `archify_render` tool,
 * which runs inside the daemon. That render is the only honest signal a diagram
 * is finished, so the generation pipeline subscribes to it instead of polling
 * the artifact directory.
 */
const listeners = new Set<DeliveryListener>();

export function subscribeArchifyArtifactDeliveries(listener: DeliveryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyArchifyArtifactDelivered(delivery: ArchifyArtifactDelivery): void {
  for (const listener of listeners) {
    try {
      listener(delivery);
    } catch {
      // One subscriber must not break delivery reporting for the others.
    }
  }
}
