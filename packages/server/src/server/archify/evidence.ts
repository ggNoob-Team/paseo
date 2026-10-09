import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ArchifyEvidence, ArchifyEvidenceAnchor } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { resolveArchifyWorkspaceDirectory } from "./service.js";

const execFileAsync = promisify(execFile);

/**
 * The digest is handed to the generator agent as a finished fact sheet. 40KB is
 * roughly 10k tokens: enough for a large monorepo's shape, small enough that the
 * model reads it instead of exploring the repository itself.
 */
export const ARCHIFY_EVIDENCE_DIGEST_MAX_BYTES = 40 * 1024;

const MAX_PACKAGES = 40;
const MAX_ENTRY_POINTS = 80;
const MAX_ANCHORS = 80;
const MAX_SOURCE_FILES = 5_000;
const MAX_WALK_DEPTH = 6;
const MAX_ENTRY_FILES_PER_PACKAGE = 6;
const GIT_TIMEOUT_MS = 5_000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".dev",
  ".turbo",
  ".next",
  ".nuxt",
  ".cache",
  ".gradle",
  ".hvigor",
  ".idea",
  ".venv",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "Pods",
  "DerivedData",
  "target",
  "__pycache__",
  "oh_modules",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".cc",
  ".c",
  ".h",
  ".hpp",
  ".vue",
  ".svelte",
  ".m",
  ".mm",
  ".ets",
]);

const ENTRY_FILE_NAMES = new Set(["index", "main", "server", "app", "cli", "mod"]);

const CONFIG_FILE_NAMES = [
  "package.json",
  "tsconfig.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "build.gradle",
  "build.gradle.kts",
];

const PersistedEvidenceSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string(),
  revision: z.string(),
  scannedAt: z.string(),
  digest: z.string(),
  digestBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  facts: z.object({
    packages: z.number().int().nonnegative(),
    entryPoints: z.number().int().nonnegative(),
    sourceFiles: z.number().int().nonnegative(),
  }),
  anchors: z.array(
    z.object({
      kind: z.enum(["module", "entry", "flow"]),
      label: z.string(),
      detail: z.string(),
    }),
  ),
});

interface PackageManifest {
  name: string | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  bin: string[];
  entryFiles: string[];
}

interface WorkspacePackageFacts {
  name: string;
  relativePath: string;
  sourceFiles: number;
  manifest: PackageManifest;
}

interface FileWalkResult {
  sourceFiles: number;
  entryFiles: string[];
}

/** The wire shape plus whether this run reused the cached sheet. */
export type ArchifyEvidenceScanResult = ArchifyEvidence;

type ScannedEvidence = Omit<ArchifyEvidence, "cached">;

/**
 * Reads the workspace once, deterministically, and writes the result next to
 * the artifacts. Re-running it on an unchanged revision returns the cached
 * sheet instead of walking the repository again.
 */
export async function scanArchifyEvidence(input: {
  paseoHome: string;
  workspaceId: string;
  cwd: string;
  force?: boolean;
}): Promise<ArchifyEvidenceScanResult> {
  const workspaceDirectory = resolveArchifyWorkspaceDirectory(input.paseoHome, input.workspaceId);
  const evidencePath = path.join(workspaceDirectory, "evidence.json");
  const revision = await resolveWorkspaceRevision(input.cwd);

  if (!input.force) {
    const cached = await readCachedEvidence(evidencePath, input.workspaceId, revision);
    if (cached) return { ...cached, cached: true };
  }

  const evidence = await buildEvidence({
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    revision,
  });
  await fs.mkdir(workspaceDirectory, { recursive: true });
  await writeJsonFileAtomic(evidencePath, { version: 1, ...evidence });
  return { ...evidence, cached: false };
}

async function readCachedEvidence(
  evidencePath: string,
  workspaceId: string,
  revision: string,
): Promise<ScannedEvidence | null> {
  try {
    const parsed = PersistedEvidenceSchema.safeParse(
      JSON.parse(await fs.readFile(evidencePath, "utf8")),
    );
    if (!parsed.success) return null;
    const { version: _version, ...cached } = parsed.data;
    if (cached.workspaceId !== workspaceId || cached.revision !== revision) return null;
    return cached;
  } catch {
    return null;
  }
}

