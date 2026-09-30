import { beforeEach, describe, expect, it } from "vitest";
import {
  changeSidebarScrollScope,
  clearSidebarScrollMemory,
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

function laidOut(input: {
  scopeKey: string;
  storedOffset: number;
  contentHeight: number;
  viewportHeight: number;
}): SidebarScrollRestoreState {
  const initial = createSidebarScrollRestoreState({
    scopeKey: input.scopeKey,
    storedOffset: input.storedOffset,
  });
  const sized = recordSidebarScrollContentHeight(initial, input.contentHeight);
  return recordSidebarScrollViewportHeight(sized, input.viewportHeight);
}

describe("sidebar scroll memory", () => {
  beforeEach(() => {
    clearSidebarScrollMemory();
  });

  it("starts a scope it has never seen at the top", () => {
    expect(readSidebarScrollOffset("project|||")).toBe(0);
  });

  it("round-trips an offset for the same scope", () => {
    writeSidebarScrollOffset("host|srv_1||", 412);
    expect(readSidebarScrollOffset("host|srv_1||")).toBe(412);
  });

  it("drops the offset once the scope changes", () => {
    writeSidebarScrollOffset("project|||", 412);
    expect(readSidebarScrollOffset("host|||")).toBe(0);
  });

  it("never remembers a negative offset", () => {
    writeSidebarScrollOffset("project|||", -20);
    expect(readSidebarScrollOffset("project|||")).toBe(0);
  });
});

describe("sidebar scroll restore", () => {
  beforeEach(() => {
    clearSidebarScrollMemory();
  });

  it("has nothing to restore for a list that starts at the top", () => {
    const state = laidOut({
      scopeKey: "project|||",
      storedOffset: 0,
      contentHeight: 2_000,
      viewportHeight: 600,
    });
    expect(sidebarScrollRestoreTarget(state)).toBeNull();
  });

  it("waits for the viewport before restoring", () => {
    const state = recordSidebarScrollContentHeight(
      createSidebarScrollRestoreState({ scopeKey: "project|||", storedOffset: 300 }),
      2_000,
    );
    expect(sidebarScrollRestoreTarget(state)).toBeNull();
  });

  it("waits while the content is too short to hold the offset", () => {
    const state = laidOut({
      scopeKey: "project|||",
      storedOffset: 1_500,
      contentHeight: 900,
      viewportHeight: 600,
    });
    expect(sidebarScrollRestoreTarget(state)).toBeNull();
  });

  it("restores once the rows are tall enough", () => {
    const state = laidOut({
      scopeKey: "project|||",
      storedOffset: 900,
      contentHeight: 2_000,
      viewportHeight: 600,
    });
    expect(sidebarScrollRestoreTarget(state)).toBe(900);
  });

  it("treats its own scroll echo as settled and not worth writing back", () => {
    const state = markSidebarScrollRestoreIssued(
      laidOut({
        scopeKey: "project|||",
        storedOffset: 900,
        contentHeight: 2_000,
        viewportHeight: 600,
      }),
      900,
    );
    const result = reduceSidebarScroll(state, 900);
    expect(result.rememberedOffset).toBeNull();
    expect(result.state.pendingOffset).toBeNull();
    expect(sidebarScrollRestoreTarget(result.state)).toBeNull();
  });

  it("remembers a scroll the user made while a restore was pending", () => {
    const state = markSidebarScrollRestoreIssued(
      laidOut({
        scopeKey: "project|||",
        storedOffset: 900,
        contentHeight: 2_000,
        viewportHeight: 600,
      }),
      900,
    );
    const result = reduceSidebarScroll(state, 240);
    expect(result.rememberedOffset).toBe(240);
    expect(sidebarScrollRestoreTarget(result.state)).toBeNull();
  });

  it("remembers ordinary scrolling", () => {
    const state = laidOut({
      scopeKey: "project|||",
      storedOffset: 0,
      contentHeight: 2_000,
      viewportHeight: 600,
    });
    expect(reduceSidebarScroll(state, 120).rememberedOffset).toBe(120);
  });

  it("keeps known measurements when the scope changes but abandons the offset", () => {
    const previous = laidOut({
      scopeKey: "project|||",
      storedOffset: 0,
      contentHeight: 2_000,
      viewportHeight: 600,
    });
    const storedOffset = readSidebarScrollOffset("host|||");
    const next = changeSidebarScrollScope(previous, { scopeKey: "host|||", storedOffset });
    expect(next.scopeKey).toBe("host|||");
    expect(next.contentHeight).toBe(2_000);
    expect(next.viewportHeight).toBe(600);
    expect(sidebarScrollRestoreTarget(next)).toBeNull();
  });
});
