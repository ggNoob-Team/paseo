import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";

export function QuickInputSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const change = useCallback(
    (quickInputEnabled: boolean) => void updateSettings({ quickInputEnabled }),
    [updateSettings],
  );
  return (
    <SettingsSection title={t("settings.general.quickInput.title")}>
      <SettingsCard>
        <SettingsSwitch
          label={t("settings.general.quickInput.label")}
          hint={t("settings.general.quickInput.description")}
          value={settings.quickInputEnabled}
          onValueChange={change}
          testID="quick-input-setting"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
