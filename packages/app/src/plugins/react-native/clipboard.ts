import { copyToClipboard } from "@/utils/clipboard";

export async function copyText(text: string): Promise<void> {
  try {
    await copyToClipboard(text);
  } catch {
    throw new Error("Clipboard copy was denied or is unavailable");
  }
}
