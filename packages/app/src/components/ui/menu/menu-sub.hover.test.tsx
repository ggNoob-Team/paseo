/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuRoot, MenuTrigger } from "./menu-root";
import { MenuItem } from "./menu-item";
import { MenuSurface } from "./menu-surface";
import { MenuSubTrigger } from "./menu-sub";

const noopOpenChange = () => {};

beforeEach(() => vi.stubGlobal("React", React));
afterEach(cleanup);

/**
 * React derives enter/leave from over/out, and RNW hands the DOM event through as
 * `nativeEvent`, so the pointer type rides along to the menu handlers.
 */
function dispatchPointer(node: Element, type: "pointerover" | "pointerout", pointerType: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "relatedTarget", { value: document.body });
  node.dispatchEvent(event);
}

function renderGroupingMenu() {
  return render(
    <MenuRoot open onOpenChange={noopOpenChange}>
      <MenuTrigger accessibilityLabel="Display">
        <Text>Display</Text>
      </MenuTrigger>
      <MenuSurface
        pages={[
          {
            id: "grouping",
            title: "Grouping",
            content: <MenuItem testID="grouping-project">BY PROJECT</MenuItem>,
          },
        ]}
      >
        <MenuSubTrigger id="grouping" testID="sub-trigger">
          Grouping
        </MenuSubTrigger>
      </MenuSurface>
    </MenuRoot>,
  );
}

describe("MenuSubTrigger hover intent", () => {
  it("opens the page for a hovering mouse", async () => {
    renderGroupingMenu();
    dispatchPointer(screen.getByTestId("sub-trigger"), "pointerover", "mouse");

    await waitFor(() => expect(screen.getByTestId("grouping-project")).toBeTruthy());
  });

  it("ignores a finger, which enters and leaves in the same tap", async () => {
    renderGroupingMenu();
    const trigger = screen.getByTestId("sub-trigger");

    dispatchPointer(trigger, "pointerover", "touch");
    dispatchPointer(trigger, "pointerout", "touch");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.queryByTestId("grouping-project")).toBeNull();
  });

  it("keeps the page a press opened open when the finger lifts", async () => {
    renderGroupingMenu();
    const trigger = screen.getByTestId("sub-trigger");

    dispatchPointer(trigger, "pointerover", "touch");
    screen.getByTestId("sub-trigger").click();
    await waitFor(() => expect(screen.getByTestId("grouping-project")).toBeTruthy());
    dispatchPointer(trigger, "pointerout", "touch");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.getByTestId("grouping-project")).toBeTruthy();
  });
});
