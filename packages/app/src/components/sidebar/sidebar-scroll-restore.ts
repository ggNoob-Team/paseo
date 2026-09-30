/**
 * Remembers where the sidebar's workspace list was scrolled to, so a list that
 * unmounts (the skeleton swap, a host reconnect, a route change on compact
 * layouts) can put the user back where they were instead of at the top.
 *
 * The memory is one slot, not a map: changing the grouping mode or a filter is
 * a different list, so the old offset is dropped rather than restored later.
 * Nothing is persisted — a cold start begins at the top.
 */

export interface SidebarScrollRestoreState {
  scopeKey: string;
  /** Offset still owed to the user, or null once they own the scroll position. */
  pendingOffset: number | null;
  /** Offset of a scroll we issued ourselves, awaiting its scroll event. */
  echoOffset: number | null;
  contentHeight: number;
  viewportHeight: number;
}

/** Landing within a pixel of the target is the same position at device scale factors. */
const OFFSET_EPSILON = 1;

let remembered: { scopeKey: string; offset: number } | null = null;

/**
 * Offset to restore for this scope. A scope the memory does not hold means the
 * list changed underneath the user (new grouping, new filter, first open), so
 * the answer is the top.
 */
export function readSidebarScrollOffset(scopeKey: string): number {
  if (!remembered || remembered.scopeKey !== scopeKey) {
    return 0;
  }
  return remembered.offset;
}

export function writeSidebarScrollOffset(scopeKey: string, offset: number): void {
  remembered = { scopeKey, offset: Math.max(0, offset) };
}

/** Test seam: the memory outlives components by design. */
export function clearSidebarScrollMemory(): void {
  remembered = null;
}

export function createSidebarScrollRestoreState(input: {
  scopeKey: string;
  storedOffset: number;
}): SidebarScrollRestoreState {
  return {
    scopeKey: input.scopeKey,
    pendingOffset: input.storedOffset > OFFSET_EPSILON ? input.storedOffset : null,
    echoOffset: null,
    contentHeight: 0,
    viewportHeight: 0,
  };
}

/**
 * A new scope is a new list. Positions are not carried across, and a list that
 * arrives at the top has nothing to restore.
 */
export function changeSidebarScrollScope(
  state: SidebarScrollRestoreState,
  input: { scopeKey: string; storedOffset: number },
): SidebarScrollRestoreState {
  return {
    ...createSidebarScrollRestoreState(input),
    // Layout already happened for this container; keep what we know about it.
    contentHeight: state.contentHeight,
    viewportHeight: state.viewportHeight,
  };
}

export function recordSidebarScrollContentHeight(
  state: SidebarScrollRestoreState,
  contentHeight: number,
): SidebarScrollRestoreState {
  if (state.contentHeight === contentHeight) {
    return state;
  }
  return { ...state, contentHeight };
}

export function recordSidebarScrollViewportHeight(
  state: SidebarScrollRestoreState,
  viewportHeight: number,
): SidebarScrollRestoreState {
  if (state.viewportHeight === viewportHeight) {
    return state;
  }
  return { ...state, viewportHeight };
}

/**
 * What to scroll to right now, or null while the content is too short for the
 * remembered offset — the rows are still arriving and scrolling now would land
 * short and lose the position.
 */
export function sidebarScrollRestoreTarget(state: SidebarScrollRestoreState): number | null {
  const { pendingOffset, contentHeight, viewportHeight } = state;
  if (pendingOffset === null || pendingOffset <= OFFSET_EPSILON) {
    return null;
  }
  if (viewportHeight <= 0) {
    return null;
  }
  const maxOffset = Math.max(0, contentHeight - viewportHeight);
  if (maxOffset + OFFSET_EPSILON < pendingOffset) {
    return null;
  }
  return pendingOffset;
}

export function markSidebarScrollRestoreIssued(
  state: SidebarScrollRestoreState,
  offset: number,
): SidebarScrollRestoreState {
  return { ...state, echoOffset: offset };
}

export interface SidebarScrollResult {
  state: SidebarScrollRestoreState;
  /** Offset worth remembering, or null for an echo of our own scroll. */
  rememberedOffset: number | null;
}

/**
 * A scroll event either confirms the restore we issued or means the user took
 * over. Either way the pending offset is settled; a confirmed echo is not worth
 * writing back.
 */
export function reduceSidebarScroll(
  state: SidebarScrollRestoreState,
  offsetY: number,
): SidebarScrollResult {
  const offset = Math.max(0, offsetY);
  const isEcho = state.echoOffset !== null && Math.abs(offset - state.echoOffset) <= OFFSET_EPSILON;
  const settled: SidebarScrollRestoreState = {
    ...state,
    pendingOffset: null,
    echoOffset: null,
  };
  return { state: settled, rememberedOffset: isEcho ? null : offset };
}
