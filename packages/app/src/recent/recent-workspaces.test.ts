import { describe, expect, test } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildRecentWorkspaceRows } from "./recent-workspaces";

function entry(
  overrides: Partial<SidebarWorkspaceEntry> & { workspaceKey: string },
): SidebarWorkspaceEntry {
  return {
    serverId: "srv_1",
    workspaceId: overrides.workspaceKey,
    projectViewKey: "prj_1",
    projectName: "Alpha",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "main",
    workspaceDirectory: "/repo",
    workspaceDirectoryLabel: "repo",
    statusBucket: "done",
    statusEnteredAt: null,
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    currentBranch: null,
    title: null,
    labels: [],
    ...overrides,
  } as SidebarWorkspaceEntry;
}

describe("buildRecentWorkspaceRows", () => {
  test("orders by newest activity and keeps never-used workspaces last", () => {
    const rows = buildRecentWorkspaceRows([
      entry({ workspaceKey: "c", activityAt: null }),
      entry({ workspaceKey: "a", activityAt: new Date("2026-05-01T00:00:00.000Z") }),
      entry({
        workspaceKey: "b",
        activityAt: new Date("2026-05-02T00:00:00.000Z"),
        name: "feature",
      }),
    ]);

    expect(rows.map((row) => row.workspaceKey)).toEqual(["b", "a", "c"]);
    expect(rows[2]?.activityAt).toBeNull();
  });

  test("breaks timestamp ties by project then workspace name", () => {
    const sameTime = new Date("2026-05-01T00:00:00.000Z");
    const rows = buildRecentWorkspaceRows([
      entry({ workspaceKey: "3", projectName: "Beta", name: "main", activityAt: sameTime }),
      entry({ workspaceKey: "2", projectName: "Alpha", name: "zeta", activityAt: sameTime }),
      entry({ workspaceKey: "1", projectName: "Alpha", name: "alpha", activityAt: sameTime }),
    ]);

    expect(rows.map((row) => row.workspaceKey)).toEqual(["1", "2", "3"]);
  });

  test("carries everything a row needs to navigate", () => {
    const rows = buildRecentWorkspaceRows([
      entry({ workspaceKey: "srv_9:ws_1", serverId: "srv_9", workspaceId: "ws_1" }),
    ]);

    expect(rows[0]).toMatchObject({
      workspaceKey: "srv_9:ws_1",
      serverId: "srv_9",
      workspaceId: "ws_1",
      projectName: "Alpha",
      workspaceName: "main",
    });
  });
});
