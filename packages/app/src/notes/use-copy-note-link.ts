import { useCallback } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";

/**
 * Copies a note's link and says so. Used by the list preview's long press and
 * by the detail screen's link rows, so both behave the same way.
 */
export function useCopyNoteLink(): (url: string) => void {
  const { t } = useTranslation();
  const toast = useToast();

  return useCallback(
    (url: string) => {
      void Clipboard.setStringAsync(url)
        .then(() => toast.show(t("notes.linkCopied"), { variant: "success" }))
        .catch(() => toast.error(t("notes.linkCopyFailed")));
    },
    [t, toast],
  );
}
