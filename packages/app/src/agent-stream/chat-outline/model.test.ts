import { describe, expect, it } from "vitest";
import {
  CHAT_OUTLINE_INSET_PX,
  createActivePromptPublisher,
  resolveChatOutlineRailLayout,
  shouldAcceptPromptIndexEpoch,
  promptTickMagnification,
  resolveActivePromptSeq,
  OUTLINE_MAGNIFY_RADIUS,
  type ChatOutlinePrompt,
} from "./model";

describe("chat outline prompt index epoch", () => {
  it("accepts only the authoritative timeline epoch", () => {
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-2")).toBe(true);
    expect(shouldAcceptPromptIndexEpoch("epoch-2", "epoch-1")).toBe(false);
  });
});

function prompt(seq: number): ChatOutlinePrompt {
  return { seq, timestamp: new Date(seq).toISOString(), preview: `prompt ${seq}` };
}

describe("promptTickMagnification", () => {
  it("peaks under the pointer and decays to nothing at the radius", () => {
    expect(promptTickMagnification(0)).toBe(1);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS)).toBe(0);
    expect(promptTickMagnification(OUTLINE_MAGNIFY_RADIUS + 10)).toBe(0);
  });

  it("falls off monotonically and symmetrically around the pointer", () => {
    const above = [0, 1, 2, 3].map((distance) => promptTickMagnification(distance));
    const below = [0, -1, -2, -3].map((distance) => promptTickMagnification(distance));

    expect(above).toEqual(below);
    expect(above).toEqual([...above].sort((left, right) => right - left));
  });
});

describe("resolveActivePromptSeq", () => {
  const prompts = [prompt(2), prompt(9), prompt(20)];

  it("marks the prompt whose turn the reading position sits in", () => {
    expect(resolveActivePromptSeq(prompts, 9)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 14)).toBe(9);
    expect(resolveActivePromptSeq(prompts, 20)).toBe(20);
    expect(resolveActivePromptSeq(prompts, 99)).toBe(20);
  });

  it("marks nothing above the first prompt or without a reading position", () => {
    expect(resolveActivePromptSeq(prompts, 1)).toBeNull();
    expect(resolveActivePromptSeq(prompts, null)).toBeNull();
    expect(resolveActivePromptSeq([], 42)).toBeNull();
  });
});

describe("createActivePromptPublisher", () => {
  it("notifies subscribers only when the active prompt changes", () => {
    const publisher = createActivePromptPublisher();
    let notifications = 0;
    const unsubscribe = publisher.subscribe(() => {
      notifications += 1;
    });

    publisher.publish(9);
    publisher.publish(9);
    publisher.publish(20);
    unsubscribe();
    publisher.publish(null);

    expect(notifications).toBe(2);
    expect(publisher.getActiveSeq()).toBeNull();
  });
});

describe("resolveChatOutlineRailLayout", () => {
  it("stays away from a phone-wide pane", () => {
    expect(
      resolveChatOutlineRailLayout({ supportsRail: true, paneWidth: 600, promptCount: 4 }),
    ).toEqual({ visible: false, compact: true, leadingInset: 0 });
  });

  it("reserves a gutter for the rail on a tablet-wide pane", () => {
    expect(
      resolveChatOutlineRailLayout({ supportsRail: true, paneWidth: 700, promptCount: 4 }),
    ).toEqual({ visible: true, compact: true, leadingInset: CHAT_OUTLINE_INSET_PX });
  });

  it("uses the transcript's own gutter once the pane is wide", () => {
    expect(
      resolveChatOutlineRailLayout({ supportsRail: true, paneWidth: 1_200, promptCount: 4 }),
    ).toEqual({ visible: true, compact: false, leadingInset: 0 });
  });

  it("needs a host that indexes prompts and more than one prompt", () => {
    expect(
      resolveChatOutlineRailLayout({ supportsRail: false, paneWidth: 1_200, promptCount: 4 })
        .visible,
    ).toBe(false);
    expect(
      resolveChatOutlineRailLayout({ supportsRail: true, paneWidth: 1_200, promptCount: 1 })
        .visible,
    ).toBe(false);
  });
});
