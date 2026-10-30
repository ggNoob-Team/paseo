import { Redirect } from "expo-router";
import { useEffect } from "react";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import {
  resolveHostIndexRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { useAppSettings } from "@/hooks/use-settings";
import {
  consumeQuickInputLaunch,
  hasQuickInputLaunchBeenConsumed,
} from "@/quick-input/launch-gate";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import {
  useHasHydratedWorkspaces,
  useHasWorkspaces,
  useWorkspaceExists,
} from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";

export default function HostIndexRoute() {
  const serverId = useHostRouteServerId();
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const workspaceSelectionWorkspaceId =
    workspaceSelection?.serverId === serverId ? workspaceSelection.workspaceId : null;
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(serverId);
  const hasWorkspaces = useHasWorkspaces(serverId);
  const workspaceSelectionExists = useWorkspaceExists(serverId, workspaceSelectionWorkspaceId);
  const workspaceSelectionStatus = resolveWorkspaceSelectionStatus({
    hasHydratedWorkspaces,
    workspaceExists: workspaceSelectionExists,
  });
  const launchConsumed = hasQuickInputLaunchBeenConsumed();
  const routingToQuickInput =
    settings.quickInputEnabled &&
    !launchConsumed &&
    hasWorkspaces &&
    workspaceSelectionWorkspaceId !== null &&
    workspaceSelectionStatus !== "missing";

  useEffect(() => {
    if (settingsLoading || !isWorkspaceSelectionLoaded || !serverId) {
      return;
    }
    if (workspaceSelectionWorkspaceId && !hasHydratedWorkspaces) {
      return;
    }
    if (routingToQuickInput) {
      return;
    }
    consumeQuickInputLaunch();
  }, [
    hasHydratedWorkspaces,
    isWorkspaceSelectionLoaded,
    routingToQuickInput,
    serverId,
    settingsLoading,
    workspaceSelectionWorkspaceId,
  ]);

  if (
    !serverId ||
    !isWorkspaceSelectionLoaded ||
    settingsLoading ||
    (workspaceSelectionWorkspaceId && !hasHydratedWorkspaces)
  ) {
    return <StartupSplashScreen />;
  }

  return (
    <Redirect
      href={resolveHostIndexRoute({
        serverId,
        workspaceSelection,
        workspaceSelectionStatus,
        quickInput: {
          enabled: settings.quickInputEnabled,
          launchConsumed,
          hasWorkspaces,
        },
      })}
    />
  );
}
