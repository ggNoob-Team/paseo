import { memo, useCallback, type ReactElement } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useNotesCaptureOptional } from "./capture-context";

const ThemedNotebookPen = withUnistyles(NotebookPen);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const hoveredColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * "Add to notes" for one block of chat content. Markdown content opens the
 * block picker; plain content (a code fence) goes straight to the editor.
 *
 * Renders nothing outside an agent chat, which keeps every caller a plain
 * <... /> with no capability check of its own.
 */
export const AddToNotesButton = memo(function AddToNotesButton({
  getContent,
  contentKind = "markdown",
  containerStyle,
  accessibilityLabel,
}: {
  getContent: () => string;
  contentKind?: "markdown" | "text";
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const capture = useNotesCaptureOptional();

  const handlePress = useCallback(() => {
    if (!capture) return;
    const content = getContent();
    if (content.trim().length === 0) return;
    if (contentKind === "text") capture.addText(content);
    else capture.addMarkdown(content);
  }, [capture, contentKind, getContent]);

  if (!capture) return null;

  return (
    <Pressable
      onPress={handlePress}
      style={containerStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? t("notes.addEntryAction")}
      testID="add-to-notes"
    >
      {({ hovered }) => (
        <ThemedNotebookPen
          size={ICON_SIZE.sm}
          uniProps={hovered ? hoveredColorMapping : mutedColorMapping}
        />
      )}
    </Pressable>
  );
});
