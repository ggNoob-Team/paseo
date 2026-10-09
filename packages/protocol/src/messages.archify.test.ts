import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("archify evidence protocol", () => {
  it("round-trips the evidence scan request and response", () => {
    const request = {
      type: "archify.evidence.scan.request",
      requestId: "r1",
      workspaceId: "ws_1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse({ ...request, force: true }).force).toBe(true);

    const evidence = {
      workspaceId: "ws_1",
      revision: "git:abc",
      scannedAt: "2026-10-09T00:00:00.000Z",
      cached: true,
      digest: "# Repository evidence\n",
      digestBytes: 22,
      truncated: false,
      facts: { packages: 3, entryPoints: 4, sourceFiles: 120 },
      anchors: [{ kind: "module" as const, label: "@fixture/core", detail: "packages/core" }],
    };
    const response = {
      type: "archify.evidence.scan.response",
      payload: { requestId: "r1", evidence },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("archify generation protocol", () => {
  const task = {
    taskId: "archify_task_1",
    workspaceId: "ws_1",
    status: "running" as const,
    stage: "draw" as const,
    agentId: "agent_1",
    startedAt: "2026-10-09T00:00:00.000Z",
    finishedAt: null,
    error: null,
    actionLine: "Delivered Architecture",
    evidenceRevision: "git:abc",
    evidenceCached: false,
    diagrams: [
      {
        type: "architecture" as const,
        artifactId: "archify-1-architecture",
        status: "delivered" as const,
        startedAt: "2026-10-09T00:00:01.000Z",
        finishedAt: "2026-10-09T00:00:09.000Z",
        error: null,
        artifact: {
          id: "archify-1-architecture",
          type: "architecture" as const,
          title: "Runtime shape",
          createdAt: "2026-10-09T00:00:09.000Z",
          updatedAt: "2026-10-09T00:00:09.000Z",
          specBytes: 10,
          artifactBytes: 20,
          generatorAgentId: "agent_1",
          request: null,
          scope: null,
        },
      },
    ],
  };

  it("round-trips the generation requests", () => {
    for (const message of [
      {
        type: "archify.generation.start.request",
        requestId: "r1",
        workspaceId: "ws_1",
        types: ["architecture"],
        provider: "codex",
      },
      {
        type: "archify.generation.cancel.request",
        requestId: "r2",
        taskId: "archify_task_1",
      },
      {
        type: "archify.generation.rerun.request",
        requestId: "r3",
        taskId: "archify_task_1",
      },
      { type: "archify.generation.get.request", requestId: "r4", workspaceId: "ws_1" },
    ]) {
      expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  it("round-trips the generation responses and the update push", () => {
    for (const message of [
      {
        type: "archify.generation.start.response",
        payload: { requestId: "r1", task },
      },
      {
        type: "archify.generation.cancel.response",
        payload: { requestId: "r2", task: null },
      },
      {
        type: "archify.generation.rerun.response",
        payload: { requestId: "r3", task },
      },
      {
        type: "archify.generation.get.response",
        payload: { requestId: "r4", task: null },
      },
      { type: "archify.generation.updated", payload: { task } },
    ]) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });
});
