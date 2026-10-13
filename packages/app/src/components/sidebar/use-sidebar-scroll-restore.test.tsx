/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  View,
} from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSidebarScrollMemory, writeSidebarScrollOffset } from "./sidebar-scroll-restore";
import {
  useSidebarScrollRestore,
  type SidebarMeasurable,
  type SidebarScrollHandle,
} from "./use-sidebar-scroll-restore";

const SCOPE = "host|srv_1||";
const ROW_KEY = "ws_1";

interface FakeScrollHandle extends SidebarScrollHandle {}

interface HookProps {
  active: boolean;
  activeRowKey?: string | null;
}

function measurable(input: { y: number; height?: number }): SidebarMeasurable {
  return {
    measureInWindow: (callback) => callback(0, input.y, 320, input.height ?? 64),
  };
}

function renderRestore(input?: { active?: boolean; activeRowKey?: string | null }) {
  const scrollToMock = vi.fn();
  const scrollHandle: FakeScrollHandle = {
    scrollTo: (options) => {
      scrollToMock(options);
    },
  };
  const viewport = measurable({ y: 200, height: 600 });
  const initialProps: HookProps = {
    active: input?.active ?? false,
    activeRowKey: input?.activeRowKey === undefined ? ROW_KEY : input.activeRowKey,
  };
  const hook = renderHook(
    ({ active, activeRowKey }: HookProps) =>
      useSidebarScrollRestore<SidebarScrollHandle>(SCOPE, { active, activeRowKey }),
    { initialProps },
  );

  act(() => {
    hook.result.current.scrollRef.current = scrollHandle;
    hook.result.current.viewportRef.current = viewport as unknown as View;
  });

  const layOutList = () => {
    act(() => {
      hook.result.current.onContentSizeChange(320, 2_000);
      hook.result.current.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 600 } },
      } as NativeSyntheticEvent<LayoutChangeEvent["nativeEvent"]>);
    });
  };

  const scrollTo = (offset: number) => {
    act(() => {
      hook.result.current.onScroll({
        nativeEvent: { contentOffset: { x: 0, y: offset } },
      } as NativeSyntheticEvent<NativeScrollEvent>);
    });
  };

  const registerRow = (node: SidebarMeasurable | null) => {
    act(() => {
      hook.result.current.registerRowNode(ROW_KEY, {}, node);
    });
  };

  const setActive = (active: boolean) => {
    act(() => {
      hook.rerender({ active, activeRowKey: initialProps.activeRowKey });
    });
  };

  return { hook, scrollToMock, layOutList, scrollTo, registerRow, setActive };
}

describe("sidebar row reveal", () => {
  beforeEach(() => {
    clearSidebarScrollMemory();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tops the list with the active row when the panel comes back", () => {
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive } = renderRestore();
    layOutList();
    scrollTo(100);
    registerRow(measurable({ y: 500 }));

    setActive(true);

    // The row sits 300px below the list top, so the list scrolls 300px further.
    expect(scrollToMock).toHaveBeenCalledWith({ y: 400, animated: false });
  });

  it("scrolls back up for a row that is above the viewport", () => {
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive } = renderRestore();
    layOutList();
    scrollTo(900);
    registerRow(measurable({ y: 260 }));

    setActive(true);

    expect(scrollToMock).toHaveBeenCalledWith({ y: 960, animated: false });
  });

  it("leaves the position alone when the row is already at the top", () => {
    const { scrollToMock, layOutList, registerRow, setActive } = renderRestore();
    layOutList();
    registerRow(measurable({ y: 200 }));

    setActive(true);

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("waits for the panel instead of scrolling a hidden list", () => {
    const { scrollToMock, layOutList, registerRow, setActive } = renderRestore();
    layOutList();
    registerRow(measurable({ y: 500 }));

    setActive(false);

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("does not move the list when no workspace is active", () => {
    const { scrollToMock, layOutList, registerRow, setActive } = renderRestore({
      activeRowKey: null,
    });
    layOutList();
    registerRow(measurable({ y: 500 }));

    setActive(true);

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("falls back to the remembered offset when the row never renders", () => {
    vi.useFakeTimers();
    writeSidebarScrollOffset(SCOPE, 700);
    const { scrollToMock, layOutList, setActive } = renderRestore();
    layOutList();

    setActive(true);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(scrollToMock).toHaveBeenCalledWith({ y: 700, animated: false });
  });
});