async function buildEvidence(input: {
  workspaceId: string;
  cwd: string;
  revision: string;
}): Promise<ScannedEvidence> {
  const rootManifest = await readPackageManifest(input.cwd);
  const packageDirectories = await resolvePackageDirectories(input.cwd, rootManifest);
  const budget = { remainingSourceFiles: MAX_SOURCE_FILES };
  const packages: WorkspacePackageFacts[] = [];
  // The root package owns everything that is not a workspace package. Walking
  // its sub-packages first would spend the whole file budget there and leave
  // every real package looking empty.
  const workspaceDirectories = new Set(packageDirectories);

  for (const directory of packageDirectories.slice(0, MAX_PACKAGES)) {
    const manifest = directory === input.cwd ? rootManifest : await readPackageManifest(directory);
    const walk = await walkPackageFiles({
      directory,
      budget,
      excludeDirectories: directory === input.cwd ? workspaceDirectories : undefined,
    });
    packages.push({
      name: manifest.name ?? path.basename(directory),
      relativePath: toRelativePath(input.cwd, directory),
      sourceFiles: walk.sourceFiles,
      manifest: { ...manifest, entryFiles: walk.entryFiles },
    });
  }

  const internalDependencies = resolveInternalDependencies(packages);
  const entryPoints = collectEntryPoints(packages);
  const configFiles = await collectConfigFiles(input.cwd);
  const anchors = buildAnchors({ packages, entryPoints, internalDependencies });
  const rendered = renderDigest({
    revision: input.revision,
    cwd: input.cwd,
    packages,
    entryPoints,
    internalDependencies,
    configFiles,
    anchors,
  });

  return {
    workspaceId: input.workspaceId,
    revision: input.revision,
    scannedAt: new Date().toISOString(),
    digest: rendered.digest,
    digestBytes: Buffer.byteLength(rendered.digest, "utf8"),
    truncated: rendered.truncated,
    facts: {
      packages: packages.length,
      entryPoints: entryPoints.length,
      sourceFiles: packages.reduce((total, entry) => total + entry.sourceFiles, 0),
    },
    anchors,
  };
}

/**
 * Git is the cheapest honest freshness signal: commit, branch, and the working
 * tree fingerprint. A workspace without git falls back to its manifest.
 */
async function resolveWorkspaceRevision(cwd: string): Promise<string> {
  const [head, branch, status] = await Promise.all([
    runGit(["rev-parse", "HEAD"], cwd),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    runGit(["status", "--porcelain=v1"], cwd),
  ]);
  const hash = createHash("sha256");
  if (head) {
    hash.update(head);
    hash.update(branch ?? "");
    hash.update(status ?? "");
    return `git:${hash.digest("hex").slice(0, 32)}`;
  }
  hash.update(await readFileOrEmpty(path.join(cwd, "package.json")));
  hash.update(await fingerprintWorkspaceFiles(cwd));
  return `files:${hash.digest("hex").slice(0, 32)}`;
}

/**
 * A shallow name+mtime fingerprint for workspaces without git. Bounded by depth
 * and entry count so a huge tree cannot turn the freshness check into the scan
 * it is meant to avoid.
 */
async function fingerprintWorkspaceFiles(
  root: string,
  budget = { entries: 2_000 },
): Promise<string> {
  const parts: string[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 3 || budget.entries <= 0) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (budget.entries <= 0) return;
      budget.entries -= 1;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        parts.push(`${toRelativePath(root, path.join(current, entry.name))}/`);
        await walk(path.join(current, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(current, entry.name)).catch(() => null);
      parts.push(`${toRelativePath(root, path.join(current, entry.name))}:${stat?.mtimeMs ?? 0}`);
    }
  };
  await walk(root, 0);
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

async function runGit(args: readonly string[], cwd: string): Promise<string | null> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8").catch(() => "");
}

