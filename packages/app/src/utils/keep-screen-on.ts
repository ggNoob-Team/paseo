import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

interface HarmonyKeepScreenOnBridge {
  setKeepScreenOn(enabled: boolean, callback: (kept: boolean) => void): void;
}

const BRIDGE_TIMEOUT_MS = 1_000;

/** Uses the shell's native window API when available, then falls back to Expo. */
export async function setKeepScreenOn(tag: string, enabled: boolean): Promise<void> {
  const bridge =
    typeof window === "undefined"
      ? null
      : (window as unknown as { paseoKeepScreenOn?: Partial<HarmonyKeepScreenOnBridge> })
          .paseoKeepScreenOn;

  if (bridge && typeof bridge.setKeepScreenOn === "function") {
    const bridgeMethod = bridge.setKeepScreenOn;
    try {
      const handled = await Promise.race([
        new Promise<boolean>((resolve) => {
          bridgeMethod.call(bridge, enabled, (kept) => resolve(kept === true));
        }),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), BRIDGE_TIMEOUT_MS);
        }),
      ]);
      if (handled) {
        return;
      }
    } catch {
      // Fall through to Expo's wake lock.
    }
  }

  if (enabled) {
    await activateKeepAwakeAsync(tag);
  } else {
    await deactivateKeepAwake(tag).catch(() => undefined);
  }
}
