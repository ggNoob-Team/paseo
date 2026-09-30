import { useCallback, useEffect, useMemo, type ReactElement } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import {
  shouldShowSidebarHostLabels,
  useSidebarWorkspacesList,
} from "@/hooks/use-sidebar-workspaces-list";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildRecentWorkspaceRows, type RecentWorkspaceRow } from "@/recent/recent-workspaces";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function RecentScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <RecentScreenContent />;
}

function RecentScreenContent(): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  // Recent is a cross-host view by definition, so it never reads the sidebar's
  // host/project/label filters: those narrow the sidebar list, not this history.
  const { workspacePlacements, projects, isInitialLoad, isRevalidating, refreshAll } =
    useSidebarWorkspacesList({ hostFilters: [] });
  const entries = useSidebarWorkspaceEntries(workspacePlacements);
  const rows = useMemo(() => buildRecentWorkspaceRows(entries.values()), [entries]);
  const showHostLabels = shouldShowSidebarHostLabels(projects);
  const hostLabelByServerId = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label.trim() || host.serverId])),
    [hosts],
  );

  // The daemon stamps `activityAt` when it builds a descriptor, and a client that
  // is watching an agent does not receive workspace deltas for its turns. Asking
  // every host for the directory on focus is what makes "most recent" true rather
  // than whatever the last delivered delta happened to say.
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const renderItem = useCallback(
    ({ item }: { item: RecentWorkspaceRow }) => (
      <RecentWorkspaceRowItem
        row={item}
        hostLabel={showHostLabels ? (hostLabelByServerId.get(item.serverId) ?? null) : null}
      />
    ),
    [hostLabelByServerId, showHostLabels],
  );

  let body: ReactElement;
  if (isInitialLoad) {
    body = (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (rows.length === 0) {
    body = (
      <View style={styles.centered} testID="recent-empty">
        <Text style={styles.emptyTitle}>{t("recent.emptyTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("recent.emptyDescription")}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={recentWorkspaceKey}
        renderItem={renderItem}
        refreshing={isRevalidating}
        onRefresh={refreshAll}
        contentContainerStyle={styles.listContent}
        testID="recent-list"
      />
    );
  }

  return (
    <View style={styles.container} testID="recent-screen">
      <MenuHeader title={t("recent.title")} />
      {body}
    </View>
  );
}

function recentWorkspaceKey(row: RecentWorkspaceRow): string {
  return row.workspaceKey;
}

function recentRowStyle({ hovered, pressed }: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [styles.row, hovered ? styles.rowHovered : null, pressed ? styles.rowPressed : null];
}

function RecentWorkspaceRowItem({
  row,
  hostLabel,
}: {
  row: RecentWorkspaceRow;
  hostLabel: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const timeLabel = useCompactTimeAgo(row.activityAt);

  const handlePress = useCallback(() => {
    navigateToWorkspace({ serverId: row.serverId, workspaceId: row.workspaceId });
  }, [row.serverId, row.workspaceId]);

  return (
    <Pressable
      onPress={handlePress}
      style={recentRowStyle}
      accessibilityRole="button"
      testID={`recent-workspace-${row.workspaceKey}`}
    >
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.projectName}>
          {hostLabel ? `${hostLabel} · ${row.projectName}` : row.projectName}
        </Text>
        <Text numberOfLines={1} style={styles.workspaceName}>
          {row.workspaceName}
        </Text>
      </View>
      <Text style={styles.time}>{timeLabel || t("recent.noActivity")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    maxWidth: 420,
  },
  listContent: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingBottom: theme.spacing[6],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    minHeight: 56,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    marginTop: theme.spacing[1],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  projectName: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  workspaceName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  time: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
