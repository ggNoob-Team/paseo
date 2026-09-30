import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Square, SquareCheck } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { joinSelectedBlocks, selectAllBlockIds, type MessageBlock } from "./message-blocks";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ThemedSquare = withUnistyles(Square);
const ThemedSquareCheck = withUnistyles(SquareCheck);

function noop(): void {}

export interface AddNoteDraft {
  /** The project the note belongs to, shown as the sheet's subtitle. */
  projectName: string;
  /** What the sheet opens with; the user may edit it before adding. */
  text: string;
  /**
   * Present only when the capture came from a message with several top-level
   * blocks. Picking blocks is how a phone selects more than the one block the
   * native selection handles allow.
   */
  blocks?: MessageBlock[];
}

export interface AddNoteSheetProps {
  visible: boolean;
  draft: AddNoteDraft | null;
  /**
   * Changes whenever the sheet opens for a new capture, so the fields reset
   * between snippets instead of carrying the previous one over.
   */
  resetKey: number;
  onClose: () => void;
  onSubmit: (input: { text: string; comment: string | null }) => Promise<void> | void;
}

/**
 * The confirmation step between "add to notes" and the append: choose the
 * blocks, trim the text if wanted, and optionally say why it matters. The
 * daemon needs none of it to store the entry, which is why the sheet is also
 * where an unsupported host would have stopped the flow.
 */
export function AddNoteSheet({
  visible,
  draft,
  resetKey,
  onClose,
  onSubmit,
}: AddNoteSheetProps): ReactElement {
  const { t } = useTranslation();
  const blocks = useMemo(() => draft?.blocks ?? [], [draft?.blocks]);
  const showsPicker = blocks.length > 1;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [capturedText, setCapturedText] = useState("");
  // The text input is uncontrolled; this is the value it is reseeded with when
  // the block selection changes. Typing never reseeds, so the caret stays put.
  const [inputSeed, setInputSeed] = useState({ text: "", revision: 0 });
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const nextBlocks = draft?.blocks ?? [];
    const nextText = draft?.text ?? "";
    setSelectedIds(nextBlocks.length > 1 ? selectAllBlockIds(nextBlocks) : new Set());
    setCapturedText(nextText);
    setInputSeed((previous) => ({ text: nextText, revision: previous.revision + 1 }));
    setComment("");
    setError(null);
    setIsPending(false);
  }, [draft, resetKey, visible]);

  const applySelection = useCallback(
    (next: Set<string>) => {
      setSelectedIds(next);
      const nextText = joinSelectedBlocks(blocks, next);
      setCapturedText(nextText);
      setInputSeed((previous) => ({ text: nextText, revision: previous.revision + 1 }));
      setError(null);
    },
    [blocks],
  );

  const handleToggleBlock = useCallback(
    (blockId: string) => {
      const next = new Set(selectedIds);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      applySelection(next);
    },
    [applySelection, selectedIds],
  );

  const handleSelectAll = useCallback(() => {
    applySelection(selectAllBlockIds(blocks));
  }, [applySelection, blocks]);

  const handleClearSelection = useCallback(() => {
    applySelection(new Set());
  }, [applySelection]);

  const handleChangeCapturedText = useCallback((value: string) => {
    setCapturedText(value);
    setError(null);
  }, []);

  const handleChangeComment = useCallback((value: string) => {
    setComment(value);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isPending) return;
    const text = capturedText.trim();
    if (text.length === 0) {
      setError(t("notes.nothingSelected"));
      return;
    }
    try {
      setIsPending(true);
      await onSubmit({ text, comment: comment.trim().length > 0 ? comment.trim() : null });
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
  }, [capturedText, comment, isPending, onClose, onSubmit, t]);

  const handleSubmitVoid = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("notes.addEntryTitle"), subtitle: draft?.projectName }),
    [draft?.projectName, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={isPending ? noop : onClose}
      header={header}
      snapPoints={["75%", "95%"]}
      testID="add-note-sheet"
    >
      <View style={styles.body}>
        {showsPicker ? (
          <View style={styles.picker} testID="add-note-blocks">
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerHint}>{t("notes.blocksHint")}</Text>
              <View style={styles.pickerActions}>
                <Button variant="ghost" size="sm" onPress={handleSelectAll}>
                  {t("notes.selectAll")}
                </Button>
                <Button variant="ghost" size="sm" onPress={handleClearSelection}>
                  {t("notes.clearSelection")}
                </Button>
              </View>
            </View>
            {blocks.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                selected={selectedIds.has(block.id)}
                onToggle={handleToggleBlock}
              />
            ))}
            <Text style={styles.selectionCount} testID="add-note-selection-count">
              {t("notes.selectionCount", { count: selectedIds.size })}
            </Text>
          </View>
        ) : null}
        <Text style={styles.fieldLabel}>{t("notes.textHint")}</Text>
        <AdaptiveTextInput
          initialValue={inputSeed.text}
          resetKey={inputSeed.revision}
          onChangeText={handleChangeCapturedText}
          multiline
          editable={!isPending}
          style={styles.textArea}
          testID="add-note-text"
        />
        <AdaptiveTextInput
          initialValue=""
          resetKey={resetKey}
          onChangeText={handleChangeComment}
          placeholder={t("notes.addEntryPlaceholder")}
          multiline
          editable={!isPending}
          style={styles.commentInput}
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

function BlockRow({
  block,
  selected,
  onToggle,
}: {
  block: MessageBlock;
  selected: boolean;
  onToggle: (blockId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(block.id), [block.id, onToggle]);
  const iconMapping = selected ? accentColorMapping : mutedColorMapping;
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      onPress={handlePress}
      style={styles.blockRow}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      testID={`add-note-block-${block.id}`}
    >
      {selected ? (
        <ThemedSquareCheck size={16} uniProps={iconMapping} />
      ) : (
        <ThemedSquare size={16} uniProps={iconMapping} />
      )}
      <Text numberOfLines={2} style={styles.blockText}>
        {block.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  picker: {
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  pickerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  pickerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  blockRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  blockText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flex: 1,
    minWidth: 0,
  },
  selectionCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  textArea: {
    maxHeight: 220,
    minHeight: 120,
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
