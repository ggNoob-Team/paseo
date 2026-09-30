import { useCallback, useState, type ReactElement } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { useToast } from "@/contexts/toast-context";
import { useNotesCaptureOptional } from "./capture-context";

const ThemedNotebookPen = withUnistyles(NotebookPen);

/**
 * The header's "add to notes" action.
 *
 * Android does not expose the current text selection to JS — the selection
 * lives in the platform's floating toolbar — but the text the user copied out
 * of it is readable. So the flow is: long-press, tap Copy in the system menu,
 * then tap this button; whatever is on the clipboard becomes the entry, and the
 * sheet still lets it be trimmed before it is saved.
 *
 * Renders nothing when the surrounding screen has no notes context.
 */
export function NotesHeaderButton(): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const capture = useNotesCaptureOptional();
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);

  const copyClipboardIntoDraft = useCallback(async () => {
    try {
      const clipboardText = await Clipboard.getStringAsync();
      const text = clipboardText.trim();
      if (text.length === 0) {
        toast.show(t("notes.copyHint"), { variant: "warning" });
        return;
      }
      capture?.addText(text);
    } catch {
      toast.show(t("notes.copyHint"), { variant: "warning" });
    } finally {
      setIsReadingClipboard(false);
    }
  }, [capture, t, toast]);

  const handlePress = useCallback(() => {
    if (!capture || isReadingClipboard) return;
    setIsReadingClipboard(true);
    void copyClipboardIntoDraft();
  }, [capture, copyClipboardIntoDraft, isReadingClipboard]);

  if (!capture) return null;

  return (
    <HeaderToggleButton
      testID="workspace-notes-button"
      onPress={handlePress}
      tooltipLabel={t("notes.addEntryAction")}
      tooltipKeys={[]}
      tooltipSide="left"
      disabled={isReadingClipboard}
      accessible
      accessibilityRole="button"
      accessibilityLabel={t("notes.addEntryAction")}
    >
      <ThemedNotebookPen
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
