import * as Clipboard from "expo-clipboard";

interface HarmonyClipboardBridge {
  readText(callback: (text: string) => void): void;
  writeText(text: string, callback: (copied: boolean) => void): void;
}

/** A bridge call that never answers is treated as no bridge at all. */
const BRIDGE_TIMEOUT_MS = 600;

/**
 * The last text this app put on the clipboard. A host that refuses to let the
 * page read the system clipboard still lets the app remember what it copied
 * itself, which is the case the notes capture is asked about.
 */
let lastCopiedText: string | null = null;

/** Runs a bridge call that answers through a callback, or gives up quietly. */
function bridgeRequest<T>(start: (done: (value: T) => void) => void, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const settle = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => settle(fallback), BRIDGE_TIMEOUT_MS);
    try {
      start((value) => {
        clearTimeout(timer);
        settle(value);
      });
    } catch {
      clearTimeout(timer);
      settle(fallback);
    }
  });
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
  lastCopiedText = text;
  const bridge = harmonyClipboardBridge();
  if (bridge) {
    const copied = await bridgeRequest<boolean>(
      (done) => bridge.writeText(text, (ok) => done(ok === true)),
      false,
    );
    if (copied) {
      return;
    }
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
    const text = await bridgeRequest<string>(
      (done) => bridge.readText((value) => done(typeof value === "string" ? value : "")),
      "",
    );
    if (text.length > 0) {
      return text;
    }
  }
  const systemText = await Clipboard.getStringAsync();
  if (systemText.length > 0) {
    return systemText;
  }
  return lastCopiedText ?? "";
}

/** Whether a paste has anything to paste. A refused read counts as nothing. */
export async function clipboardHasText(): Promise<boolean> {
  try {
    return (await readClipboardText()).length > 0;
  } catch {
    return false;
  }
}
