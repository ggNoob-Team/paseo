import type { PointerEvent } from "react-native";

/**
 * Hover intent belongs to a mouse. A finger fires the same pointer events as a
 * mouse — `pointerenter` on press, `pointerleave` on release — so a touch would
 * open a flyout and schedule its close in one tap, and the flyout would flash.
 * Pen hovering is treated like a finger: a tap is the gesture that opens a page.
 */
export function isPointerHover(event: PointerEvent): boolean {
  return event.nativeEvent.pointerType === "mouse";
}
