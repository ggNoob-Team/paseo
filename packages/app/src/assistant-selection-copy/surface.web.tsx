import { useCallback, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useNotesCaptureOptional } from "@/notes/capture-context";
import { createAssistantSelectionClipboardContent } from "./content.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

export function AssistantSelectionCopySurface({
  children,
  style,
}: AssistantSelectionCopySurfaceProps) {
  const capture = useNotesCaptureOptional();

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  /**
   * Desktop's answer to the mobile long-press: right-clicking a selection offers
   * to keep it. Only a real selection is intercepted — an empty right click is
   * still the browser's own menu.
   */
  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!capture) return;
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (text.length === 0) return;
      event.preventDefault();
      capture.addText(text);
    },
    [capture],
  );

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      node?.removeEventListener("contextmenu", handleContextMenu);
      node?.addEventListener("contextmenu", handleContextMenu);
    },
    [handleContextMenu],
  );

  return (
    <div ref={setRef} onCopy={handleCopy} style={DISPLAY_CONTENTS}>
      <View style={style}>{children}</View>
    </div>
  );
}
