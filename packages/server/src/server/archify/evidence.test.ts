import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ARCHIFY_EVIDENCE_DIGEST_MAX_BYTES, scanArchifyEvidence } from "./evidence.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createWorkspace(): Promise<{ paseoHome: string; cwd: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-archify-evidence-"));
  directories.push(root);
  const paseoHome = path.join(root, "paseo-home");
  const cwd = path.join(root, "repo");
  await mkdir(path.join(cwd, "packages", "core", "src"), { recursive: true });
  await mkdir(path.join(cwd, "packages", "cli", "src"), { recursive: true });
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture-root",
      private: true,
      workspaces: ["packages/*"],
      scripts: { dev: "node scripts/dev.mjs" },
    }),
  );
  await writeFile(
    path.join(cwd, "packages", "core", "package.json"),
    JSON.stringify({
      name: "@fixture/core",
      main: "src/index.ts",
      scripts: { build: "tsc" },
    }),
  );
  await writeFile(
    path.join(cwd, "packages", "core", "src", "index.ts"),
    "export const core = 1;\n",
  );
  await writeFile(
    path.join(cwd, "packages", "core", "src", "helper.ts"),
    "export const helper = 1;\n",
  );
  await writeFile(
    path.join(cwd, "packages", "cli", "package.json"),
    JSON.stringify({
      name: "@fixture/cli",
      bin: { fixture: "src/main.ts" },
      dependencies: { "@fixture/core": "1.0.0" },
      scripts: { start: "node src/main.ts" },
    }),
  );
  await writeFile(path.join(cwd, "packages", "cli", "src", "main.ts"), "import '@fixture/core';\n");
  await writeFile(path.join(cwd, "packages", "cli", "src", "index.ts"), "export {};\n");
  await writeFile(path.join(cwd, "tsconfig.json"), "{}\n");
  return { paseoHome: path.join(paseoHome), cwd };
}

describe("scanArchifyEvidence", () => {
  test("describes the workspace packages, entries and internal edges", async () => {
    const { paseoHome, cwd } = await createWorkspace();
    const evidence = await scanArchifyEvidence({ paseoHome, workspaceId: "ws_1", cwd });

    expect(evidence.cached).toBe(false);
    expect(evidence.facts.packages).toBe(3);
    expect(evidence.facts.sourceFiles).toBeGreaterThanOrEqual(4);
    expect(evidence.digest).toContain("@fixture/core");
    expect(evidence.digest).toContain("@fixture/cli");
    expect(evidence.digest).toContain("fixture (bin)");
    expect(evidence.digest).toContain("@fixture/cli -> @fixture/core");
    expect(evidence.digestBytes).toBeLessThanOrEqual(ARCHIFY_EVIDENCE_DIGEST_MAX_BYTES);
    expect(evidence.truncated).toBe(false);
    expect(evidence.anchors).toContainEqual({
      kind: "flow",
      label: "@fixture/cli -> @fixture/core",
      detail: "",
    });
    expect(evidence.anchors.some((anchor) => anchor.kind === "module")).toBe(true);
    expect(evidence.anchors.some((anchor) => anchor.kind === "entry")).toBe(true);
  });

  test("reuses the sheet while the revision is unchanged and rescans after a change", async () => {
    const { paseoHome, cwd } = await createWorkspace();
    const first = await scanArchifyEvidence({ paseoHome, workspaceId: "ws_1", cwd });
    const second = await scanArchifyEvidence({ paseoHome, workspaceId: "ws_1", cwd });
    expect(second.cached).toBe(true);
    expect(second.scannedAt).toBe(first.scannedAt);

    await writeFile(
      path.join(cwd, "packages", "core", "src", "extra.ts"),
      "export const extra = 1;\n",
    );
    const third = await scanArchifyEvidence({ paseoHome, workspaceId: "ws_1", cwd });
    expect(third.cached).toBe(false);
    expect(third.facts.sourceFiles).toBeGreaterThan(first.facts.sourceFiles);
  });

  test("keeps the digest inside its byte budget for a large workspace", async () => {
    const { paseoHome, cwd } = await createWorkspace();
    const script = Array.from(
      { length: 400 },
      (_, index) => `  "task${index}": "run ${index}"`,
    ).join(",\n");
    await writeFile(
      path.join(cwd, "package.json"),
      `{\n  "name": "fixture-root",\n  "private": true,\n  "workspaces": ["packages/*"],\n  "scripts": {\n${script}\n  }\n}\n`,
    );

    const evidence = await scanArchifyEvidence({ paseoHome, workspaceId: "ws_1", cwd });
    expect(evidence.digestBytes).toBeLessThanOrEqual(ARCHIFY_EVIDENCE_DIGEST_MAX_BYTES);
  });
});
