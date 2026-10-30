import { describe, expect, it } from "vitest";
import {
  buildCommandPlanningPrompt,
  buildCommandSummaryPrompt,
  parseCommandPlan,
} from "./command-plan";

describe("buildCommandPlanningPrompt", () => {
  it("includes the request and terminal directory", () => {
    const prompt = buildCommandPlanningPrompt({
      request: "当前服务器负载",
      cwd: "/srv/app",
    });
    expect(prompt).toContain("当前服务器负载");
    expect(prompt).toContain("/srv/app");
    expect(prompt).toContain("one command per line");
    expect(prompt).toContain("NO_COMMAND");
  });
});

describe("buildCommandSummaryPrompt", () => {
  it("includes the request, commands and captured output", () => {
    const prompt = buildCommandSummaryPrompt({
      request: "当前服务器负载",
      cwd: "/srv/app",
      commands: ["uptime", "nproc"],
      output: "load average: 0.97, 1.04, 1.13\n32",
    });
    expect(prompt).toContain("当前服务器负载");
    expect(prompt).toContain("$ uptime");
    expect(prompt).toContain("$ nproc");
    expect(prompt).toContain("load average: 0.97, 1.04, 1.13");
    expect(prompt).toContain("Do not output shell commands");
  });

  it("mentions missing output explicitly", () => {
    const prompt = buildCommandSummaryPrompt({
      request: "check disk",
      cwd: "/srv/app",
      commands: ["df -h"],
      output: "   ",
    });
    expect(prompt).toContain("(no output captured)");
  });

  it("truncates very large output", () => {
    const prompt = buildCommandSummaryPrompt({
      request: "dump",
      cwd: "/srv/app",
      commands: ["cat big.log"],
      output: "x".repeat(20_000),
    });
    expect(prompt).toContain("...[truncated]");
    expect(prompt.length).toBeLessThan(12_000);
  });
});

describe("parseCommandPlan", () => {
  it("extracts commands from a fenced code block", () => {
    expect(parseCommandPlan("```bash\nuptime\ndf -h\n```")).toEqual(["uptime", "df -h"]);
  });

  it("ignores prose around fenced blocks", () => {
    expect(parseCommandPlan("Here you go:\n```sh\nfree -m\n```\nThis shows memory.")).toEqual([
      "free -m",
    ]);
  });

  it("accepts plain lines and strips shell prompts", () => {
    expect(parseCommandPlan("$ uptime\n> free -m\n`df -h`\n")).toEqual([
      "uptime",
      "free -m",
      "df -h",
    ]);
  });

  it("returns no commands for NO_COMMAND", () => {
    expect(parseCommandPlan("NO_COMMAND")).toEqual([]);
  });

  it("returns no commands for empty replies", () => {
    expect(parseCommandPlan("   \n\n")).toEqual([]);
  });
});