async function readPackageManifest(directory: string): Promise<PackageManifest> {
  const raw = await readFileOrEmpty(path.join(directory, "package.json"));
  if (!raw) {
    return { name: null, scripts: {}, dependencies: {}, bin: [], entryFiles: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { name: null, scripts: {}, dependencies: {}, bin: [], entryFiles: [] };
  }
  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return {
    name: typeof record.name === "string" ? record.name : null,
    scripts: readStringRecord(record.scripts),
    dependencies: {
      ...readStringRecord(record.dependencies),
      ...readStringRecord(record.devDependencies),
    },
    bin: readBinEntries(record.bin),
    entryFiles: [],
  };
}

function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readBinEntries(value: unknown): string[] {
  if (typeof value === "string") return [value];
  const record = readStringRecord(value);
  return Object.entries(record).map(([name, target]) => `${name} -> ${target}`);
}

/** Workspace globs, reduced to the directories that actually hold a manifest. */
async function resolvePackageDirectories(
  root: string,
  rootManifest: PackageManifest,
): Promise<string[]> {
  const raw = await readFileOrEmpty(path.join(root, "package.json"));
  let globs: string[] = [];
  try {
    const parsed = JSON.parse(raw) as { workspaces?: unknown };
    const workspaces = parsed.workspaces;
    if (Array.isArray(workspaces)) {
      globs = workspaces.filter((entry): entry is string => typeof entry === "string");
    } else if (workspaces && typeof workspaces === "object") {
      const packages = (workspaces as { packages?: unknown }).packages;
      if (Array.isArray(packages)) {
        globs = packages.filter((entry): entry is string => typeof entry === "string");
      }
    }
  } catch {
    globs = [];
  }
  void rootManifest;

  const directories = new Set<string>([root]);
  for (const glob of globs) {
    for (const directory of await expandWorkspaceGlob(root, glob)) {
      directories.add(directory);
    }
  }
  return [...directories].sort();
}

async function expandWorkspaceGlob(root: string, glob: string): Promise<string[]> {
  const segments = glob.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  const matches: string[] = [];
  const walk = async (current: string, index: number): Promise<void> => {
    if (matches.length >= MAX_PACKAGES) return;
    const segment = segments[index];
    if (segment === undefined) {
      if (await hasPackageManifest(current)) matches.push(current);
      return;
    }
    if (segment === "*") {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(path.join(current, entry.name), index + 1);
      }
      return;
    }
    if (segment === "**") {
      await walk(current, index + 1);
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(path.join(current, entry.name), index);
      }
      return;
    }
    await walk(path.join(current, segment), index + 1);
  };
  await walk(root, 0);
  return matches;
}

async function hasPackageManifest(directory: string): Promise<boolean> {
  return fs
    .access(path.join(directory, "package.json"))
    .then(() => true)
    .catch(() => false);
}

async function walkPackageFiles(input: {
  directory: string;
  budget: { remainingSourceFiles: number };
  /** Absolute paths to skip, used to keep the root package off its sub-packages. */
  excludeDirectories?: ReadonlySet<string>;
}): Promise<FileWalkResult> {
  const entryFiles: string[] = [];
  let sourceFiles = 0;

  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_WALK_DEPTH || input.budget.remainingSourceFiles <= 0) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (input.budget.remainingSourceFiles <= 0) return;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        if (input.excludeDirectories?.has(fullPath)) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(extension)) continue;
      input.budget.remainingSourceFiles -= 1;
      sourceFiles += 1;
      if (entryFiles.length >= MAX_ENTRY_FILES_PER_PACKAGE) continue;
      const baseName = path.basename(entry.name, extension);
      if (
        ENTRY_FILE_NAMES.has(baseName) &&
        depth <= 3 &&
        !fullPath.includes(`${path.sep}test${path.sep}`) &&
        !/\.(test|spec)\.[a-z]+$/i.test(entry.name)
      ) {
        entryFiles.push(toRelativePath(input.directory, fullPath));
      }
    }
  };

  await walk(input.directory, 0);
  return { sourceFiles, entryFiles: entryFiles.slice(0, MAX_ENTRY_FILES_PER_PACKAGE) };
}

function resolveInternalDependencies(
  packages: readonly WorkspacePackageFacts[],
): Array<{ from: string; to: string }> {
  const names = new Set(packages.map((entry) => entry.name));
  const edges: Array<{ from: string; to: string }> = [];
  for (const entry of packages) {
    for (const dependency of Object.keys(entry.manifest.dependencies)) {
      if (dependency === entry.name || !names.has(dependency)) continue;
      edges.push({ from: entry.name, to: dependency });
    }
  }
  return edges.sort((left, right) =>
    `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`),
  );
}

interface EntryPoint {
  packageName: string;
  label: string;
  detail: string;
}

function collectEntryPoints(packages: readonly WorkspacePackageFacts[]): EntryPoint[] {
  const entryPoints: EntryPoint[] = [];
  for (const entry of packages) {
    for (const bin of entry.manifest.bin) {
      const [name, target] = bin.split(" -> ");
      entryPoints.push({
        packageName: entry.name,
        label: `${name} (bin)`,
        detail: target ?? bin,
      });
    }
    for (const scriptName of ["start", "dev", "serve", "run"]) {
      const command = entry.manifest.scripts[scriptName];
      if (!command) continue;
      entryPoints.push({
        packageName: entry.name,
        label: `${scriptName} (script)`,
        detail: command,
      });
    }
    for (const file of entry.manifest.entryFiles) {
      entryPoints.push({ packageName: entry.name, label: path.basename(file), detail: file });
    }
  }
  return entryPoints.slice(0, MAX_ENTRY_POINTS);
}

