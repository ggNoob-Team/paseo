import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { StackScreenHeader } from "@/components/headers/stack-screen-header";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useToast } from "@/contexts/toast-context";
import { findNoteById, noteDisplayTitle, type HostNote } from "@/notes/notes-model";
import { NoteLinksSection } from "@/notes/note-links-section";
import { useNoteActions, useNotesList } from "@/notes/use-notes";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function NoteDetailScreen(): ReactElement {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ noteId?: string }>();
  const noteId = typeof params.noteId === "string" ? params.noteId : null;
  const { notes, isLoading } = useNotesList();
  const note = findNoteById(notes, noteId);

  let body: ReactElement;
  if (isLoading) {
    body = (
      <View style={styles.centered}>
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (!note) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{t("notes.missing")}</Text>
      </View>
    );
  } else {
    body = <NoteDetailBody key={note.noteId} note={note} />;
  }

  return (
    <View style={styles.container} testID="note-detail-screen">
      <StackScreenHeader title={note ? noteDisplayTitle(note) : t("notes.title")} />
      {body}
    </View>
  );
}

function NoteDetailBody({ note }: { note: HostNote }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const actions = useNoteActions(note.serverId);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(note.title ?? "");
  const [draftText, setDraftText] = useState(note.text);
  const [draftComment, setDraftComment] = useState(note.comment ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [editorSeed, setEditorSeed] = useState(0);

  useEffect(() => {
    if (isEditing) return;
    setDraftTitle(note.title ?? "");
    setDraftText(note.text);
    setDraftComment(note.comment ?? "");
  }, [isEditing, note.comment, note.text, note.title]);

  const handleStartEditing = useCallback(() => {
    setDraftTitle(note.title ?? "");
    setDraftText(note.text);
    setDraftComment(note.comment ?? "");
    setEditorSeed((seed) => seed + 1);
    setIsEditing(true);
  }, [note.comment, note.text, note.title]);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      await actions.updateNote(note, {
        title: draftTitle.trim().length > 0 ? draftTitle.trim() : null,
        text: draftText,
        comment: draftComment.trim().length > 0 ? draftComment.trim() : null,
      });
      toast.show(t("notes.bodySaved"), { variant: "success" });
      setIsEditing(false);
    } catch {
      toast.error(t("notes.bodySaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [actions, draftComment, draftText, draftTitle, note, t, toast]);

  const handleDelete = useCallback(() => {
    void confirmDialog({
      title: t("notes.deleteNote"),
      message: t("notes.deleteNoteConfirm"),
      confirmLabel: t("notes.deleteNote"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    }).then((confirmed) => {
      if (!confirmed) {
        return undefined;
      }
      return actions
        .deleteNote(note)
        .then(() => router.back())
        .catch(() => toast.error(t("notes.deleteNoteFailed")));
    });
  }, [actions, note, t, toast]);

  const handleDeletePress = useCallback(() => handleDelete(), [handleDelete]);
  const handleCancelEditing = useCallback(() => setIsEditing(false), []);
  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const headerActions = (
    <View style={styles.headerActions}>
      {isEditing ? (
        <Button variant="secondary" size="sm" onPress={handleCancelEditing} disabled={isSaving}>
          {t("common.actions.cancel")}
        </Button>
      ) : null}
      <Button
        variant="default"
        size="sm"
        onPress={isEditing ? handleSavePress : handleStartEditing}
        disabled={isSaving}
        testID={isEditing ? "note-save" : "note-edit"}
      >
        {isEditing ? t("notes.saveBody") : t("notes.editBody")}
      </Button>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content} testID="note-detail-scroll">
      {isEditing ? (
        <View style={styles.editor}>
          <AdaptiveTextInput
            initialValue={draftTitle}
            resetKey={`title-${editorSeed}`}
            onChangeText={setDraftTitle}
            placeholder={t("notes.titlePlaceholder")}
            editable={!isSaving}
            style={styles.titleInput}
            testID="note-title-input"
          />
          <AdaptiveTextInput
            initialValue={draftText}
            resetKey={`text-${editorSeed}`}
            onChangeText={setDraftText}
            multiline
            editable={!isSaving}
            style={styles.textInput}
            testID="note-text-input"
          />
          <AdaptiveTextInput
            initialValue={draftComment}
            resetKey={`comment-${editorSeed}`}
            onChangeText={setDraftComment}
            placeholder={t("notes.addEntryPlaceholder")}
            multiline
            editable={!isSaving}
            style={styles.commentInput}
            testID="note-comment-input"
          />
        </View>
      ) : (
        <View style={styles.viewer}>
          {note.title ? <Text style={styles.title}>{note.title}</Text> : null}
          <MarkdownRenderer text={note.text} />
          <NoteLinksSection text={note.text} />
          {note.comment ? <Text style={styles.comment}>{note.comment}</Text> : null}
          <NoteMetadata note={note} />
        </View>
      )}
      {isEditing ? null : (
        <Button
          variant="outline"
          size="sm"
          leftIcon={Trash2}
          onPress={handleDeletePress}
          style={styles.deleteRow}
          accessibilityRole="button"
          accessibilityLabel={t("notes.deleteNote")}
          testID="note-delete"
        >
          {t("notes.deleteNote")}
        </Button>
      )}
      {isEditing ? headerActions : null}
    </ScrollView>
  );
}

function NoteMetadata({ note }: { note: HostNote }): ReactElement {
  const createdLabel = useCompactTimeAgo(new Date(note.createdAt));
  const updatedLabel = useCompactTimeAgo(new Date(note.updatedAt));
  return (
    <Text style={styles.metadata}>
      {note.projectName} · {note.hostLabel} · {createdLabel} → {updatedLabel}
    </Text>
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
    padding: theme.spacing[6],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  content: {
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[8],
    },
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[3],
  },
  viewer: {
    gap: theme.spacing[3],
  },
  editor: {
    gap: theme.spacing[2],
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: "600",
  },
  comment: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontStyle: "italic",
  },
  metadata: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.85,
    marginTop: theme.spacing[2],
  },
  titleInput: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  textInput: {
    minHeight: 220,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  commentInput: {
    minHeight: 72,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  deleteRow: {
    alignSelf: "flex-start",
    marginTop: theme.spacing[4],
  },
}));
