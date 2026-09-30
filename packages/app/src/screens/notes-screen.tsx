import { useCallback, useMemo, type ReactElement } from "react";
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
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useNoteUpdatesSubscription, useProjectNotesList } from "@/notes/use-notes";
import type { HostProjectNoteSummary } from "@/notes/notes-model";
import type { Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function NotesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <NotesScreenContent />;
}

function NotesScreenContent(): ReactElement {
  const { t } = useTranslation();
  const { notes, isLoading, unsupportedHostLabels, refresh } = useProjectNotesList();
  const serverIds = useMemo(() => [...new Set(notes.map((note) => note.serverId))], [notes]);
  useNoteUpdatesSubscription(serverIds);

  const renderItem = useCallback(
    ({ item }: { item: HostProjectNoteSummary }) => <NoteSummaryRow row={item} />,
    [],
  );

  let body: ReactElement;
  if (isLoading) {
    body = (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (notes.length === 0) {
    body = (
      <View style={styles.centered} testID="notes-empty">
        <Text style={styles.emptyTitle}>{t("notes.emptyTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("notes.emptyDescription")}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={notes}
        keyExtractor={noteSummaryKey}
        renderItem={renderItem}
        onRefresh={refresh}
        refreshing={false}
        contentContainerStyle={styles.listContent}
        testID="notes-list"
      />
    );
  }

  return (
    <View style={styles.container} testID="notes-screen">
      <MenuHeader title={t("notes.title")} />
      {unsupportedHostLabels.length > 0 ? (
        <HostUpgradeNotices labels={unsupportedHostLabels} />
      ) : null}
      {body}
    </View>
  );
}

function HostUpgradeNotices({ labels }: { labels: readonly string[] }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.noticeWrap} testID="notes-host-upgrade-notice">
      <View style={styles.notice}>
        {labels.map((label) => (
          <Text key={label} style={styles.noticeText}>
            {t("notes.hostUpgrade", { host: label })}
          </Text>
        ))}
      </View>
    </View>
  );
}

function noteSummaryKey(row: HostProjectNoteSummary): string {
  return `${row.serverId}:${row.projectId}`;
}

function noteRowStyle({ hovered, pressed }: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [styles.row, hovered ? styles.rowHovered : null, pressed ? styles.rowPressed : null];
}

function NoteSummaryRow({ row }: { row: HostProjectNoteSummary }): ReactElement {
  const { t } = useTranslation();
  const timeLabel = useCompactTimeAgo(new Date(row.updatedAt));
  const pendingLabel = row.pendingEntryCount > 0 ? ` · ${t("notes.pending")}` : "";

  const handlePress = useCallback(() => {
    router.push({
      pathname: "/notes/[projectId]",
      params: { projectId: row.projectId, server: row.serverId },
    });
  }, [row.projectId, row.serverId]);

  return (
    <Pressable
      onPress={handlePress}
      style={noteRowStyle}
      accessibilityRole="button"
      testID={`note-row-${row.serverId}-${row.projectId}`}
    >
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.projectName}>
          {row.projectName}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {row.hostLabel} · {t("notes.entryCount", { count: row.entryCount })}
          {pendingLabel}
        </Text>
      </View>
      <Text style={styles.time}>{timeLabel}</Text>
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
  noticeWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  notice: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  noticeText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
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
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  time: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
