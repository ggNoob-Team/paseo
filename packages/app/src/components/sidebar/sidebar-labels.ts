import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { SIDEBAR_UNLABELLED_LABEL_KEY, type SidebarLabelFilter } from "@/stores/sidebar-view-store";
import type { StatusBucket, StatusGroup } from "@/hooks/sidebar-status-view-model";

export interface SidebarWorkspaceGroup {
  key: string;
  label: string;
  rows: SidebarWorkspaceEntry[];
  /**
   * What the header's leading slot marks, and with it which header renders it: status groups carry
   * their bucket, host groups the host they hold.
   */
  leading: { kind: "status"; bucket: StatusBucket } | { kind: "host"; serverId: string };
}

export function statusWorkspaceGroups(groups: readonly StatusGroup[]): SidebarWorkspaceGroup[] {
  return groups.map((group) => ({
    key: group.bucket,
    label: group.label,
    rows: group.rows,
    leading: { kind: "status", bucket: group.bucket },
  }));
}

/** A host the sidebar can section by: its identity, plus the name its header shows. */
export interface SidebarGroupHost {
  serverId: string;
  label: string;
}

/** A host's section, before it becomes a `SidebarWorkspaceGroup`. */
export interface HostGroup {
  serverId: string;
  label: string;
  rows: SidebarWorkspaceEntry[];
}

/**
 * Collapsed-section key for a host group. Namespaced because `collapsedWorkspaceGroupKeys` is one
 * set shared by every grouping mode, and a server id would otherwise be free to collide with a
 * status bucket name.
 */
export function hostWorkspaceGroupKey(serverId: string): string {
  return `host:${serverId}`;
}

/**
 * Sections by host: every workspace lands on the machine it lives on, so the same project appears
 * under each host that carries it instead of being merged across hosts the way project mode merges
 * it. Hosts that are not in the registry — a session the registry dropped while its workspaces are
 * still listed — keep their rows and fall in after the known hosts.
 */
export function buildHostGroups(
  workspaces: readonly SidebarWorkspaceEntry[],
  hosts: readonly SidebarGroupHost[],
): HostGroup[] {
  const rowsByServerId = new Map<string, SidebarWorkspaceEntry[]>();
  for (const workspace of workspaces) {
    const rows = rowsByServerId.get(workspace.serverId);
    if (rows) {
      rows.push(workspace);
    } else {
      rowsByServerId.set(workspace.serverId, [workspace]);
    }
  }

  const labelByServerId = new Map(hosts.map((host) => [host.serverId, host.label]));
  const registryRankByServerId = new Map(hosts.map((host, index) => [host.serverId, index]));

  const groups = [...rowsByServerId].map(([serverId, rows]) => ({
    serverId,
    label: labelByServerId.get(serverId) ?? serverId,
    rows: rows.sort(compareHostRows),
  }));

  return groups.sort((a, b) => {
    const aRank = registryRankByServerId.get(a.serverId);
    const bRank = registryRankByServerId.get(b.serverId);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    const labelCmp = a.label.localeCompare(b.label);
    return labelCmp !== 0 ? labelCmp : a.serverId.localeCompare(b.serverId);
  });
}

/**
 * Rows inside a host stay project-adjacent. Splitting the list by machine should not also scatter
 * each project's workspaces, so the project structure the user reads in project mode survives the
 * split; inside one project the workspace whose state moved most recently leads.
 */
function compareHostRows(a: SidebarWorkspaceEntry, b: SidebarWorkspaceEntry): number {
  const projectCmp = a.projectName.localeCompare(b.projectName);
  if (projectCmp !== 0) return projectCmp;

  const aTime = a.statusEnteredAt?.getTime() ?? null;
  const bTime = b.statusEnteredAt?.getTime() ?? null;
  if (aTime !== null && bTime !== null) {
    if (aTime !== bTime) return bTime - aTime;
  } else if (aTime !== null) {
    return -1;
  } else if (bTime !== null) {
    return 1;
  }

  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  return a.workspaceKey.localeCompare(b.workspaceKey);
}

export function hostWorkspaceGroups(groups: readonly HostGroup[]): SidebarWorkspaceGroup[] {
  return groups.map((group) => ({
    key: hostWorkspaceGroupKey(group.serverId),
    label: group.label,
    rows: group.rows,
    leading: { kind: "host", serverId: group.serverId },
  }));
}

/**
 * Applies the Labels page's selection to the sidebar.
 *
 * `Unlabelled` is a row like any other, so it is a key in the same list rather than a boolean
 * beside it; the only thing that makes it special is what the key asks of a workspace.
 * Selecting several labels includes workspaces carrying any of them.
 */
export function filterWorkspacesByLabels(
  input: { workspaces: readonly SidebarWorkspaceEntry[] } & SidebarLabelFilter,
): SidebarWorkspaceEntry[] {
  const { workspaces, labels } = input;
  if (labels.length === 0) return [...workspaces];
  return workspaces.filter((workspace) => {
    // Whitespace-only names normalize away, so `size === 0` is exactly "carries no real label"
    // and the empty key can only ever mean Unlabelled.
    const keys = new Set((workspace.labels ?? []).map(workspaceLabelKey).filter(Boolean));
    const matches = (key: string) =>
      key === SIDEBAR_UNLABELLED_LABEL_KEY ? keys.size === 0 : keys.has(key);
    return labels.some(matches);
  });
}
