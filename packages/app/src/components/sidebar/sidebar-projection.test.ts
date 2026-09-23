import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
  serverId = "srv",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `${serverId}:${id}`,
    serverId,
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: { groupMode?: SidebarGroupMode; pinnedCollapsed?: boolean }) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    hosts: [{ serverId: "srv", label: "Solo Host" }],
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: SidebarGroupMode) {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

/**
 * One project, one workspace, on two hosts — the case host grouping exists for. Project mode merges
 * these rows under a single header; host mode has to hand each host its own section.
 */
function twoHostInput(hosts: Array<{ serverId: string; label: string }>) {
  const primary = makeWorkspace("primary", "running", [], "project", "srv-a");
  const secondary = makeWorkspace("secondary", "done", [], "project", "srv-b");
  return {
    ...projectionInput({ groupMode: "host" }),
    projects: [makeProject([primary.placement, secondary.placement])],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [primary.entry.workspaceKey, primary.entry],
      [secondary.entry.workspaceKey, secondary.entry],
    ]),
    hosts,
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status", "host"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("splits one project into a section per host", () => {
    const projection = buildSidebarProjection(
      twoHostInput([
        { serverId: "srv-a", label: "Primary Host" },
        { serverId: "srv-b", label: "Secondary Host" },
      ]),
    );

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual([
      "host:srv-a",
      "host:srv-b",
    ]);
    expect(projection.workspaceGroups.map((group) => group.label)).toEqual([
      "Primary Host",
      "Secondary Host",
    ]);
    expect(projection.workspaceGroups.map((group) => group.leading)).toEqual([
      { kind: "host", serverId: "srv-a" },
      { kind: "host", serverId: "srv-b" },
    ]);
    const rowIdsPerGroup: string[][] = [];
    for (const group of projection.workspaceGroups) {
      rowIdsPerGroup.push(group.rows.map((row) => row.workspaceId));
    }
    expect(rowIdsPerGroup).toEqual([["primary"], ["secondary"]]);
    // Shortcuts walk the sections on screen, so a host section numbers its rows like any other.
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv-a", workspaceId: "primary" },
      { serverId: "srv-b", workspaceId: "secondary" },
    ]);
  });

  it("orders host sections by the registry and keeps a dropped host last", () => {
    const projection = buildSidebarProjection(
      twoHostInput([
        { serverId: "srv-b", label: "Secondary Host" },
        { serverId: "srv-a", label: "Primary Host" },
      ]),
    );
    expect(projection.workspaceGroups.map((group) => group.key)).toEqual([
      "host:srv-b",
      "host:srv-a",
    ]);

    // A session the registry dropped keeps its rows and falls in after the hosts it still knows.
    const withUnknownHost = buildSidebarProjection(
      twoHostInput([{ serverId: "srv-b", label: "Secondary Host" }]),
    );
    expect(withUnknownHost.workspaceGroups.map((group) => group.label)).toEqual([
      "Secondary Host",
      "srv-a",
    ]);
  });
});
