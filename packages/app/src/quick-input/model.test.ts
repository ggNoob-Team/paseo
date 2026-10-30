import { describe, expect, it } from "vitest";
import {
  applyQuickInputModelOrdering,
  groupQuickInputSessions,
  quickInputModelSeedFromSession,
  rankQuickInputSessions,
  selectQuickInputModelSeedSession,
  type QuickInputSession,
} from "./model";

const NOW = new Date("2026-10-30T12:00:00.000Z").getTime();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function session(overrides: Partial<QuickInputSession> = {}): QuickInputSession {
  return {
    serverId: "server-a",
    agentId: "agent-a",
    workspaceId: "workspace-a",
    title: "Weekly notes",
    workspaceName: "Main workspace",
    projectName: "Ops",
    cwd: "/repos/paseo",
    status: "idle",
    isRunning: false,
    requiresAttention: false,
    pendingPermissionCount: 0,
    lastActivityAt: new Date(NOW - HOUR_MS),
    labels: {},
    hostLabel: "Local",
    provider: "codex",
    model: "deepseek-flash",
    thinkingOptionId: "low",
    ...overrides,
  };
}

describe("selectQuickInputModelSeedSession", () => {
  it("inherits the most recent model in the active workspace", () => {
    const seed = selectQuickInputModelSeedSession(
      [
        session({
          agentId: "older",
          workspaceId: "workspace-a",
          lastActivityAt: new Date(NOW - 3 * HOUR_MS),
          model: "gpt-5.4",
        }),
        session({
          agentId: "newer",
          workspaceId: "workspace-a",
          lastActivityAt: new Date(NOW - HOUR_MS),
          model: "deepseek-flash",
          thinkingOptionId: "low",
        }),
        session({
          agentId: "other-workspace",
          workspaceId: "workspace-b",
          lastActivityAt: new Date(NOW - 10 * HOUR_MS),
          model: "claude-opus",
        }),
      ],
      { serverId: "server-a", workspaceId: "workspace-a" },
    );

    expect(seed).toMatchObject({
      agentId: "newer",
      provider: "codex",
      model: "deepseek-flash",
      thinkingOptionId: "low",
    });
    expect(quickInputModelSeedFromSession(seed ?? null)).toEqual({
      provider: "codex",
      model: "deepseek-flash",
      thinkingOptionId: "low",
    });
  });

  it("falls back to the latest session on the same host and skips sessions without a model", () => {
    const seed = selectQuickInputModelSeedSession(
      [
        session({
          agentId: "same-host",
          workspaceId: "workspace-b",
          lastActivityAt: new Date(NOW - 2 * HOUR_MS),
        }),
        session({
          agentId: "other-host",
          serverId: "server-b",
          lastActivityAt: new Date(NOW - HOUR_MS),
        }),
        session({
          agentId: "no-model",
          lastActivityAt: new Date(NOW),
          model: null,
        }),
      ],
      { serverId: "server-a", workspaceId: "missing-workspace" },
    );

    expect(seed?.agentId).toBe("same-host");
  });
});

describe("groupQuickInputSessions", () => {
  it("groups and sorts active, recent, and older sessions", () => {
    const sections = groupQuickInputSessions(
      [
        session({ agentId: "old", lastActivityAt: new Date(NOW - 8 * DAY_MS) }),
        session({ agentId: "recent", lastActivityAt: new Date(NOW - HOUR_MS) }),
        session({ agentId: "running", isRunning: true, lastActivityAt: new Date(NOW - HOUR_MS) }),
        session({
          agentId: "attention",
          requiresAttention: true,
          lastActivityAt: new Date(NOW - 2 * HOUR_MS),
        }),
      ],
      NOW,
    );

    expect(sections.map((section) => section.id)).toEqual(["active", "recent", "other"]);
    expect(sections[0]?.sessions.map((item) => item.agentId)).toEqual(["attention", "running"]);
    expect(sections[1]?.sessions.map((item) => item.agentId)).toEqual(["recent"]);
    expect(sections[2]?.sessions.map((item) => item.agentId)).toEqual(["old"]);
  });

  it("omits empty groups", () => {
    expect(groupQuickInputSessions([session()], NOW).map((section) => section.id)).toEqual([
      "recent",
    ]);
  });
});

