import type Token from "markdown-it/lib/token.mjs";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { isHttpUrl } from "@/utils/http-url";

/**
 * One run of preview text, with the link it points at when it is a link.
 * A note's list row renders these as nested text so a link stays tappable
 * inside a truncated preview.
 */
export interface NotePreviewSegment {
  /** Stable within one parse; the row uses it as the React key. */
  key: string;
  text: string;
  href: string | null;
}

const markdownParser = createMarkdownParser({ linkify: true });

/**
 * A plain-text preview of markdown, keeping only what is worth reading: inline
 * markers drop, code blocks keep their body, and links keep their target so the
 * row can open them without going into the note.
 */
export function buildNotePreviewSegments(markdown: string): NotePreviewSegment[] {
  const segments: NotePreviewSegment[] = [];
  let pendingHref: string | null = null;

  const push = (text: string, href: string | null) => {
    if (text.length === 0) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.href === href) {
      previous.text += text;
      return;
    }
    segments.push({ key: `preview_${segments.length}`, text, href });
  };

  for (const token of markdownParser.parse(markdown.trim(), {})) {
    if (token.type === "fence" || token.type === "code_block") {
      push(token.content.replace(/\n+$/, ""), null);
      push("\n", null);
      continue;
    }
    if (token.type !== "inline") continue;

    for (const child of token.children ?? []) {
      switch (child.type) {
        case "text":
        case "html_inline":
          push(child.content, pendingHref);
          break;
        case "code_inline":
          push(child.content, pendingHref);
          break;
        case "image":
          push(child.content, pendingHref);
          break;
        case "softbreak":
        case "hardbreak":
          push("\n", null);
          break;
        case "link_open":
          pendingHref = linkHref(child);
          break;
        case "link_close":
          pendingHref = null;
          break;
        default:
          break;
      }
    }
    push("\n", null);
  }

  trimTrailingBreaks(segments);
  if (segments.length === 0) {
    const fallback = markdown.trim();
    return fallback.length > 0 ? [{ key: "preview_0", text: fallback, href: null }] : [];
  }
  return segments;
}

function linkHref(token: Token): string | null {
  const href = token.attrs?.find(([name]) => name === "href")?.[1] ?? null;
  return href && isHttpUrl(href) ? href : null;
}

function trimTrailingBreaks(segments: NotePreviewSegment[]): void {
  while (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    last.text = last.text.replace(/\n+$/, "");
    if (last.text.length > 0) return;
    segments.pop();
  }
}
