import { describe, expect, it } from "vitest";
import { resolveSidebarResizeHandleGeometry } from "./sidebar-resize-handle-layout";

const MIN_TOUCH_TARGET = 24;
const MIN_LONG_TOUCH_LANE = 160;

describe("resolveSidebarResizeHandleGeometry", () => {
  it("keeps the touch hit area inside the sidebar so native hit-testing reaches it", () => {
    const geometry = resolveSidebarResizeHandleGeometry(false);

    expect(geometry.edgeOffset).toBeGreaterThanOrEqual(0);
    expect(geometry.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(geometry.height ?? 0).toBeGreaterThanOrEqual(MIN_LONG_TOUCH_LANE);
  });

  it("straddles the border for a fine pointer", () => {
    const geometry = resolveSidebarResizeHandleGeometry(true);

    expect(geometry.edgeOffset).toBe(-geometry.width / 2);
    expect(geometry.height).toBeNull();
  });
});
