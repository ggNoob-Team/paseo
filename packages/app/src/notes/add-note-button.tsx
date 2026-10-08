import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useClipboardNoteCapture } from "./use-clipboard-capture";

/**
 * "Add note" on a notes list: takes the copied text the user selected and opens
 * the sheet with it. The capture itself lives in the shared clipboard hook, so
 * every entry point behaves the same way.
 */
export function AddNoteButton({
  label,
  variant = "default",
}: {
  label?: string;
  variant?: "default" | "secondary" | "ghost" | "outline";
}): ReactElement {
  const { t } = useTranslation();
  const { captureFromClipboard, isReadingClipboard } = useClipboardNoteCapture();

  const handlePress = useCallback(() => {
    captureFromClipboard();
  }, [captureFromClipboard]);

  return (
    <Button
      variant={variant}
      size="sm"
      leftIcon={Plus}
      onPress={handlePress}
      disabled={isReadingClipboard}
      testID="notes-add-note"
    >
      {label ?? t("notes.addEntryAction")}
    </Button>
  );
}
