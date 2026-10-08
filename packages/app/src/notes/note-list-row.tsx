import { useCallback, type ReactElement } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { noteDisplayTitle, type HostNote } from "./notes-model";

/**
 * One note in a list: title, a few lines of the content, where it came from,
 * and a way into the detail screen. The all-notes list and a project's list
 * show the same row, so a note looks the same wherever it is found.
 */
export function NoteListRow({ note }: { note: HostNote }): ReactElement {
  const { t } = useTranslation();
  const timeLabel = useCompactTimeAgo(new Date(note.updatedAt));

  const handleOpen = useCallback(() => {
    router.push({ pathname: "/notes/[noteId]", params: { noteId: note.noteId } });
  }, [note.noteId]);

  return (
    <Pressable
      onPress={handleOpen}
      style={noteRowStyle}
      accessibilityRole="button"
      testID={`note-row-${note.noteId}`}
    >
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.title}>
          {noteDisplayTitle(note)}
        </Text>
        <Text numberOfLines={3} style={styles.preview}>
          {note.text}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {note.projectName} · {note.hostLabel} · {timeLabel}
        </Text>
      </View>
      <Pressable
        onPress={handleOpen}
        style={styles.detailsButton}
        accessibilityRole="button"
        accessibilityLabel={t("notes.details")}
        testID={`note-details-${note.noteId}`}
      >
        <Text style={styles.detailsLabel}>{t("notes.details")}</Text>
      </Pressable>
    </Pressable>
  );
}

function noteRowStyle({ hovered, pressed }: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [styles.row, hovered ? styles.rowHovered : null, pressed ? styles.rowPressed : null];
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
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
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  preview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.85,
  },
  detailsButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  detailsLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
