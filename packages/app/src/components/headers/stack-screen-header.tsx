import React, { useCallback, type ReactNode } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import {
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getIsElectron } from "@/constants/platform";
import { buildOpenProjectRoute } from "@/utils/host-routes";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedX = withUnistyles(X);

/**
 * Header for screens pushed on top of the app shell (history, notes, recent…).
 *
 * Compact layouts get a back button: the sidebar toggle is drawn from app
 * chrome that a pushed screen covers, so on a phone it reads as a button that
 * does nothing. Wide layouts keep the toggle, which is where the sidebar is a
 * standing part of the window rather than an overlay.
 *
 * Only the desktop window draws chrome of its own — its titlebar carries the
 * close control and the sidebar stays on screen. Every other host (a phone, a
 * tablet-width browser, the HarmonyOS shell) gets a back button and a close
 * button in the header, so leaving a pushed screen never depends on a system
 * gesture or a window control that is not there.
 */
export function StackScreenHeader({
  title,
  rightContent,
}: {
  title?: string;
  rightContent?: ReactNode;
}): ReactNode {
  const isCompact = useIsCompactFormFactor();
  const hasWindowChrome = getIsElectron();
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(buildOpenProjectRoute());
  }, []);
  // Close leaves the pushed flow entirely; back only steps up one screen. On the
  // first screen of a flow they land in the same place.
  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.dismissAll();
      return;
    }
    router.replace(buildOpenProjectRoute());
  }, []);

  const closeButton = hasWindowChrome ? null : <StackScreenCloseButton onPress={handleClose} />;
  const actions = (
    <>
      {rightContent}
      {closeButton}
    </>
  );

  if (isCompact) {
    return <BackHeader title={title} rightContent={actions} onBack={handleBack} />;
  }
  if (hasWindowChrome) {
    return <MenuHeader title={title} rightContent={rightContent} />;
  }
  return (
    <ScreenHeader
      left={
        <>
          <StackScreenBackButton onPress={handleBack} />
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={actions}
      leftStyle={styles.left}
    />
  );
}

function StackScreenBackButton({ onPress }: { onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <ToolbarButton onPress={onPress} label={t("common.actions.back")} testID="stack-screen-back">
      <ThemedArrowLeft
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mutedIconColorMapping}
      />
    </ToolbarButton>
  );
}

function StackScreenCloseButton({ onPress }: { onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <ToolbarButton onPress={onPress} label={t("common.actions.close")} testID="stack-screen-close">
      <ThemedX
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mutedIconColorMapping}
      />
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme) => ({
  left: {
    gap: theme.spacing[2],
  },
}));
