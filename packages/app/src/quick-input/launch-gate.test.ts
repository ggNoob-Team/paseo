import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeQuickInputLaunch,
  hasQuickInputLaunchBeenConsumed,
  resetQuickInputLaunchGateForTests,
} from "./launch-gate";

describe("quick input launch gate", () => {
  beforeEach(resetQuickInputLaunchGateForTests);

  it("shows quick input once per process launch", () => {
    expect(hasQuickInputLaunchBeenConsumed()).toBe(false);
    consumeQuickInputLaunch();
    expect(hasQuickInputLaunchBeenConsumed()).toBe(true);
  });
});
