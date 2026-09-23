import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openArchifyWorkspace,
  readArchifyArtifact,
  renderArchifyArtifact,
  resolveArchifyArtifactDirectory,
} from "./service.js";

const roots: string[] = [];

async function makeHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-archify-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("archify service", () => {
  it("initializes a workspace once and reports auto-generation only for the first open", async () => {
    const paseoHome = await makeHome();
    const workspaceId = "workspace_archify_test";
    await expect(openArchifyWorkspace({ paseoHome, workspaceId })).resolves.toEqual({
      artifacts: [],
      autoGenerate: true,
    });
    await expect(openArchifyWorkspace({ paseoHome, workspaceId })).resolves.toEqual({
      artifacts: [],
      autoGenerate: false,
    });
  });

  it("validates, renders, stores, and reads an artifact", async () => {
    const paseoHome = await makeHome();
    const workspaceId = "workspace_archify_render";
    const artifactId = "architecture-test";
    const summary = await renderArchifyArtifact({
      paseoHome,
      workspaceId,
      artifactId,
      diagramType: "architecture",
      title: "Archify test",
      generatorAgentId: "agent-test",
      scope: "test workspace",
      spec: {
        schema_version: 1,
        diagram_type: "architecture",
        meta: {
          title: "Archify test",
          quality_profile: "showcase",
          locale: "zh-CN",
        },
        components: [
          { id: "client", type: "frontend", label: "Client", pos: [40, 80], size: [120, 60] },
          { id: "server", type: "backend", label: "Server", pos: [240, 80], size: [120, 60] },
        ],
        connections: [{ id: "request", from: "client", to: "server", label: "request" }],
      },
    });

    expect(summary.id).toBe(artifactId);
    expect(summary.type).toBe("architecture");
    expect(summary.artifactBytes).toBeGreaterThan(0);
    const artifact = await readArchifyArtifact({ paseoHome, workspaceId, artifactId });
    expect(artifact?.title).toBe("Archify test");
    expect(artifact?.html.toLowerCase()).toContain("<!doctype html>");
    expect(artifact?.spec.diagram_type).toBe("architecture");
    const receipt = JSON.parse(
      await readFile(
        path.join(
          resolveArchifyArtifactDirectory({ paseoHome, workspaceId, artifactId }),
          "receipt.json",
        ),
        "utf8",
      ),
    ) as { delivery?: { ok?: boolean } };
    expect(receipt.delivery?.ok).toBe(true);
  }, 30_000);
});
