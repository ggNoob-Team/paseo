import { describe, expect, it } from "vitest";
import {
  ARCHIFY_INITIAL_TYPES,
  buildArchifyFocusScript,
  buildArchifyGenerationPrompt,
  buildArchifySearchEntries,
  filterArchifySearchEntries,
  resolveArchifyAgentConfig,
  resolveArchifyArtifactTabLabel,
} from "./model";

describe("archify model", () => {
  it("requests architecture, method calls, and variable flow for the first run", () => {
    const prompt = buildArchifyGenerationPrompt({
      artifactPrefix: "archify-test",
      types: ARCHIFY_INITIAL_TYPES,
    });
    expect(prompt).toContain('artifactId="archify-test-architecture"');
    expect(prompt).toContain('artifactId="archify-test-sequence"');
    expect(prompt).toContain('artifactId="archify-test-dataflow"');
    expect(prompt).toContain("archify_render");
    expect(prompt).toContain("not only the diagram type");
  });

  it.each([
    ["codex", "full-access"],
    ["claude", "bypassPermissions"],
    ["copilot", "allow-all"],
    ["omp", "full"],
    ["opencode", "full-access"],
  ])("uses the provider's full-access mode for %s", (provider, modeId) => {
    const config = resolveArchifyAgentConfig({
      entries: [
        {
          provider,
          status: "ready",
          enabled: true,
          modes: [],
          models: [{ provider, id: "test-model", label: "Test model", isDefault: true }],
        },
      ],
      preferences: { provider },
    });
    expect(config).toEqual({ provider, model: "test-model", modeId });
  });

  it("recognizes a full-access mode on a dynamic provider", () => {
    const config = resolveArchifyAgentConfig({
      entries: [
        {
          provider: "custom-agent",
          status: "ready",
          enabled: true,
          modes: [{ id: "yolo", label: "Full Access" }],
          models: [{ provider: "custom-agent", id: "custom-model", label: "Custom model" }],
        },
      ],
      preferences: {},
    });
    expect(config?.modeId).toBe("yolo");
  });

  it("keeps generic artifacts distinguishable with ordinals", () => {
    expect(
      resolveArchifyArtifactTabLabel({
        artifact: {
          id: "sequence-1",
          type: "sequence",
          title: "sequence",
          createdAt: "2026-09-21T08:00:00.000Z",
          updatedAt: "2026-09-21T08:00:00.000Z",
          specBytes: 1,
          artifactBytes: 1,
          generatorAgentId: "agent",
          request: null,
          scope: null,
        },
        typeLabel: "Method calls",
        ordinal: 2,
      }),
    ).toBe("Method calls 2");
  });

  it("uses a specific artifact title when the agent provides one", () => {
    expect(
      resolveArchifyArtifactTabLabel({
        artifact: {
          id: "workflow-login",
          type: "workflow",
          title: "Login approval flow",
          createdAt: "2026-09-21T08:00:00.000Z",
          updatedAt: "2026-09-21T08:00:00.000Z",
          specBytes: 1,
          artifactBytes: 1,
          generatorAgentId: "agent",
          request: null,
          scope: null,
        },
        typeLabel: "Business flow",
        ordinal: 1,
      }),
    ).toBe("Login approval flow");
  });

  it("builds searchable nodes and relationships for a sequence", () => {
    const entries = buildArchifySearchEntries({
      diagram_type: "sequence",
      participants: [
        { id: "api", type: "backend", label: "API" },
        { id: "db", type: "database", label: "Postgres" },
      ],
      messages: [
        { id: "query-user", from: "api", to: "db", label: "findUserById", note: "returns User" },
      ],
    });
    expect(entries).toHaveLength(3);
    expect(filterArchifySearchEntries(entries, "findUser").map((entry) => entry.kind)).toEqual([
      "relationship",
    ]);
    expect(entries.find((entry) => entry.key === "relationship:query-user")?.nodeIds).toEqual([
      "api",
      "db",
    ]);
  });

  it("focuses every endpoint for a relationship result", () => {
    const script = buildArchifyFocusScript({
      key: "relationship:query-user",
      kind: "relationship",
      label: "findUserById",
      detail: "api · db",
      nodeIds: ["api", "db"],
    });
    expect(script).toContain('Archify.focus.setMany(["api","db"]');
    expect(script).toContain('Archify.view.reveal(["api","db"]');
  });
});
