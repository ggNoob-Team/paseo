import { Alert } from "react-native";
import { getDesktopHost, type DesktopDialogAskOptions } from "@/desktop/host";
import { isNative } from "@/constants/platform";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmButtonConfig {
  confirmLabel: string;
  cancelLabel: string;
}

interface PendingConfirm {
  input: ConfirmDialogInput;
  resolve: (confirmed: boolean) => void;
}

/**
 * The web app draws its own confirmation dialog instead of asking the browser.
 * A browser `confirm()` is answered as "cancelled" by some hosts before the user
 * ever sees it (the HarmonyOS shell does exactly that), which made destructive
 * actions look like buttons that do nothing. The dialog host subscribes here;
 * `window.confirm` stays as the fallback for a page without the host mounted.
 */
let pendingConfirm: PendingConfirm | null = null;
const confirmListeners = new Set<(pending: PendingConfirm | null) => void>();

export function subscribeConfirmDialog(
  listener: (pending: PendingConfirm | null) => void,
): () => void {
  confirmListeners.add(listener);
  listener(pendingConfirm);
  return () => {
    confirmListeners.delete(listener);
  };
}

/** Answers the dialog the host is showing. */
export function resolveConfirmDialog(confirmed: boolean): void {
  const pending = pendingConfirm;
  pendingConfirm = null;
  for (const listener of confirmListeners) {
    listener(null);
  }
  pending?.resolve(confirmed);
}

function showAppConfirmDialog(input: ConfirmDialogInput): Promise<boolean> | null {
  if (confirmListeners.size === 0) {
    return null;
  }
  return new Promise<boolean>((resolve) => {
    pendingConfirm = { input, resolve };
    for (const listener of confirmListeners) {
      listener(pendingConfirm);
    }
  });
}

function resolveButtonLabels(input: ConfirmDialogInput): ConfirmButtonConfig {
  return {
    confirmLabel: input.confirmLabel ?? "Confirm",
    cancelLabel: input.cancelLabel ?? "Cancel",
  };
}

async function showNativeConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const labels = resolveButtonLabels(input);

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      input.title,
      input.message,
      [
        {
          text: labels.cancelLabel,
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: labels.confirmLabel,
          style: input.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

function getDesktopApi() {
  if (isNative) {
    return null;
  }
  return getDesktopHost();
}

function buildDesktopAskOptions(input: ConfirmDialogInput): DesktopDialogAskOptions {
  const labels = resolveButtonLabels(input);

  return {
    title: input.title,
    okLabel: labels.confirmLabel,
    cancelLabel: labels.cancelLabel,
    kind: input.destructive ? "warning" : "info",
  };
}

function blurActiveWebElement(): void {
  if (isNative) {
    return;
  }
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}

async function showDesktopConfirmDialog(input: ConfirmDialogInput): Promise<boolean | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return null;
  }

  blurActiveWebElement();
  const options = buildDesktopAskOptions(input);
  const desktopAsk = desktopApi.dialog?.ask;

  if (typeof desktopAsk === "function") {
    return await desktopAsk(input.message, options);
  }

  return null;
}

function showWebConfirmDialog(input: ConfirmDialogInput): boolean {
  const browserConfirm = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
  if (typeof browserConfirm !== "function") {
    throw new Error("[ConfirmDialog] No web confirmation backend is available.");
  }

  blurActiveWebElement();
  const promptMessage = `${input.title}\n\n${input.message}`;
  return browserConfirm(promptMessage);
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  if (isNative) {
    return showNativeConfirmDialog(input);
  }

  const desktopResult = await showDesktopConfirmDialog(input);
  if (desktopResult !== null) {
    return desktopResult;
  }

  const appResult = showAppConfirmDialog(input);
  if (appResult !== null) {
    return appResult;
  }

  return showWebConfirmDialog(input);
}

export const __private__ = {
  blurActiveWebElement,
  buildDesktopAskOptions,
};
