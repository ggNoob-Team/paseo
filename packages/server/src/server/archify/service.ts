import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  ArchifyArtifact,
  ArchifyArtifactSummary,
  ArchifyDiagramType,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { resolveBundledSkillsDir } from "../orchestration-skills/internal/paths.js";

const execFileAsync = promisify(execFile);
const ARCHIFY_SKILL_DIRECTORY = "paseo-archify";
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;
const DELIVER_TIMEOUT_MS = 2 * 60 * 1000;

const ArtifactMetadataSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  type: z.enum(["architecture", "sequence", "dataflow", "workflow", "lifecycle"]),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  specBytes: z.number().int().nonnegative(),
  artifactBytes: z.number().int().nonnegative(),
  specSha256: z.string(),
  artifactSha256: z.string(),
  generatorAgentId: z.string().nullable(),
  request: z.string().nullable(),
  scope: z.string().nullable(),
});
export type ArchifyArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export interface ArchifyRenderInput {
  paseoHome: string;
  workspaceId: string;
  artifactId: string;
  diagramType: ArchifyDiagramType;
  title: string;
  spec: Record<string, unknown>;
  generatorAgentId?: string | null;
  request?: string | null;
  scope?: string | null;
}

export class ArchifyRenderError extends Error {
  readonly diagnostics: unknown;

  constructor(message: string, diagnostics: unknown) {
    super(message);
    this.name = "ArchifyRenderError";
    this.diagnostics = diagnostics;
  }
}

function assertSafeSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!SAFE_SEGMENT.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

export function resolveArchifyWorkspaceDirectory(paseoHome: string, workspaceId: string): string {
  const safeWorkspaceId = assertSafeSegment(workspaceId, "workspace id");
  return path.join(paseoHome, "archify", safeWorkspaceId);
}

export function resolveArchifyArtifactDirectory(input: {
  paseoHome: string;
  workspaceId: string;
  artifactId: string;
}): string {
  const artifactId = assertSafeSegment(input.artifactId, "artifact id");
  return path.join(
    resolveArchifyWorkspaceDirectory(input.paseoHome, input.workspaceId),
    artifactId,
  );
}

function resolveArchifyCliPath(): string {
  return path.join(resolveBundledSkillsDir(), ARCHIFY_SKILL_DIRECTORY, "bin", "archify.mjs");
}

async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function toSummary(metadata: ArchifyArtifactMetadata): ArchifyArtifactSummary {
  return {
    id: metadata.id,
    type: metadata.type,
    title: metadata.title,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    specBytes: metadata.specBytes,
    artifactBytes: metadata.artifactBytes,
    generatorAgentId: metadata.generatorAgentId,
    request: metadata.request,
    scope: metadata.scope,
  };
}

async function readMetadata(artifactDirectory: string): Promise<ArchifyArtifactMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(artifactDirectory, "metadata.json"), "utf8");
    const parsed = ArtifactMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function listArchifyArtifacts(input: {
  paseoHome: string;
  workspaceId: string;
}): Promise<ArchifyArtifactSummary[]> {
  const workspaceDirectory = resolveArchifyWorkspaceDirectory(input.paseoHome, input.workspaceId);
  const entries = await fs.readdir(workspaceDirectory, { withFileTypes: true }).catch(() => []);
  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_SEGMENT.test(entry.name))
      .map((entry) => readMetadata(path.join(workspaceDirectory, entry.name))),
  );
  return artifacts
    .filter((artifact): artifact is ArchifyArtifactMetadata => artifact !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toSummary);
}

export async function openArchifyWorkspace(input: {
  paseoHome: string;
  workspaceId: string;
}): Promise<{ artifacts: ArchifyArtifactSummary[]; autoGenerate: boolean }> {
  const workspaceDirectory = resolveArchifyWorkspaceDirectory(input.paseoHome, input.workspaceId);
  await fs.mkdir(workspaceDirectory, { recursive: true });
  const markerPath = path.join(workspaceDirectory, ".initialized");
  const initialized = await fs
    .access(markerPath)
    .then(() => true)
    .catch(() => false);
  const artifacts = await listArchifyArtifacts(input);
  const autoGenerate = !initialized && artifacts.length === 0;
  if (!initialized) {
    await writeJsonFileAtomic(markerPath, {
      version: 1,
      initializedAt: new Date().toISOString(),
    });
  }
  return { artifacts, autoGenerate };
}

