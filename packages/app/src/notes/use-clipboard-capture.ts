import { useCallback, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useNotesCaptureOptional } from "./capture-context";

/**
 * Reads the text the user copied out of their selection and opens the note
 * sheet with it.
 *
 * Android does not expose the current selection to JS — the selection lives in
 * the platform's floating toolbar — so the clipboard is the one channel that
 * carries it. When there is nothing to read, say how to get it there instead of
 * opening an empty sheet.
 */
export function useClipboardNoteCapture(): {
  captureFromClipboard: () => void;
  isReadingClipboard: boolean;
  canCapture: boolean;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const capture = useNotesCaptureOptional();
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);

  const captureFromClipboard = useCallback(() => {
    if (!capture || isReadingClipboard) return;
    setIsReadingClipboard(true);
    void (async () => {
      try {
        const clipboardText = await Clipboard.getStringAsync();
        const text = clipboardText.trim();
        if (text.length === 0) {
          toast.show(t("notes.copyHint"), { variant: "warning" });
          return;
        }
        capture.addText(text);
      } catch {
        toast.show(t("notes.copyHint"), { variant: "warning" });
      } finally {
        setIsReadingClipboard(false);
      }
    })();
  }, [capture, isReadingClipboard, t, toast]);

  return { captureFromClipboard, isReadingClipboard, canCapture: capture !== null };
}
