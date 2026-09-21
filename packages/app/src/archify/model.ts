import type { ArchifyArtifactSummary, ArchifyDiagramType } from "@getpaseo/protocol/messages";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { FormPreferences } from "@/hooks/use-form-preferences";

export const ARCHIFY_INITIAL_TYPES: readonly ArchifyDiagramType[] = [
  "architecture",
  "sequence",
  "dataflow",
];

export const ARCHIFY_ALL_TYPES: readonly ArchifyDiagramType[] = [
  "architecture",
  "sequence",
  "dataflow",
  "workflow",
  "lifecycle",
];

export interface ArchifySearchEntry {
  key: string;
  kind: "node" | "relationship";
  label: string;
  detail: string;
  nodeIds: string[];
}

export interface ArchifyAgentConfig {
  provider: string;
  model?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function buildDetail(record: Record<string, unknown>, fallback: string): string {
  const detail = [
    readString(record, "type", "classification", "variant", "role"),
    readString(record, "sublabel", "note", "tag"),
  ].filter(Boolean);
  return detail.length > 0 ? detail.join(" · ") : fallback;
}

export function artifactTypeLabelKey(type: ArchifyDiagramType): string {
  return `workspace.archify.types.${type}`;
}

export function latestArchifyArtifactByType(
  artifacts: readonly ArchifyArtifactSummary[],
): Map<ArchifyDiagramType, ArchifyArtifactSummary> {
  const result = new Map<ArchifyDiagramType, ArchifyArtifactSummary>();
  for (const artifact of artifacts) {
    const current = result.get(artifact.type);
    if (!current || current.createdAt < artifact.createdAt) result.set(artifact.type, artifact);
  }
  return result;
}

export function resolveArchifyAgentConfig(input: {
  entries: readonly ProviderSnapshotEntry[] | undefined;
  preferences: FormPreferences;
}): ArchifyAgentConfig | null {
  const ready = (input.entries ?? []).filter(
    (entry) => entry.enabled && entry.status === "ready" && (entry.models?.length ?? 0) > 0,
  );
  if (ready.length === 0) return null;
  const preferredProvider = input.preferences.provider;
  const entry =
    ready.find((candidate) => candidate.provider === preferredProvider) ?? ready[0] ?? null;
  if (!entry) return null;
  const preferredModel = input.preferences.providerPreferences?.[entry.provider]?.model;
  const model =
    entry.models?.find((candidate) => candidate.id === preferredModel) ??
    entry.models?.find((candidate) => candidate.isDefault) ??
    entry.models?.[0];
  return {
    provider: entry.provider,
    ...(model?.id ? { model: model.id } : {}),
  };
}

export function buildArchifyGenerationPrompt(input: {
  artifactPrefix: string;
  types: readonly ArchifyDiagramType[];
  request?: string;
  scope?: string;
}): string {
  const typeInstructions: Record<ArchifyDiagramType, string> = {
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
  const artifactLines = input.types.map((type, index) => {
    const artifactId = `${input.artifactPrefix}-${type}`;
    return `${index + 1}. ${type}: artifactId="${artifactId}", title="${type}", diagramType="${type}". ${typeInstructions[type]}`;
  });
  return [
    "Use the `paseo-archify` skill to inspect the current repository and produce the requested Archify diagrams.",
    "You are a read-only analysis agent: do not edit or create repository files. Deliver every artifact through the `archify_render` Paseo tool; never run the Archify CLI directly.",
    'For each artifact, read the matching Archify schema and example from the installed skill, author a valid JSON IR, set meta.quality_profile to "showcase" and meta.locale to "zh-CN", then call `archify_render` with the complete specification.',
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

export function buildArchifySearchEntries(spec: Record<string, unknown>): ArchifySearchEntry[] {
  const entries: ArchifySearchEntry[] = [];
  const addNodes = (collection: unknown, fallback: string) => {
    for (const value of asArray(collection)) {
      const record = asRecord(value);
      if (!record) continue;
      const id = readString(record, "id");
      if (!id) continue;
      const label = readString(record, "label", "name") || id;
      entries.push({
        key: `node:${id}`,
        kind: "node",
        label,
        detail: buildDetail(record, fallback),
        nodeIds: [id],
      });
    }
  };
  const addRelationships = (
    collection: unknown,
    fallback: string,
    fromKey = "from",
    toKey = "to",
  ) => {
    for (const value of asArray(collection)) {
      const record = asRecord(value);
      if (!record) continue;
      const from = readString(record, fromKey);
      const to = readString(record, toKey);
      const id = readString(record, "id") || `${from}->${to}`;
      const label = readString(record, "label") || id;
      const nodeIds = [from, to].filter(Boolean);
      if (nodeIds.length === 0) continue;
      entries.push({
        key: `relationship:${id}`,
        kind: "relationship",
        label,
        detail: [from, to, buildDetail(record, fallback)].filter(Boolean).join(" · "),
        nodeIds,
      });
    }
  };

  const type = readString(spec, "diagram_type");
  if (type === "architecture") {
    addNodes(spec.components, "component");
    addRelationships(spec.connections, "connection");
  } else if (type === "workflow") {
    addNodes(spec.nodes, "step");
    addRelationships(spec.edges, "transition");
  } else if (type === "dataflow") {
    addNodes(spec.nodes, "data node");
    addRelationships(spec.flows, "flow");
  } else if (type === "lifecycle") {
    addNodes(spec.states, "state");
    addRelationships(spec.transitions, "transition");
  } else if (type === "sequence") {
    addNodes(spec.participants, "participant");
    addRelationships(spec.messages, "message");
  }
  return entries;
}

export function filterArchifySearchEntries(
  entries: readonly ArchifySearchEntry[],
  query: string,
  limit = 24,
): ArchifySearchEntry[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: Array<{ entry: ArchifySearchEntry; score: number }> = [];
  for (const entry of entries) {
    const haystack = `${entry.label} ${entry.detail} ${entry.key}`.toLowerCase();
    if (!tokens.every((token) => haystack.includes(token))) continue;
    const label = entry.label.toLowerCase();
    const score = tokens.reduce(
      (total, token) => {
        if (label === token) return total + 100;
        if (label.startsWith(token)) return total + 40;
        if (label.includes(token)) return total + 20;
        return total + 5;
      },
      entry.kind === "node" ? 2 : 0,
    );
    scored.push({ entry, score });
  }
  return scored
    .sort(
      (left, right) =>
        right.score - left.score || left.entry.label.localeCompare(right.entry.label),
    )
    .slice(0, limit)
    .map((item) => item.entry);
}

export function buildArchifyFocusScript(entry: ArchifySearchEntry): string {
  const ids = JSON.stringify(entry.nodeIds);
  const focusCall =
    entry.nodeIds.length > 1
      ? `Archify.focus.setMany(${ids}, { toggle: false });`
      : `Archify.focus.set(${JSON.stringify(entry.nodeIds[0] ?? "")}, { toggle: false });`;
  return `(function () {
    var attempts = 0;
    function run() {
      if (window.Archify && Archify.focus && Archify.view) {
        try {
          ${focusCall}
          Archify.view.reveal(${ids}, { includeNeighbors: true, reason: "finder" });
        } catch (_) {}
        return;
      }
      if (attempts++ < 20) setTimeout(run, 100);
    }
    run();
  })();`;
}
