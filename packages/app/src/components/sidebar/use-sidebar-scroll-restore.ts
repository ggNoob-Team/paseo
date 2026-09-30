import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  changeSidebarScrollScope,
  createSidebarScrollRestoreState,
  markSidebarScrollRestoreIssued,
  readSidebarScrollOffset,
  recordSidebarScrollContentHeight,
  recordSidebarScrollViewportHeight,
  reduceSidebarScroll,
  sidebarScrollRestoreTarget,
  writeSidebarScrollOffset,
  type SidebarScrollRestoreState,
} from "./sidebar-scroll-restore";

/**
 * The scroll view the hook drives. Gesture Handler's type is the one both hosts
 * agree on: `NestableScrollContainer` forwards an RNGH scroll view, and its
 * instance type is assignable to React Native's for the web branch.
 */
export type SidebarScrollView = GestureScrollView;

/** The slice of a scroll view's imperative surface this hook needs. */
export interface SidebarScrollHandle {
  scrollTo(options: { y: number; animated?: boolean }): void;
}

export interface SidebarScrollRestoreHandlers<T extends SidebarScrollHandle> {
  scrollRef: RefObject<T | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollEventThrottle: number;
}

/**
 * Keeps the workspace list where the user left it. The component may legitimately
 * unmount (the sidebar swaps to its skeleton while a host reconnects), so the
 * offset lives outside React and is re-applied once the rows are tall enough to
 * hold it. A scope change — different grouping mode or filter — starts at the top.
 */
export function useSidebarScrollRestore<T extends SidebarScrollHandle>(
  scopeKey: string,
): SidebarScrollRestoreHandlers<T> {
  const scrollRef = useRef<T | null>(null);
  const stateRef = useRef<SidebarScrollRestoreState | null>(null);

  if (stateRef.current === null) {
    stateRef.current = createSidebarScrollRestoreState({
      scopeKey,
      storedOffset: readSidebarScrollOffset(scopeKey),
    });
  }

  const applyRestore = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const target = sidebarScrollRestoreTarget(current);
    if (target === null) return;
    stateRef.current = markSidebarScrollRestoreIssued(current, target);
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, []);

  useEffect(() => {
    const current = stateRef.current;
    if (!current) return;
    if (current.scopeKey !== scopeKey) {
      const storedOffset = readSidebarScrollOffset(scopeKey);
      stateRef.current = changeSidebarScrollScope(current, { scopeKey, storedOffset });
      // Claim the memory slot so switching back does not resurrect an offset the
      // user has already left behind.
      if (storedOffset === 0) {
        writeSidebarScrollOffset(scopeKey, 0);
      }
    } else if (current.pendingOffset === null && current.echoOffset === null) {
      writeSidebarScrollOffset(scopeKey, 0);
    }
    applyRestore();
  }, [applyRestore, scopeKey]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const current = stateRef.current;
    if (!current) return;
    const result = reduceSidebarScroll(current, event.nativeEvent.contentOffset.y);
    stateRef.current = result.state;
    if (result.rememberedOffset !== null) {
      writeSidebarScrollOffset(result.state.scopeKey, result.rememberedOffset);
    }
  }, []);

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const current = stateRef.current;
      if (!current) return;
      stateRef.current = recordSidebarScrollContentHeight(current, height);
      applyRestore();
    },
    [applyRestore],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const current = stateRef.current;
      if (!current) return;
      stateRef.current = recordSidebarScrollViewportHeight(
        current,
        event.nativeEvent.layout.height,
      );
      applyRestore();
    },
    [applyRestore],
  );

  return {
    scrollRef,
    onScroll,
    onContentSizeChange,
    onLayout,
    scrollEventThrottle: 32,
  };
}
