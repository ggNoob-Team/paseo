import { randomUUID } from "node:crypto";
import type { ArchifyDiagramType, ArchifyGenerationTask } from "@getpaseo/protocol/messages";
import type { AgentManager } from "../agent/agent-manager.js";
import { formatProviderModel, type BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import { subscribeArchifyArtifactDeliveries } from "./delivery-events.js";
import { scanArchifyEvidence } from "./evidence.js";
import { buildArchifyGenerationPrompt } from "./prompt.js";

interface GenerationLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface ArchifyGenerationStartInput {
  workspaceId: string;
  types: readonly ArchifyDiagramType[];
  request?: string;
  scope?: string;
  provider: string;
  model?: string;
  modeId?: string;
  forceScan?: boolean;
}

export interface ArchifyGenerationServiceOptions {
  paseoHome: string;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  createAgent: BoundCreateAgentCommand;
  agentManager: AgentManager;
  logger: GenerationLogger;
  /** Called on every task change; the daemon fans it out to subscribed clients. */
  onTaskUpdated?: (task: ArchifyGenerationTask) => void;
  deps?: {
    scanEvidence?: typeof scanArchifyEvidence;
    /** Test seam: run the generator turn without a real provider. */
    runGenerator?: (agentId: string, prompt: string) => Promise<{ canceled: boolean }>;
    stopGenerator?: (agentId: string) => Promise<void>;
  };
}

interface TaskRecord {
  task: ArchifyGenerationTask;
  input: ArchifyGenerationStartInput;
}

/**
 * Owns one Archify run from start to delivery: scan, create the generator
 * agent, follow what it delivers, and let the client cancel or rerun what did
 * not come back. Progress is pushed from events the daemon actually observes —
 * the evidence scan, the agent run, and the `archify_render` deliveries — not
 * from what a client guesses.
 */
export class ArchifyGenerationService {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly latestTaskIdByWorkspaceId = new Map<string, string>();
  private readonly scanEvidence: typeof scanArchifyEvidence;
  private readonly runGenerator: (
    agentId: string,
    prompt: string,
  ) => Promise<{ canceled: boolean }>;
  private readonly stopGenerator: (agentId: string) => Promise<void>;
  private readonly unsubscribeDeliveries: () => void;

  constructor(private readonly options: ArchifyGenerationServiceOptions) {
    this.scanEvidence = options.deps?.scanEvidence ?? scanArchifyEvidence;
    this.runGenerator =
      options.deps?.runGenerator ??
      (async (agentId, prompt) => {
        const result = await options.agentManager.runAgent(agentId, prompt);
        return { canceled: result.canceled === true };
      });
    this.stopGenerator =
      options.deps?.stopGenerator ??
      (async (agentId) => {
        await options.agentManager.cancelAgentRun(agentId);
      });
    this.unsubscribeDeliveries = subscribeArchifyArtifactDeliveries((delivery) => {
      if (!delivery.generatorAgentId) return;
      this.handleDelivery(delivery.generatorAgentId, delivery.artifact);
    });
  }

  dispose(): void {
    this.unsubscribeDeliveries();
  }

  get(workspaceId: string): ArchifyGenerationTask | null {
    const taskId = this.latestTaskIdByWorkspaceId.get(workspaceId);
    if (!taskId) return null;
    const record = this.tasks.get(taskId);
    return record ? snapshot(record.task) : null;
  }

  async start(input: ArchifyGenerationStartInput): Promise<ArchifyGenerationTask> {
    const taskId = `archify_task_${randomUUID()}`;
    const artifactPrefix = `archify-${taskId.slice(-12)}`;
    const now = new Date().toISOString();
    const task: ArchifyGenerationTask = {
      taskId,
      workspaceId: input.workspaceId,
      status: "running",
      stage: "scan",
      agentId: null,
      startedAt: now,
      finishedAt: null,
      error: null,
      actionLine: "Scanning the workspace",
      evidenceRevision: null,
      evidenceCached: null,
      diagrams: input.types.map((type) => ({
        type,
        artifactId: `${artifactPrefix}-${type}`,
        status: "pending",
        startedAt: null,
        finishedAt: null,
        error: null,
        artifact: null,
      })),
    };
    const record: TaskRecord = { task, input: { ...input, types: [...input.types] } };
    this.tasks.set(taskId, record);
    this.latestTaskIdByWorkspaceId.set(input.workspaceId, taskId);
    this.publish(task);
    void this.run(record).catch((error) => {
      this.options.logger.error({ err: error, taskId }, "Archify generation run failed");
    });
    return snapshot(task);
  }

  async cancel(taskId: string): Promise<ArchifyGenerationTask | null> {
    const record = this.tasks.get(taskId);
    if (!record) return null;
    const { task } = record;
    if (task.status !== "running") return snapshot(task);

    const now = new Date().toISOString();
    task.status = "canceled";
    task.stage = "done";
    task.finishedAt = now;
    task.actionLine = "Canceled";
    for (const diagram of task.diagrams) {
      if (diagram.status === "delivered") continue;
      diagram.status = "canceled";
      diagram.finishedAt = now;
    }
    this.publish(task);

    if (task.agentId) {
      await this.stopGenerator(task.agentId).catch((error) => {
        this.options.logger.warn({ err: error, taskId }, "Failed to stop the Archify agent");
      });
    }
    return snapshot(task);
  }

  async rerun(taskId: string): Promise<ArchifyGenerationTask | null> {
    const record = this.tasks.get(taskId);
    if (!record) return null;
    const remaining = record.task.diagrams
      .filter((diagram) => diagram.status !== "delivered")
      .map((diagram) => diagram.type);
    if (remaining.length === 0) return null;
    return this.start({ ...record.input, types: remaining });
  }

  private async run(record: TaskRecord): Promise<void> {
    const { task, input } = record;
    try {
      const workspace = await this.options.workspaceRegistry.get(input.workspaceId);
      if (!workspace) throw new Error("Workspace not found");

      const evidence = await this.scanEvidence({
        paseoHome: this.options.paseoHome,
        workspaceId: input.workspaceId,
        cwd: workspace.cwd,
        force: input.forceScan === true,
      });
      if (task.status !== "running") return;
      task.evidenceRevision = evidence.revision;
      task.evidenceCached = evidence.cached;
      task.stage = "draw";
      task.actionLine = evidence.cached
        ? "Using the cached evidence sheet"
        : "Wrote the evidence sheet; starting the generator";
      this.publish(task);

      const created = await this.options.createAgent({
        kind: "mcp",
        provider: formatProviderModel(input.provider, input.model),
        config: {
          provider: input.provider,
          cwd: workspace.cwd,
          ...(input.model ? { model: input.model } : {}),
          ...(input.modeId ? { modeId: input.modeId } : {}),
          title: "Archify",
        },
        cwd: workspace.cwd,
        workspaceId: input.workspaceId,
        title: "Archify",
        labels: {
          "paseo.archify.generator": "true",
          "paseo.archify-task": task.taskId,
        },
        ...(input.modeId ? { mode: input.modeId } : {}),
        unattended: true,
        promptFailure: "return-error",
        background: true,
        notifyOnFinish: false,
      });
      if (task.status !== "running") return;
      task.agentId = created.snapshot.id;
      this.markNextDiagramDrawing(task);
      this.publish(task);

      const prompt = buildArchifyGenerationPrompt({
        artifactPrefix: task.diagrams[0]?.artifactId.replace(/-[a-z]+$/, "") ?? "archify",
        types: input.types,
        request: input.request,
        scope: input.scope,
        evidenceDigest: evidence.digest,
      });
      const result = await this.runGenerator(created.snapshot.id, prompt);
      if (task.status !== "running") return;
      this.finish(task, result.canceled);
    } catch (error) {
      if (task.status !== "running") return;
      this.fail(task, error instanceof Error ? error.message : String(error));
    }
  }

  private handleDelivery(
    generatorAgentId: string,
    artifact: ArchifyGenerationTask["diagrams"][number]["artifact"],
  ): void {
    if (!artifact) return;
    const record = [...this.tasks.values()].find(
      (candidate) =>
        candidate.task.status === "running" && candidate.task.agentId === generatorAgentId,
    );
    if (!record) return;
    const { task } = record;
    const diagram = task.diagrams.find((candidate) => candidate.artifactId === artifact.id);
    if (!diagram || diagram.status === "delivered") return;

    const now = new Date().toISOString();
    diagram.status = "delivered";
    diagram.startedAt ??= now;
    diagram.finishedAt = now;
    diagram.error = null;
    diagram.artifact = artifact;
    task.stage = task.diagrams.every((candidate) => candidate.status === "delivered")
      ? "deliver"
      : "validate";
    task.actionLine = `Delivered ${artifact.title}`;
    this.markNextDiagramDrawing(task);
    this.publish(task);
  }

  private markNextDiagramDrawing(task: ArchifyGenerationTask): void {
    const next = task.diagrams.find((diagram) => diagram.status === "pending");
    if (!next) return;
    next.status = "drawing";
    next.startedAt ??= new Date().toISOString();
  }

  private finish(task: ArchifyGenerationTask, canceled: boolean): void {
    const now = new Date().toISOString();
    const unfinished = task.diagrams.filter((diagram) => diagram.status !== "delivered");
    if (canceled) {
      task.status = "canceled";
    } else if (unfinished.length === 0) {
      task.status = "completed";
    } else {
      task.status = "failed";
      task.error = "The generator finished without delivering every diagram";
      for (const diagram of unfinished) {
        diagram.status = "failed";
        diagram.finishedAt = now;
        diagram.error ??= task.error;
      }
    }
    task.stage = "done";
    task.finishedAt = now;
    task.actionLine = canceled ? "Canceled" : (task.error ?? "Done");
    this.publish(task);
  }

  private fail(task: ArchifyGenerationTask, message: string): void {
    const now = new Date().toISOString();
    task.status = "failed";
    task.stage = "done";
    task.error = message;
    task.actionLine = message;
    task.finishedAt = now;
    for (const diagram of task.diagrams) {
      if (diagram.status === "delivered") continue;
      diagram.status = "failed";
      diagram.finishedAt = now;
      diagram.error ??= message;
    }
    this.publish(task);
  }

  private publish(task: ArchifyGenerationTask): void {
    this.options.onTaskUpdated?.(snapshot(task));
  }
}

function snapshot(task: ArchifyGenerationTask): ArchifyGenerationTask {
  return {
    ...task,
    diagrams: task.diagrams.map((diagram) => ({ ...diagram })),
  };
}
