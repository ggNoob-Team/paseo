import { memo, useCallback, useMemo, type ReactElement } from "react";
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
import { openExternalUrl } from "@/utils/open-external-url";
import { useCopyNoteLink } from "./use-copy-note-link";
import { noteDisplayTitle, type HostNote } from "./notes-model";
import { buildNotePreviewSegments, type NotePreviewSegment } from "./note-preview";

/**
 * One note in a list: title, a four-line preview of the content, where it came
 * from, and a way into the detail screen.
 *
 * The row itself is not a button — tapping the text does nothing, so a link
 * inside the preview can be tapped without opening the note. Links keep working
 * in the shortened preview; anything cut off by the ellipsis is reached through
 * the details screen.
 */
export const NoteListRow = memo(function NoteListRow({ note }: { note: HostNote }): ReactElement {
  const { t } = useTranslation();
  const timeLabel = useCompactTimeAgo(new Date(note.updatedAt));
  const preview = useMemo(() => buildNotePreviewSegments(note.text), [note.text]);
  const copyLink = useCopyNoteLink();

  const handleOpen = useCallback(() => {
    router.push({ pathname: "/notes/[noteId]", params: { noteId: note.noteId } });
  }, [note.noteId]);

  return (
    <View style={styles.row} testID={`note-row-${note.noteId}`}>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.title}>
          {noteDisplayTitle(note)}
        </Text>
        <Text numberOfLines={4} style={styles.preview}>
          {preview.map((segment) => (
            <NotePreviewSpan key={segment.key} segment={segment} onCopyLink={copyLink} />
          ))}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {note.projectName} · {note.hostLabel} · {timeLabel}
        </Text>
      </View>
      <Pressable
        onPress={handleOpen}
        style={detailsButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("notes.details")}
        testID={`note-details-${note.noteId}`}
      >
        <Text style={styles.detailsLabel}>{t("notes.details")}</Text>
      </Pressable>
    </View>
  );
});

function detailsButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [
    styles.detailsButton,
    hovered ? styles.detailsButtonHovered : null,
    pressed ? styles.detailsButtonPressed : null,
  ];
}

function NotePreviewSpan({
  segment,
  onCopyLink,
}: {
  segment: NotePreviewSegment;
  onCopyLink: (url: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (!segment.href) return;
    void openExternalUrl(segment.href).catch(() => undefined);
  }, [segment.href]);

  const handleLongPress = useCallback(() => {
    if (!segment.href) return;
    onCopyLink(segment.href);
  }, [onCopyLink, segment.href]);

  if (!segment.href) {
    return <Text>{segment.text}</Text>;
  }
  // Tap opens the link, long press copies it — the preview never opens the note.
  return (
    <Text
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={styles.previewLink}
      accessibilityRole="link"
      accessibilityHint={t("notes.copyLinkHint")}
      testID="note-preview-link"
    >
      {segment.text}
    </Text>
  );
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
  previewLink: {
    // Matches markdown links elsewhere in the app.
    color: theme.colors.accentBright,
    textDecorationLine: "none",
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
  detailsButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  detailsButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  detailsLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