export async function readArchifyArtifact(input: {
  paseoHome: string;
  workspaceId: string;
  artifactId: string;
}): Promise<ArchifyArtifact | null> {
  const artifactDirectory = resolveArchifyArtifactDirectory(input);
  const metadata = await readMetadata(artifactDirectory);
  if (!metadata) return null;
  const [specRaw, html] = await Promise.all([
    fs.readFile(path.join(artifactDirectory, "spec.json"), "utf8"),
    fs.readFile(path.join(artifactDirectory, "artifact.html"), "utf8"),
  ]);
  return {
    ...toSummary(metadata),
    spec: z.record(z.string(), z.unknown()).parse(JSON.parse(specRaw)),
    html,
  };
}

function parseJsonOutput(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function deliverSpec(input: {
  diagramType: ArchifyDiagramType;
  specPath: string;
  outputPath: string;
}): Promise<unknown> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        resolveArchifyCliPath(),
        "deliver",
        input.diagramType,
        input.specPath,
        input.outputPath,
        "--quality",
        "showcase",
        "--json",
      ],
      {
        encoding: "utf8",
        maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
        timeout: DELIVER_TIMEOUT_MS,
      },
    );
    return parseJsonOutput(result.stdout);
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: string | number;
    };
    const diagnostics =
      parseJsonOutput(failure.stdout ?? "") ??
      parseJsonOutput(failure.stderr ?? "") ??
      failure.stderr?.trim() ??
      failure.message ??
      "Archify delivery failed";
    throw new ArchifyRenderError("Archify delivery failed", diagnostics);
  }
}

export async function renderArchifyArtifact(
  input: ArchifyRenderInput,
): Promise<ArchifyArtifactSummary> {
  const artifactDirectory = resolveArchifyArtifactDirectory(input);
  const artifactId = assertSafeSegment(input.artifactId, "artifact id");
  const specPath = path.join(artifactDirectory, "spec.json");
  const outputPath = path.join(artifactDirectory, "artifact.html");
  const now = new Date().toISOString();
  const normalizedRequest = input.request?.trim() || null;
  const normalizedScope = input.scope?.trim() || null;

  await fs.mkdir(artifactDirectory, { recursive: true });
  await writeJsonFileAtomic(specPath, input.spec);
  const receipt = await deliverSpec({
    diagramType: input.diagramType,
    specPath,
    outputPath,
  });

  const [specBytes, artifactBytes, specSha256, artifactSha256] = await Promise.all([
    fs.stat(specPath).then((stat) => stat.size),
    fs.stat(outputPath).then((stat) => stat.size),
    sha256File(specPath),
    sha256File(outputPath),
  ]);
  const metadata: ArchifyArtifactMetadata = {
    version: 1,
    id: artifactId,
    type: input.diagramType,
    title: input.title.trim() || artifactId,
    createdAt: now,
    updatedAt: new Date().toISOString(),
    specBytes,
    artifactBytes,
    specSha256,
    artifactSha256,
    generatorAgentId: input.generatorAgentId?.trim() || null,
    request: normalizedRequest,
    scope: normalizedScope,
  };
  await writeJsonFileAtomic(path.join(artifactDirectory, "metadata.json"), metadata);
  await writeJsonFileAtomic(path.join(artifactDirectory, "receipt.json"), {
    artifact: metadata,
    delivery: receipt,
  });
  return toSummary(metadata);
}

export function createArchifyArtifactId(input: {
  diagramType: ArchifyDiagramType;
  requestedId?: string;
}): string {
  const requestedId = input.requestedId?.trim();
  if (requestedId) return assertSafeSegment(requestedId, "artifact id");
  return `${input.diagramType}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
