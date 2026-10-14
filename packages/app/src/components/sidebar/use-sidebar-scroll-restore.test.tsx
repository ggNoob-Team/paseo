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

const VIEWPORT_Y = 200;
const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 64;

type FakeScrollHandle = SidebarScrollHandle;

interface HookProps {
  active: boolean;
  activeRowKey?: string | null;
}

function measurable(input: { y: number; height?: number }): SidebarMeasurable {
  return {
    measureInWindow: (callback) => callback(0, input.y, 320, input.height ?? 64),
  };
}

interface RestoreFixtureInput {
  active?: boolean;
  activeRowKey?: string | null;
  /** The active row's top in the list's own scroll coordinates. */
  rowContentY?: number;
  /** How far the list can scroll; a row past it can never be topped. */
  maxOffset?: number;
  /** Pixels the rows above the active row gain after the list scrolls for it. */
  shiftAfterFirstScroll?: number;
}

function renderRestore(input: RestoreFixtureInput = {}) {
  const rowContentY = input.rowContentY ?? 700;
  const maxOffset = input.maxOffset ?? 1_400;
  // The row reports where it sits on screen, which follows the list's offset: a
  // scroll that lands short reports a short landing back on the next measure.
  const scene = { offset: 0, scrolls: 0, shift: 0 };
  // A real scroll view echoes its final offset back through `onScroll`, clamped
  // by how far the content scrolls. The fixture does the same so a scroll that
  // lands short is remembered as the offset it actually reached.
  let echoScroll: ((offset: number) => void) | null = null;
  const scrollToMock = vi.fn();
  const scrollHandle: FakeScrollHandle = {
    scrollTo: (options) => {
      scrollToMock(options);
      scene.scrolls += 1;
      scene.offset = Math.min(Math.max(0, options.y), maxOffset);
      if (scene.scrolls === 1 && input.shiftAfterFirstScroll) {
        scene.shift = input.shiftAfterFirstScroll;
      }
      echoScroll?.(scene.offset);
    },
  };
  const viewport = measurable({ y: VIEWPORT_Y, height: VIEWPORT_HEIGHT });
  const row: SidebarMeasurable = {
    measureInWindow: (callback) =>
      callback(0, VIEWPORT_Y + rowContentY - scene.offset + scene.shift, 320, ROW_HEIGHT),
  };
  const initialProps: HookProps = {
    active: input.active ?? false,
    activeRowKey: input.activeRowKey === undefined ? ROW_KEY : input.activeRowKey,
  };
  const hook = renderHook(
    ({ active, activeRowKey }: HookProps) =>
      useSidebarScrollRestore<SidebarScrollHandle>(SCOPE, { active, activeRowKey }),
    { initialProps },
  );

  echoScroll = (offset: number) => {
    // Called from inside the scroll handle, already within an act scope.
    hook.result.current.onScroll({
      nativeEvent: { contentOffset: { x: 0, y: offset } },
    } as NativeSyntheticEvent<NativeScrollEvent>);
  };

  act(() => {
    hook.result.current.scrollRef.current = scrollHandle;
    hook.result.current.viewportRef.current = viewport as unknown as View;
  });

  const layOutList = () => {
    act(() => {
      hook.result.current.onContentSizeChange(320, 2_000);
      hook.result.current.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: VIEWPORT_HEIGHT } },
      } as NativeSyntheticEvent<LayoutChangeEvent["nativeEvent"]>);
    });
  };

  const scrollTo = (offset: number) => {
    scene.offset = Math.min(Math.max(0, offset), maxOffset);
    act(() => {
      hook.result.current.onScroll({
        nativeEvent: { contentOffset: { x: 0, y: scene.offset } },
      } as NativeSyntheticEvent<NativeScrollEvent>);
    });
  };

  const registerRow = () => {
    act(() => {
      hook.result.current.registerRowNode(ROW_KEY, {}, row);
    });
  };

  const setActive = (active: boolean) => {
    act(() => {
      hook.rerender({ active, activeRowKey: initialProps.activeRowKey });
    });
  };

  const settle = (ms = 200) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  return { hook, scrollToMock, layOutList, scrollTo, registerRow, setActive, settle };
}

describe("sidebar row reveal", () => {
  beforeEach(() => {
    clearSidebarScrollMemory();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the position the user left the list at when the active row is on screen", () => {
    vi.useFakeTimers();
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive, settle } = renderRestore();
    layOutList();
    scrollTo(500);
    registerRow();

    setActive(true);
    settle();

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("keeps the position when the active row is only partly on screen", () => {
    vi.useFakeTimers();
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive, settle } = renderRestore();
    layOutList();
    // The row's top sits 20px above the list's top edge; its lower part is visible.
    scrollTo(720);
    registerRow();

    setActive(true);
    settle();

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("tops the list with the active row when it sits below the viewport", () => {
    vi.useFakeTimers();
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive, settle } = renderRestore();
    layOutList();
    scrollTo(0);
    registerRow();

    setActive(true);
    settle();

    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith({ y: 700, animated: false });
  });

  it("scrolls back up for a row that is above the viewport", () => {
    vi.useFakeTimers();
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive, settle } = renderRestore({
      rowContentY: 100,
    });
    layOutList();
    scrollTo(900);
    registerRow();

    setActive(true);
    settle();

    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith({ y: 100, animated: false });
  });

  it("re-aims when the rows above the active row settle after it lands", () => {
    vi.useFakeTimers();
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive, settle } = renderRestore({
      shiftAfterFirstScroll: 34,
    });
    layOutList();
    scrollTo(0);
    registerRow();

    setActive(true);
    settle();

    // The row landed 34px low once the rows above it grew, so the second scroll
    // closes that gap instead of leaving the row clipped by the list's top edge.
    expect(scrollToMock).toHaveBeenNthCalledWith(1, { y: 700, animated: false });
    expect(scrollToMock).toHaveBeenNthCalledWith(2, { y: 734, animated: false });
    expect(scrollToMock).toHaveBeenCalledTimes(2);
  });

  it("stops aiming when the list ends before the active row can reach the top", () => {
    vi.useFakeTimers();
    const { scrollToMock, layOutList, scrollTo, registerRow, setActive, settle } = renderRestore({
      rowContentY: 1_200,
      maxOffset: 1_150,
    });
    layOutList();
    scrollTo(0);
    registerRow();

    setActive(true);
    settle(2_000);

    expect(scrollToMock).toHaveBeenCalledTimes(1);
  });

  it("waits for the panel instead of scrolling a hidden list", () => {
    const { scrollToMock, layOutList, registerRow, setActive } = renderRestore();
    layOutList();
    registerRow();

    setActive(false);

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("does not move the list when no workspace is active", () => {
    const { scrollToMock, layOutList, registerRow, setActive } = renderRestore({
      activeRowKey: null,
    });
    layOutList();
    registerRow();

    setActive(true);

    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it("falls back to the remembered offset when the row never renders", () => {
    vi.useFakeTimers();
    writeSidebarScrollOffset(SCOPE, 700);
    const { scrollToMock, layOutList, setActive, settle } = renderRestore();
    layOutList();

    setActive(true);
    settle(2_000);

    expect(scrollToMock).toHaveBeenCalledWith({ y: 700, animated: false });
  });
});
