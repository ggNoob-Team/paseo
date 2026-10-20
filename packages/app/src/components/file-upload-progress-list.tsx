import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Check, Upload, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { isFileUploadInScope, useUploadStore, type FileUploadItem } from "@/stores/upload-store";
import type { Theme } from "@/styles/theme";

const ThemedUpload = withUnistyles(Upload);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);
const primaryIcon = (theme: Theme) => ({ color: theme.colors.primary });
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface FileUploadProgressListProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  canResume: boolean;
  onResume: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * Workspace-scoped upload queue under the Files toolbar. It stays visible while
 * any upload exists and keeps failed rows so they can resume from the daemon's
 * last confirmed offset.
 */
export function FileUploadProgressList({
  serverId,
  workspaceId,
  workspaceRoot,
  canResume,
  onResume,
  onDismiss,
}: FileUploadProgressListProps) {
  const { t } = useTranslation();
  const uploads = useUploadStore((state) => state.uploads);
  const items = useMemo(
    () =>
      [...uploads.values()]
        .filter((item) => isFileUploadInScope(item, { serverId, workspaceId, workspaceRoot }))
        .sort((left, right) => left.createdAt - right.createdAt),
    [serverId, uploads, workspaceId, workspaceRoot],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="file-upload-progress-list">
      <View style={styles.header}>
        <ThemedUpload size={14} uniProps={mutedIcon} />
        <Text style={styles.headerText}>{t("workspace.fileExplorer.upload.listTitle")}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{items.length}</Text>
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.list}
        nestedScrollEnabled
        showsVerticalScrollIndicator={items.length > 3}
      >
        {items.map((item) => (
          <FileUploadProgressRow
            key={item.id}
            item={item}
            canResume={canResume}
            onResume={onResume}
            onDismiss={onDismiss}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function FileUploadProgressRow({
  item,
  canResume,
  onResume,
  onDismiss,
}: {
  item: FileUploadItem;
  canResume: boolean;
  onResume: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const fraction = item.size > 0 ? Math.min(1, item.uploadedBytes / item.size) : 1;
  const percent = Math.round(fraction * 100);
  const isFailed = item.status === "failed";
  const isCompleted = item.status === "completed";

  const handleResume = useCallback(() => onResume(item.id), [item.id, onResume]);
  const handleDismiss = useCallback(() => onDismiss(item.id), [item.id, onDismiss]);
  const accessibilityValue = useMemo(() => ({ min: 0, max: 100, now: percent }), [percent]);

  let detail: string;
  if (isFailed) {
    detail = item.error ?? t("workspace.fileExplorer.errors.uploadFailed");
  } else if (isCompleted) {
    detail = t("workspace.fileExplorer.upload.completed");
  } else if (item.status === "queued") {
    detail = t("workspace.fileExplorer.upload.queued");
  } else {
    detail = t("workspace.fileExplorer.upload.progress", {
      percent,
      uploaded: formatBytes(item.uploadedBytes),
      total: formatBytes(item.size),
    });
  }

  let trailing: React.ReactElement | null = null;
  if (isCompleted) {
    trailing = <ThemedCheck size={18} uniProps={primaryIcon} />;
  } else if (isFailed) {
    trailing = (
      <View style={styles.failedActions}>
        {canResume ? (
          <Pressable
            onPress={handleResume}
            accessibilityRole="button"
            style={styles.resumeButton}
            testID={`file-upload-resume-${item.id}`}
          >
            <Text style={styles.resumeText}>{t("workspace.fileExplorer.upload.resume")}</Text>
          </Pressable>
        ) : (
          <Text style={styles.resumeUnavailable}>
            {t("workspace.fileExplorer.upload.resumeUnavailable")}
          </Text>
        )}
        <Pressable
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.fileExplorer.upload.dismiss")}
          style={styles.dismissButton}
          testID={`file-upload-dismiss-${item.id}`}
        >
          <ThemedX size={14} uniProps={mutedIcon} />
        </Pressable>
      </View>
    );
  } else if (item.status === "uploading") {
    trailing = <Text style={styles.percent}>{percent}%</Text>;
  }

  return (
    <View style={styles.row} testID={`file-upload-progress-${item.id}`}>
      <View style={styles.icon}>
        <MaterialFileIcon fileName={item.fileName} size={18} />
      </View>
      <View style={styles.body}>
        <Text style={styles.fileName} numberOfLines={1}>
          {item.fileName}
        </Text>
        <Text
          style={[styles.detail, isFailed && styles.failedDetail]}
          numberOfLines={1}
          testID={`file-upload-progress-${item.id}-detail`}
        >
          {detail}
        </Text>
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={accessibilityValue}
          aria-valuemin={accessibilityValue.min}
          aria-valuemax={accessibilityValue.max}
          aria-valuenow={accessibilityValue.now}
          testID={`file-upload-progress-${item.id}-bar`}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${percent}%` },
              isFailed && styles.failedFill,
              isCompleted && styles.completedFill,
            ]}
          />
        </View>
      </View>
      {trailing}
    </View>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  headerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: "center",
    backgroundColor: theme.colors.surface3,
  },
  countText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  scroll: {
    maxHeight: 168,
  },
  list: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  row: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  icon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  failedDetail: {
    color: theme.colors.destructive,
  },
  progressTrack: {
    height: 3,
    marginTop: 3,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: theme.colors.surface3,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },
  failedFill: {
    backgroundColor: theme.colors.destructive,
  },
  completedFill: {
    backgroundColor: theme.colors.primary,
  },
  percent: {
    minWidth: 34,
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  queued: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  resumeButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  resumeText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  resumeUnavailable: {
    maxWidth: 96,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  failedActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  dismissButton: {
    padding: theme.spacing[1],
  },
}));
