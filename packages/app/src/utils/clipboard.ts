import * as Clipboard from "expo-clipboard";

interface HarmonyClipboardBridge {
  readText(): string;
  writeText(text: string): boolean;
}

/**
 * The HarmonyOS shell's pasteboard bridge, injected as `window.paseoClipboard`
 * (see packages/harmony/entry/src/main/ets/pages/Index.ets).
 *
 * ArkWeb's own clipboard API asks for a read permission the shell never
 * receives, so text the user had just copied read back empty and copy buttons
 * failed silently. The bridge is the same system clipboard without that gate.
 */
function harmonyClipboardBridge(): HarmonyClipboardBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const bridge = (window as unknown as { paseoClipboard?: Partial<HarmonyClipboardBridge> })
    .paseoClipboard;
  return typeof bridge?.readText === "function" && typeof bridge.writeText === "function"
    ? (bridge as HarmonyClipboardBridge)
    : null;
}

/** Copies text, preferring the shell's pasteboard where the platform has one. */
export async function copyToClipboard(text: string): Promise<void> {
  const bridge = harmonyClipboardBridge();
  if (bridge?.writeText(text) === true) {
    return;
  }
  await Clipboard.setStringAsync(text);
}

/**
 * Reads the clipboard's text. An empty string means there was nothing to read,
 * which is also what a shell that refuses the read reports — both leave the
 * caller to say how to copy in the first place.
 */
export async function readClipboardText(): Promise<string> {
  const bridge = harmonyClipboardBridge();
  if (bridge) {
    const text = bridge.readText();
    if (text.length > 0) {
      return text;
    }
  }
  return Clipboard.getStringAsync();
}

/** Whether a paste has anything to paste. A refused read counts as nothing. */
export async function clipboardHasText(): Promise<boolean> {
  try {
    return (await readClipboardText()).length > 0;
  } catch {
    return false;
  }
}
