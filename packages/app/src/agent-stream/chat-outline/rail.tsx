import type { ActivePromptSource, ChatOutlinePrompt } from "./model";

export interface ChatOutlineRailProps {
  prompts: ChatOutlinePrompt[];
  activePrompt: ActivePromptSource;
  onJumpToPrompt: (seq: number) => void;
  /**
   * Below the full pane width the rail drops magnification and previews: there
   * is no pointer, and the transcript only gave it the reserved gutter.
   */
  compact?: boolean;
}

// The outline is a wide-layout pointer affordance. Native navigates the transcript by
// scrolling, so there is no rail to render.
export function ChatOutlineRail(_props: ChatOutlineRailProps): null {
  return null;
}
