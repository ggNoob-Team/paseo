import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

export interface AddNoteDraft {
  /** The captured block. Shown verbatim; never edited here. */
  text: string;
  projectName: string;
}

function noop(): void {}

export interface AddNoteSheetProps {
  visible: boolean;
  draft: AddNoteDraft | null;
  /**
   * Changes whenever the sheet opens for a new capture, so the comment field
   * resets between snippets instead of carrying the previous remark over.
   */
  resetKey: number;
  onClose: () => void;
  onSubmit: (input: { comment: string | null }) => Promise<void> | void;
}

/**
 * The confirmation step between "add to notes" and the append. The captured text
 * is already chosen, so the only input is an optional remark explaining why it
 * matters; the daemon needs neither to store it.
 */
export function AddNoteSheet({
  visible,
  draft,
  resetKey,
  onClose,
  onSubmit,
}: AddNoteSheetProps): ReactElement {
  const { t } = useTranslation();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setComment("");
    setError(null);
    setIsPending(false);
  }, [visible, resetKey]);

  const handleChangeComment = useCallback((value: string) => {
    setComment(value);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isPending) return;
    try {
      setIsPending(true);
      await onSubmit({ comment: comment.trim().length > 0 ? comment.trim() : null });
      setIsPending(false);
      onClose();
    } catch (submitError) {
      setIsPending(false);
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : t("notes.addEntryFailed"),
      );
    }
  }, [comment, isPending, onClose, onSubmit, t]);

  const handleSubmitVoid = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("notes.addEntryTitle"),
      subtitle: draft?.projectName,
    }),
    [draft?.projectName, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={isPending ? noop : onClose}
      header={header}
      snapPoints={["70%", "92%"]}
      testID="add-note-sheet"
    >
      <View style={styles.body}>
        <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
          <Text selectable style={styles.previewText} testID="add-note-preview">
            {draft?.text ?? ""}
          </Text>
        </ScrollView>
        <AdaptiveTextInput
          initialValue=""
          resetKey={resetKey}
          onChangeText={handleChangeComment}
          placeholder={t("notes.addEntryPlaceholder")}
          multiline
          editable={!isPending}
          style={styles.input}
          testID="add-note-comment"
        />
        {error ? (
          <Text style={styles.errorText} testID="add-note-error">
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            onPress={onClose}
            disabled={isPending}
            testID="add-note-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={styles.actionButton}
            onPress={handleSubmitVoid}
            disabled={isPending || !draft}
            testID="add-note-confirm"
          >
            {isPending ? t("notes.addEntrySaving") : t("notes.addEntryConfirm")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  previewScroll: {
    maxHeight: 220,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  previewContent: {
    padding: theme.spacing[3],
  },
  previewText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  input: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    minHeight: 72,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