async function collectConfigFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of CONFIG_FILE_NAMES) {
    if (
      await fs
        .access(path.join(root, name))
        .then(() => true)
        .catch(() => false)
    ) {
      found.push(name);
    }
  }
  return found;
}

function buildAnchors(input: {
  packages: readonly WorkspacePackageFacts[];
  entryPoints: readonly EntryPoint[];
  internalDependencies: ReadonlyArray<{ from: string; to: string }>;
}): ArchifyEvidenceAnchor[] {
  const anchors: ArchifyEvidenceAnchor[] = [];
  for (const entry of input.packages) {
    anchors.push({ kind: "module", label: entry.name, detail: entry.relativePath });
  }
  for (const entry of input.entryPoints) {
    anchors.push({
      kind: "entry",
      label: `${entry.packageName}:${entry.label}`,
      detail: entry.detail,
    });
  }
  for (const edge of input.internalDependencies) {
    anchors.push({ kind: "flow", label: `${edge.from} -> ${edge.to}`, detail: "" });
  }
  return anchors.slice(0, MAX_ANCHORS);
}

/**
 * Rendered line by line against a byte budget: when the sheet runs out of room
 * the remaining lines are dropped and the sheet says so, rather than the model
 * receiving a silently different document each run.
 */
function renderDigest(input: {
  revision: string;
  cwd: string;
  packages: readonly WorkspacePackageFacts[];
  entryPoints: readonly EntryPoint[];
  internalDependencies: ReadonlyArray<{ from: string; to: string }>;
  configFiles: readonly string[];
  anchors: readonly ArchifyEvidenceAnchor[];
}): { digest: string; truncated: boolean } {
  const sections: string[][] = [
    [
      "# Repository evidence (deterministic pre-scan, no model)",
      `revision: ${input.revision}`,
      `root: ${input.cwd}`,
    ],
    [
      "",
      `## Workspace packages (${input.packages.length})`,
      ...input.packages.map((entry) => {
        const scripts = Object.entries(entry.manifest.scripts)
          .slice(0, 4)
          .map(([name, command]) => `${name}=${truncate(command, 80)}`)
          .join(" | ");
        const files = entry.manifest.entryFiles.length
          ? `entry files: ${entry.manifest.entryFiles.join(", ")}`
          : "";
        return `- ${entry.name} (${entry.relativePath}): source files=${entry.sourceFiles}${scripts ? `; scripts: ${scripts}` : ""}${files ? `; ${files}` : ""}`;
      }),
    ],
    [
      "",
      `## Entry points (${input.entryPoints.length})`,
      ...input.entryPoints.map(
        (entry) => `- ${entry.packageName}: ${entry.label} -> ${truncate(entry.detail, 120)}`,
      ),
    ],
  ];
  if (input.internalDependencies.length > 0) {
    sections.push([
      "",
      `## Internal dependencies (${input.internalDependencies.length})`,
      ...input.internalDependencies.map((edge) => `- ${edge.from} -> ${edge.to}`),
    ]);
  }
  if (input.configFiles.length > 0) {
    sections.push(["", "## Root config", ...input.configFiles.map((file) => `- ${file}`)]);
  }
  if (input.anchors.length > 0) {
    sections.push([
      "",
      `## Candidate anchors (${input.anchors.length})`,
      ...input.anchors.map(
        (anchor) =>
          `- [${anchor.kind}] ${anchor.label}${anchor.detail ? ` — ${anchor.detail}` : ""}`,
      ),
    ]);
  }

  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const section of sections) {
    for (const line of section) {
      const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
      if (bytes + lineBytes > ARCHIFY_EVIDENCE_DIGEST_MAX_BYTES) {
        truncated = true;
        break;
      }
      lines.push(line);
      bytes += lineBytes;
    }
    if (truncated) break;
  }
  if (truncated) lines.push("… (truncated to fit the evidence budget)");
  return { digest: `${lines.join("\n")}\n`, truncated };
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function toRelativePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return relative.length === 0 ? "." : relative.split(path.sep).join("/");
}
