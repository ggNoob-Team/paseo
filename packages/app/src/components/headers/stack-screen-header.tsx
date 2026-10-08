import { useCallback, type ReactNode } from "react";
import { router } from "expo-router";
import { MenuHeader } from "@/components/headers/menu-header";
import { BackHeader } from "@/components/headers/back-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { buildOpenProjectRoute } from "@/utils/host-routes";

/**
 * Header for screens pushed on top of the app shell (history, notes, recent…).
 *
 * Compact layouts get a back button: the sidebar toggle is drawn from app
 * chrome that a pushed screen covers, so on a phone it reads as a button that
 * does nothing. Wide layouts keep the toggle, which is where the sidebar is a
 * standing part of the window rather than an overlay.
 */
export function StackScreenHeader({
  title,
  rightContent,
}: {
  title?: string;
  rightContent?: ReactNode;
}): ReactNode {
  const isCompact = useIsCompactFormFactor();
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(buildOpenProjectRoute());
  }, []);

  if (isCompact) {
    return <BackHeader title={title} rightContent={rightContent} onBack={handleBack} />;
  }
  return <MenuHeader title={title} rightContent={rightContent} />;
}
