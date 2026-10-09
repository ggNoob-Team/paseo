import { describe, expect, test, vi } from "vitest";
import type { ArchifyArtifactSummary, ArchifyGenerationTask } from "@getpaseo/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { notifyArchifyArtifactDelivered } from "./delivery-events.js";
import { ArchifyGenerationService } from "./generation.js";

function artifactFor(task: ArchifyGenerationTask, index: number): ArchifyArtifactSummary {
  const diagram = task.diagrams[index]!;
  return {
    id: diagram.artifactId,
    type: diagram.type,
    title: `${diagram.type} diagram`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    specBytes: 10,
    artifactBytes: 20,
    generatorAgentId: task.agentId,
    request: null,
    scope: null,
  };
}

function createService(options?: {
  runGenerator?: (agentId: string, prompt: string) => Promise<{ canceled: boolean }>;
  stopGenerator?: (agentId: string) => Promise<void>;
  scanEvidence?: () => Promise<{
    revision: string;
    cached: boolean;
    digest: string;
  }>;
}) {
  const updates: ArchifyGenerationTask[] = [];
  const stopGenerator = options?.stopGenerator ?? vi.fn(async () => undefined);
  const service = new ArchifyGenerationService({
    paseoHome: "/tmp/paseo-archify-generation",
    workspaceRegistry: {
      get: async () => ({ workspaceId: "ws_1", cwd: "/repo" }) as never,
    },
    createAgent: (async () => ({
      snapshot: { id: "agent_1" },
    })) as never,
    agentManager: {} as never,
    logger: createTestLogger(),
    onTaskUpdated: (task) => updates.push(task),
    deps: {
      scanEvidence: (options?.scanEvidence ??
        (async () => ({ revision: "git:abc", cached: false, digest: "# evidence" }))) as never,
      runGenerator: options?.runGenerator ?? (async () => ({ canceled: false })),
      stopGenerator,
    },
  });
  return { service, updates, stopGenerator };
}

async function startedTask(service: ArchifyGenerationService) {
  const task = await service.start({
    workspaceId: "ws_1",
    types: ["architecture", "sequence"],
    provider: "codex",
  });
  await vi.waitFor(() => {
    expect(service.get("ws_1")?.agentId).toBe("agent_1");
  });
  return task;
}

describe("ArchifyGenerationService", () => {
  test("reports stages and completes once every diagram is delivered", async () => {
    let finishRun: (() => void) | null = null;
    const { service, updates } = createService({
      runGenerator: () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ canceled: false });
        }),
    });

    const started = await startedTask(service);
    expect(started.stage).toBe("scan");
    expect(updates.at(-1)?.stage).toBe("draw");

    const running = service.get("ws_1")!;
    notifyArchifyArtifactDelivered({
      workspaceId: "ws_1",
      generatorAgentId: "agent_1",
      artifact: artifactFor(running, 0),
    });
    // Delivered diagrams show up before the run ends.
    expect(service.get("ws_1")?.diagrams[0]?.status).toBe("delivered");
    expect(service.get("ws_1")?.diagrams[1]?.status).toBe("drawing");

    notifyArchifyArtifactDelivered({
      workspaceId: "ws_1",
      generatorAgentId: "agent_1",
      artifact: artifactFor(running, 1),
    });
    finishRun?.();

    await vi.waitFor(() => {
      expect(service.get("ws_1")?.status).toBe("completed");
    });
    const task = service.get("ws_1")!;
    expect(task.stage).toBe("done");
    expect(task.diagrams.map((diagram) => diagram.status)).toEqual(["delivered", "delivered"]);
    expect(task.finishedAt).not.toBeNull();
  });

  test("keeps what was delivered when the run ends without the rest", async () => {
    let finishRun: (() => void) | null = null;
    const { service } = createService({
      runGenerator: () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ canceled: false });
        }),
    });
    await startedTask(service);
    const running = service.get("ws_1")!;
    notifyArchifyArtifactDelivered({
      workspaceId: "ws_1",
      generatorAgentId: "agent_1",
      artifact: artifactFor(running, 0),
    });
    finishRun?.();

    await vi.waitFor(() => {
      expect(service.get("ws_1")?.status).toBe("failed");
    });
    const task = service.get("ws_1")!;
    expect(task.diagrams[0]?.status).toBe("delivered");
    expect(task.diagrams[1]?.status).toBe("failed");
    expect(task.error).toBeTruthy();
  });

  test("cancel keeps delivered diagrams and stops the agent", async () => {
    const { service, stopGenerator } = createService({
      runGenerator: () => new Promise(() => {}),
    });
    await startedTask(service);
    const running = service.get("ws_1")!;
    notifyArchifyArtifactDelivered({
      workspaceId: "ws_1",
      generatorAgentId: "agent_1",
      artifact: artifactFor(running, 0),
    });

    const canceled = await service.cancel(running.taskId);

    expect(canceled?.status).toBe("canceled");
    expect(canceled?.diagrams[0]?.status).toBe("delivered");
    expect(canceled?.diagrams[1]?.status).toBe("canceled");
    expect(stopGenerator).toHaveBeenCalledWith("agent_1");
  });

  test("rerun starts a fresh task for the diagrams that did not arrive", async () => {
    let finishRun: (() => void) | null = null;
    const { service } = createService({
      runGenerator: () =>
        new Promise((resolve) => {
          finishRun = () => resolve({ canceled: false });
        }),
    });
    await startedTask(service);
    const running = service.get("ws_1")!;
    notifyArchifyArtifactDelivered({
      workspaceId: "ws_1",
      generatorAgentId: "agent_1",
      artifact: artifactFor(running, 0),
    });
    finishRun?.();
    await vi.waitFor(() => {
      expect(service.get("ws_1")?.status).toBe("failed");
    });
    const failed = service.get("ws_1")!;

    const rerun = await service.rerun(failed.taskId);

    expect(rerun?.taskId).not.toBe(failed.taskId);
    expect(rerun?.diagrams.map((diagram) => diagram.type)).toEqual(["sequence"]);
    expect(rerun?.status).toBe("running");
    // The rerun is what the workspace now reports.
    expect(service.get("ws_1")?.taskId).toBe(rerun?.taskId);
  });

  test("a failed scan fails the task without creating an agent", async () => {
    const { service } = createService({
      scanEvidence: async () => {
        throw new Error("scan exploded");
      },
    });

    await service.start({
      workspaceId: "ws_1",
      types: ["architecture"],
      provider: "codex",
    });

    await vi.waitFor(() => {
      expect(service.get("ws_1")?.status).toBe("failed");
    });
    const task = service.get("ws_1")!;
    expect(task.error).toBe("scan exploded");
    expect(task.agentId).toBeNull();
    expect(task.diagrams[0]?.status).toBe("failed");
  });
});
