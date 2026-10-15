/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopyLink } from "./use-copy-link";

const clipboardMock = vi.hoisted(() => ({ copyToClipboard: vi.fn(async () => {}) }));
const toastMock = vi.hoisted(() => ({
  show: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/utils/clipboard", () => clipboardMock);
vi.mock("@/contexts/toast-context", () => ({ useToast: () => toastMock }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useCopyLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("copies the link and confirms it", async () => {
    const { result } = renderHook(() => useCopyLink());

    await act(async () => {
      result.current("https://paseo.sh");
    });

    expect(clipboardMock.copyToClipboard).toHaveBeenCalledWith("https://paseo.sh");
    expect(toastMock.show).toHaveBeenCalledWith("common.states.linkCopied", { variant: "success" });
  });

  it("says so when the clipboard refuses", async () => {
    clipboardMock.copyToClipboard.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderHook(() => useCopyLink());

    await act(async () => {
      result.current("https://paseo.sh");
    });

    expect(toastMock.error).toHaveBeenCalledWith("common.errors.unableToCopyLink");
  });
});