describe("rankQuickInputSessions", () => {
  it("marks a strong title match as high confidence", () => {
    const ranking = rankQuickInputSessions({
      sessions: [session({ title: "Deploy production" })],
      query: "deploy",
    });

    expect(ranking.confidence).toBe("high");
    expect(ranking.results[0]).toMatchObject({ reason: "title", matchedText: "Deploy production" });
  });

  it("matches project names and keeps them as visible high-confidence matches", () => {
    const ranking = rankQuickInputSessions({
      sessions: [session({ projectName: "Deploy platform" })],
      query: "deploy",
    });

    expect(ranking.confidence).toBe("high");
    expect(ranking.results[0]?.reason).toBe("project");
  });

  it("matches recent prompt context but never auto-sends from it", () => {
    const item = session({ agentId: "recent-context" });
    const ranking = rankQuickInputSessions({
      sessions: [item],
      query: "deploy",
      recentPromptsBySession: {
        "server-a:recent-context": ["please fix the deploy failure"],
      },
    });

    expect(ranking.confidence).toBe("low");
    expect(ranking.results[0]).toMatchObject({
      reason: "recent",
      matchedText: "please fix the deploy failure",
    });
  });

  it("matches paths and labels as low-confidence keyword context", () => {
    const ranking = rankQuickInputSessions({
      sessions: [session({ cwd: "/repos/deploy" })],
      query: "deploy",
    });

    expect(ranking.confidence).toBe("low");
    expect(ranking.results[0]).toMatchObject({ reason: "keyword", matchedText: "/repos/deploy" });
  });

  it("matches mixed Chinese and English queries from partial evidence", () => {
    const ranking = rankQuickInputSessions({
      sessions: [
        session({
          agentId: "mindmap-bug",
          title: "看一下有什么bug",
          projectName: "mindmap",
          workspaceName: "main",
          cwd: "/repos/mindmap",
        }),
        session({
          agentId: "mindmap-script",
          title: "给backend也写一个.sh启动脚本",
          projectName: "mindmap",
          workspaceName: "main",
          cwd: "/repos/mindmap",
        }),
        session({ agentId: "unrelated", title: "Deploy production" }),
      ],
      query: "review mindmap bug修复代码",
    });

    expect(ranking.results[0]).toMatchObject({
      session: { agentId: "mindmap-bug" },
      reason: "title",
      matchedText: "看一下有什么bug",
    });
    expect(ranking.confidence).toBe("high");
    expect(ranking.results.map((result) => result.session.agentId)).toEqual([
      "mindmap-bug",
      "mindmap-script",
    ]);
  });

  it("requires a score margin before treating a match as high confidence", () => {
    const ranking = rankQuickInputSessions({
      sessions: [
        session({ agentId: "agent-a", title: "Deploy production" }),
        session({ agentId: "agent-b", title: "Deploy production two" }),
      ],
      query: "deploy",
    });

    expect(ranking.results).toHaveLength(2);
    expect(ranking.confidence).toBe("low");
  });

  it("returns no results for an unmatched query", () => {
    expect(
      rankQuickInputSessions({ sessions: [session()], query: "not-a-real-session-name" }),
    ).toEqual({ results: [], confidence: "none" });
  });

  it("does not rank anything for an empty query", () => {
    expect(rankQuickInputSessions({ sessions: [session()], query: "   " })).toEqual({
      results: [],
      confidence: "none",
    });
  });
});

describe("applyQuickInputModelOrdering", () => {
  it("moves model-ranked matches first and keeps the remaining local order", () => {
    const sessions = [
      session({ agentId: "alpha", title: "Deploy alpha" }),
      session({ agentId: "beta", title: "Deploy beta" }),
      session({ agentId: "gamma", title: "Deploy gamma" }),
    ];
    const ranking = rankQuickInputSessions({ sessions, query: "deploy" });

    const ordered = applyQuickInputModelOrdering({
      results: ranking.results,
      sessions,
      orderedKeys: ["server-a:gamma", "server-a:beta", "server-a:missing"],
      reason: "title",
    });

    expect(ordered.map((result) => result.session.agentId)).toEqual(["gamma", "beta", "alpha"]);
    expect(ordered[0]?.modelRanked).toBe(true);
    expect(ordered[2]?.modelRanked).toBeUndefined();
  });

  it("can surface a session that had no local text match", () => {
    const sessions = [
      session({ agentId: "local", title: "Alpha" }),
      session({ agentId: "model-only", title: "Beta" }),
    ];
    const ranking = rankQuickInputSessions({ sessions, query: "alpha" });

    const ordered = applyQuickInputModelOrdering({
      results: ranking.results,
      sessions,
      orderedKeys: ["server-a:model-only"],
      reason: "recent",
    });

    expect(ordered.map((result) => result.session.agentId)).toEqual(["model-only", "local"]);
    expect(ordered[0]).toMatchObject({
      reason: "recent",
      matchedText: null,
      modelRanked: true,
    });
  });
});
