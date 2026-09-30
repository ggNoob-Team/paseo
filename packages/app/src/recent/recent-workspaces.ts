import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

export interface RecentWorkspaceRow {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  projectName: string;
  workspaceName: string;
  activityAt: Date | null;
}

/**
 * Workspaces in the order "Recent" shows them: newest activity first, then the
 * ones nothing has run in. Ties fall back to project and workspace name so a
 * refresh cannot shuffle two rows that share a timestamp.
 */
export function buildRecentWorkspaceRows(
  entries: Iterable<SidebarWorkspaceEntry>,
): RecentWorkspaceRow[] {
  const rows: RecentWorkspaceRow[] = [];
  for (const entry of entries) {
    rows.push({
      workspaceKey: entry.workspaceKey,
      serverId: entry.serverId,
      workspaceId: entry.workspaceId,
      projectName: entry.projectName,
      workspaceName: entry.name,
      activityAt: entry.activityAt ?? null,
    });
  }
  return rows.sort(compareRecentWorkspaceRows);
}

export function compareRecentWorkspaceRows(
  left: RecentWorkspaceRow,
  right: RecentWorkspaceRow,
): number {
  const leftTime = left.activityAt?.getTime() ?? null;
  const rightTime = right.activityAt?.getTime() ?? null;
  if (leftTime !== rightTime) {
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  }

  const byProject = left.projectName.localeCompare(right.projectName);
  if (byProject !== 0) return byProject;
  const byWorkspace = left.workspaceName.localeCompare(right.workspaceName);
  if (byWorkspace !== 0) return byWorkspace;
  return left.workspaceKey.localeCompare(right.workspaceKey);
}
