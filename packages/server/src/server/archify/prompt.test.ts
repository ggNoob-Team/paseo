import { describe, expect, it } from "vitest";
import { buildArchifyGenerationPrompt } from "./prompt.js";

describe("buildArchifyGenerationPrompt", () => {
  it("names every requested artifact and asks for the render tool", () => {
    const prompt = buildArchifyGenerationPrompt({
      artifactPrefix: "archify-test",
      types: ["architecture", "sequence", "dataflow"],
    });
    expect(prompt).toContain('artifactId="archify-test-architecture"');
    expect(prompt).toContain('artifactId="archify-test-sequence"');
    expect(prompt).toContain('artifactId="archify-test-dataflow"');
    expect(prompt).toContain("archify_render");
    expect(prompt).toContain("not only the diagram type");
  });

  it("feeds the pre-scanned evidence sheet and stops the agent exploring", () => {
    const prompt = buildArchifyGenerationPrompt({
      artifactPrefix: "archify-test",
      types: ["architecture"],
      evidenceDigest: "# Repository evidence\n- @fixture/core (packages/core)",
    });
    expect(prompt).toContain("# Pre-scanned repository evidence");
    expect(prompt).toContain("@fixture/core");
    expect(prompt).toContain("Do not walk or search the repository to rediscover its structure");
    expect(prompt).toContain("Deliver the artifacts in the order listed");
  });

  it("still asks for repository inspection when no evidence was scanned", () => {
    const prompt = buildArchifyGenerationPrompt({
      artifactPrefix: "archify-test",
      types: ["architecture"],
    });
    expect(prompt).toContain("inspect the current repository");
    expect(prompt).not.toContain("Pre-scanned repository evidence");
  });

  it("makes confirmed anchors mandatory for every diagram", () => {
    const prompt = buildArchifyGenerationPrompt({
      artifactPrefix: "archify-test",
      types: ["architecture"],
      anchors: [
        { kind: "module", label: "@fixture/core", detail: "packages/core" },
        { kind: "flow", label: "@fixture/app -> @fixture/core", detail: "" },
      ],
    });
    expect(prompt).toContain("The user confirmed these anchors");
    expect(prompt).toContain("- [module] @fixture/core — packages/core");
    expect(prompt).toContain("- [flow] @fixture/app -> @fixture/core");
  });

  it("omits the anchor section when nothing was confirmed", () => {
    const prompt = buildArchifyGenerationPrompt({
      artifactPrefix: "archify-test",
      types: ["architecture"],
      anchors: [],
    });
    expect(prompt).not.toContain("The user confirmed these anchors");
  });
});
