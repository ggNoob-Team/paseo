import type { ArchifyDiagramType, ArchifyEvidenceAnchor } from "@getpaseo/protocol/messages";

const TYPE_INSTRUCTIONS: Record<ArchifyDiagramType, string> = {
  architecture:
    "System architecture overview: 8-12 core runtime components, one primary request/data path, external dependencies, and trust or ownership boundaries.",
  sequence:
    "Method call sequence: trace a real entry point through the concrete caller/callee steps, including parameters, return values, errors, and asynchronous work when supported by the code. Put exact function or method names in message labels.",
  dataflow:
    "Variable and data flow: identify the source values or fields, transformations, branching conditions, persistence, and consumers. Put exact variable, field, DTO, or schema names in node labels, sublabels, or tags.",
  workflow:
    "Business workflow: show actors or lanes, phases, the happy path, decisions, approvals, exceptions, and terminal outcomes. Put business step names in node labels.",
  lifecycle:
    "Lifecycle or state model: show states, transition events, retries, cancellation, and terminal outcomes.",
};

/**
 * The generator agent's instructions. It lives here rather than in the app
 * because the daemon owns the run: it scans the workspace, creates the agent,
 * and hands it this prompt.
 */
export function buildArchifyGenerationPrompt(input: {
  artifactPrefix: string;
  types: readonly ArchifyDiagramType[];
  request?: string;
  scope?: string;
  /** Anchors the user confirmed from the candidate list. */
  anchors?: readonly ArchifyEvidenceAnchor[];
  /** The deterministic pre-scan; without it the agent explores on its own. */
  evidenceDigest?: string;
}): string {
  const artifactLines = input.types.map((type, index) => {
    const artifactId = `${input.artifactPrefix}-${type}`;
    return `${index + 1}. ${type}: artifactId="${artifactId}", title="<specific title>", diagramType="${type}". Use a short title that names the analyzed flow, scope, or feature, not only the diagram type. ${TYPE_INSTRUCTIONS[type]}`;
  });
  const anchorLines = (input.anchors ?? []).map(
    (anchor) => `- [${anchor.kind}] ${anchor.label}${anchor.detail ? ` — ${anchor.detail}` : ""}`,
  );
  const evidenceDigest = input.evidenceDigest?.trim();
  return [
    evidenceDigest
      ? "Paseo already pre-scanned this repository. The evidence sheet below is authoritative: start from it, and read at most a few specific files when you need an exact symbol, signature, or line. Do not walk or search the repository to rediscover its structure."
      : "Use the `paseo-archify` skill to inspect the current repository and produce the requested Archify diagrams.",
    evidenceDigest ? `# Pre-scanned repository evidence\n${evidenceDigest}` : "",
    anchorLines.length
      ? `The user confirmed these anchors. Every requested diagram must cover them where that diagram type makes it meaningful; add only what the diagram needs for context:\n${anchorLines.join("\n")}`
      : "",
    "Use the `paseo-archify` skill to author the requested Archify diagrams.",
    "You are a read-only analysis agent: do not edit or create repository files. Deliver every artifact through the `archify_render` Paseo tool; never run the Archify CLI directly.",
    'For each artifact, read the matching Archify schema and example from the installed skill, author a valid JSON IR, set meta.quality_profile to "showcase" and meta.locale to "zh-CN", then call `archify_render` with the complete specification.',
    "Deliver the artifacts in the order listed, so the architecture diagram is available first.",
    "The generated labels must be searchable. Include exact code symbols, variable names, business step names, types, and source paths where the schema supports them.",
    input.scope?.trim()
      ? `Analysis scope: ${input.scope.trim()}`
      : "Analysis scope: the whole current workspace.",
    input.request?.trim() ? `Additional user requirements: ${input.request.trim()}` : "",
    "Create these artifacts:",
    ...artifactLines,
    "If `archify_render` returns validation diagnostics, repair the specification and call the tool again. Finish only after every requested artifact renders successfully.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
