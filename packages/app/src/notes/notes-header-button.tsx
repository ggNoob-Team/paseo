import { useCallback, type ReactElement } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";

const ThemedNotebookPen = withUnistyles(NotebookPen);

/**
 * The workspace header's notes action: it opens this project's notes, where the
 * "add note" button starts the capture flow. A host that cannot store notes
 * says so rather than opening a list that would stay empty.
 */
export function NotesHeaderButton({
  serverId,
  projectId,
  projectName,
}: {
  serverId: string;
  projectId: string;
  projectName: string;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const supportsNotes = useHostFeature(serverId, "notesPerEntry");

  const handlePress = useCallback(() => {
    if (!supportsNotes) {
      toast.show(t("notes.hostUpgrade", { host: serverId }), { variant: "warning" });
      return;
    }
    router.push({
      pathname: "/notes/project/[projectId]",
      params: { projectId, server: serverId, name: projectName },
    });
  }, [projectId, projectName, serverId, supportsNotes, t, toast]);

  return (
    <HeaderToggleButton
      testID="workspace-notes-button"
      onPress={handlePress}
      tooltipLabel={t("notes.title")}
      tooltipKeys={[]}
      tooltipSide="left"
      accessible
      accessibilityRole="button"
      accessibilityLabel={t("notes.title")}
    >
      <ThemedNotebookPen
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
