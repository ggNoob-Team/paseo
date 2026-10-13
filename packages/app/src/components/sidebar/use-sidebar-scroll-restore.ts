import { createContext, useCallback, useContext, useEffect, useRef, type RefObject } from "react";
import type { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  View,
} from "react-native";
import {
  changeSidebarScrollScope,
  createSidebarScrollRestoreState,
  markSidebarScrollRestoreIssued,
  readSidebarScrollOffset,
  recordSidebarScrollContentHeight,
  recordSidebarScrollViewportHeight,
  reduceSidebarScroll,
  sidebarScrollRevealTarget,
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

/** Bounded wait for the panel to lay out and for the row to render itself. */
const REVEAL_MAX_ATTEMPTS = 20;
const REVEAL_RETRY_MS = 32;

/** The slice of a scroll view's imperative surface this hook needs. */
export interface SidebarScrollHandle {
  scrollTo(options: { y: number; animated?: boolean }): void;
}

/** Anything whose on-screen rectangle can be read; rows and list containers qualify. */
export interface SidebarMeasurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

export type SidebarRowNodeRegistration = (
  workspaceKey: string,
  /** Identity of the row instance; one workspace can render more than once. */
  token: object,
  node: SidebarMeasurable | null,
) => void;

/**
 * Rows register themselves so the list can scroll to one by key. Context rather
 * than props: the rows live several layers down inside each grouping mode.
 */
const SidebarRowNodeRegistrationContext = createContext<SidebarRowNodeRegistration | null>(null);

export function useSidebarRowNodeRegistration(): SidebarRowNodeRegistration | null {
  return useContext(SidebarRowNodeRegistrationContext);
}

export const SidebarRowNodeRegistrationProvider = SidebarRowNodeRegistrationContext.Provider;

export interface SidebarScrollRestoreOptions {
  /**
   * Whether the list's panel is on screen. A reveal waits for the panel: a list
   * that is hidden cannot be measured on every platform.
   */
  active?: boolean;
  /** The workspace row the reader is inside; it is what a reveal tops the list with. */
  activeRowKey?: string | null;
}

export interface SidebarScrollRestoreHandlers<T extends SidebarScrollHandle> {
  scrollRef: RefObject<T | null>;
  /** The container the scroll view fills; the reveal measures rows against it. */
  viewportRef: RefObject<View | null>;
  registerRowNode: SidebarRowNodeRegistration;
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
  options: SidebarScrollRestoreOptions = {},
): SidebarScrollRestoreHandlers<T> {
  const scrollRef = useRef<T | null>(null);
  const viewportRef = useRef<View | null>(null);
  // A workspace can render twice (pinned and grouped), so a key maps to every
  // live node for it; unregistering one must not hide the other.
  const rowNodesRef = useRef(new Map<string, Map<object, SidebarMeasurable>>());
  const stateRef = useRef<SidebarScrollRestoreState | null>(null);
  const scrollOffsetRef = useRef(0);
  const activeRowKeyRef = useRef(options.activeRowKey ?? null);
  activeRowKeyRef.current = options.activeRowKey ?? null;
  const previousActiveRef = useRef<boolean | undefined>(undefined);

  if (stateRef.current === null) {
    stateRef.current = createSidebarScrollRestoreState({
      scopeKey,
      storedOffset: readSidebarScrollOffset(scopeKey),
    });
  }

  const registerRowNode = useCallback<SidebarRowNodeRegistration>((workspaceKey, token, node) => {
    const nodes = rowNodesRef.current.get(workspaceKey) ?? new Map<object, SidebarMeasurable>();
    if (node) {
      nodes.set(token, node);
      rowNodesRef.current.set(workspaceKey, nodes);
      return;
    }
    nodes.delete(token);
    if (nodes.size === 0) {
      rowNodesRef.current.delete(workspaceKey);
    }
  }, []);

  const applyRestore = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const target = sidebarScrollRestoreTarget(current);
    if (target === null) return;
    stateRef.current = markSidebarScrollRestoreIssued(current, target);
    scrollOffsetRef.current = target;
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
    const offset = event.nativeEvent.contentOffset.y;
    scrollOffsetRef.current = Math.max(0, offset);
    const result = reduceSidebarScroll(current, offset);
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

  /**
   * A reveal waits for the panel and for the row, then scrolls the row to the
   * top of the list. Rows that are not rendered yet (a collapsed project, a
   * filter, a list still measuring) end the wait; the stored offset then owns
   * the position, which is what a plain re-open wants anyway.
   */
  useEffect(() => {
    const wasActive = previousActiveRef.current;
    previousActiveRef.current = options.active;
    // Only a panel that comes back on screen reveals a row: a list mounting for
    // the first time keeps whatever offset it remembered.
    if (wasActive !== false || options.active !== true) return;
    if (!activeRowKeyRef.current) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const retry = () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > REVEAL_MAX_ATTEMPTS) {
        stop();
        applyRestore();
        return;
      }
      timer = setTimeout(attempt, REVEAL_RETRY_MS);
    };
    const attempt = () => {
      if (cancelled) return;
      const rowKey = activeRowKeyRef.current;
      const rowNodes = rowKey ? rowNodesRef.current.get(rowKey) : undefined;
      const row = rowNodes?.values().next().value as SidebarMeasurable | undefined;
      const viewport = viewportRef.current;
      const scrollView = scrollRef.current;
      if (!row || !viewport || !scrollView) {
        retry();
        return;
      }
      row.measureInWindow((_x, rowY, _width, rowHeight) => {
        if (cancelled) return;
        if (rowHeight <= 0) {
          retry();
          return;
        }
        viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
          if (cancelled) return;
          if (viewportHeight <= 0) {
            retry();
            return;
          }
          const target = sidebarScrollRevealTarget({
            currentOffset: scrollOffsetRef.current,
            rowViewportY: rowY - viewportY,
          });
          stop();
          const current = stateRef.current;
          // Either way the stored offset is settled: the row is now what the
          // position means, so a late content-size event must not scroll away.
          if (current) {
            stateRef.current =
              target === null
                ? { ...current, pendingOffset: null, echoOffset: null }
                : markSidebarScrollRestoreIssued(current, target);
          }
          if (target === null) return;
          scrollOffsetRef.current = target;
          writeSidebarScrollOffset(scopeKey, target);
          scrollView.scrollTo({ y: target, animated: false });
        });
      });
    };

    attempt();
    return () => {
      cancelled = true;
      stop();
    };
  }, [applyRestore, options.active, scopeKey]);

  return {
    scrollRef,
    viewportRef,
    registerRowNode,
    onScroll,
    onContentSizeChange,
    onLayout,
    scrollEventThrottle: 32,
  };
}
