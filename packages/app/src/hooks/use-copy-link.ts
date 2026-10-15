import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { copyToClipboard } from "@/utils/clipboard";

/**
 * Copies a link and says so. A link opens on a tap, so the long press is the
 * only way to take the URL away without leaving the app — used by the chat's
 * and the markdown renderer's links alike.
 */
export function useCopyLink(): (url: string) => void {
  const { t } = useTranslation();
  const toast = useToast();

  return useCallback(
    (url: string) => {
      void copyToClipboard(url)
        .then(() => toast.show(t("common.states.linkCopied"), { variant: "success" }))
        .catch(() => toast.error(t("common.errors.unableToCopyLink")));
    },
    [t, toast],
  );
}
