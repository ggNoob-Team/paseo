import { nextSidebarGroupMode, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface GroupingCommandCenterSource {
  groupMode: SidebarGroupMode;
  labels: {
    section: string;
    groupByProject: string;
    groupByStatus: string;
    groupByHost: string;
  };
  icons: {
    project?: CommandCenterIcon;
    status?: CommandCenterIcon;
    host?: CommandCenterIcon;
  };
  setGroupMode(mode: SidebarGroupMode): void;
}

const TITLES: Record<SidebarGroupMode, keyof GroupingCommandCenterSource["labels"]> = {
  project: "groupByProject",
  status: "groupByStatus",
  host: "groupByHost",
};

// One entry that always names the mode you are not in, so it can never read as a no-op. The modes
// cycle rather than toggle: three grouping modes, one row.
export function buildGroupingContribution(
  source: GroupingCommandCenterSource,
): CommandCenterContribution {
  const target = nextSidebarGroupMode(source.groupMode);
  return {
    id: "sidebar-grouping",
    group: "actions",
    groupRank: 0,
    rank: 8,
    keywords: ["group", "grouping", "sort", "sidebar", "project", "status", "host"],
    visibility: "query",
    run: () => source.setGroupMode(target),
    presentation: {
      kind: "action",
      title: source.labels[TITLES[target]],
      sectionTitle: source.labels.section,
      icon: source.icons[target],
    },
  };
}
