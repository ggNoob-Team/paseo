/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { confirmDialog, resolveConfirmDialog, subscribeConfirmDialog } from "./confirm-dialog";

// No desktop host in these tests: the web paths are the ones under test.
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => null }));

describe("confirmDialog on a web host", () => {
  it("routes the question through the app's dialog host instead of the browser", async () => {
    const question = { title: "Delete note", message: "This cannot be undone." };
    const seen: string[] = [];
    const unsubscribe = subscribeConfirmDialog((pending) => {
      seen.push(pending ? pending.input.message : "closed");
    });
    const browserConfirm = vi.fn(() => true);
    (globalThis as { confirm?: () => boolean }).confirm = browserConfirm;

    const answer = confirmDialog(question);
    // The subscription starts with whatever is pending (nothing); the question
    // arrives once confirmDialog has looked for a desktop host.
    await vi.waitFor(() => expect(seen).toEqual(["closed", "This cannot be undone."]));

    resolveConfirmDialog(false);
    await expect(answer).resolves.toBe(false);
    await vi.waitFor(() => expect(seen).toEqual(["closed", "This cannot be undone.", "closed"]));
    // The host answered, so the browser was never asked.
    expect(browserConfirm).not.toHaveBeenCalled();

    unsubscribe();
    delete (globalThis as { confirm?: () => boolean }).confirm;
  });

  it("falls back to the browser when no host is mounted", async () => {
    const browserConfirm = vi.fn(() => true);
    (globalThis as { confirm?: () => boolean }).confirm = browserConfirm;

    await expect(confirmDialog({ title: "Title", message: "Message" })).resolves.toBe(true);
    expect(browserConfirm).toHaveBeenCalledWith("Title\n\nMessage");

    delete (globalThis as { confirm?: () => boolean }).confirm;
  });
});
