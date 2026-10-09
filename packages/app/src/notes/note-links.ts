import { buildNotePreviewSegments } from "./note-preview";

/**
 * Every openable link a note mentions, in the order it mentions them. The
 * detail screen lists these so a link inside the note can be copied, which a
 * long-press cannot do on every platform (iOS draws inline links in a
 * UITextView that does not forward long presses).
 */
export function extractNoteLinks(markdown: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const segment of buildNotePreviewSegments(markdown)) {
    if (!segment.href || seen.has(segment.href)) continue;
    seen.add(segment.href);
    links.push(segment.href);
  }
  return links;
}
