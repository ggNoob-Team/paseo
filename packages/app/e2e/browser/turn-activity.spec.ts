import { test, expect } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("collapses a completed turn and expands its process in order", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "turn-activity-",
    title: "Turn activity",
    model: "ten-second-stream",
  });

  try {
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Review the scroll behavior.");
    await agent.client.waitForFinish(agent.agentId, 60_000);

    await expect(page.getByText("(end of synthetic stream)", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);

    const activity = page.getByTestId("turn-activity").last();
    await expect(activity).toBeVisible();
    const toggle = activity.getByTestId("turn-activity-toggle");
    await expect(toggle).toContainText(/Worked for/);

    // The process is hidden by default: no reasoning rows and no command rows.
    await expect(page.getByText("Thinking", { exact: true })).toHaveCount(0);
    await expect(activity.getByTestId("tool-call-badge")).toHaveCount(0);

    await toggle.click();
    const details = activity.getByTestId("turn-activity-details");
    await expect(details).toBeVisible();
    await expect(
      details.getByText("I'll take a look at the scroll anchor behavior", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      details.getByText("Now I have a clearer picture", { exact: false }).first(),
    ).toBeVisible();
    await expect(details.getByText("Thinking", { exact: false })).toHaveCount(0);

    // Shell calls share one "Ran command" row instead of repeating per call. The mock
    // stream runs three separate execution streaks around commentary, so three rows is
    // the expected shape; inside each row the individual commands stay collapsed.
    const shellGroups = details.getByTestId("turn-activity-shell-group");
    await expect(shellGroups.last()).toBeVisible();
    await expect(shellGroups.last()).toContainText("Ran command");
    await expect(
      details.getByTestId("tool-call-badge").filter({ hasText: "Ran command" }),
    ).toHaveCount(0);

    const shellGroup = shellGroups.last();
    await expect(shellGroup.getByTestId("tool-call-badge")).toHaveCount(0);

    await shellGroup.getByRole("button").first().click();
    const commandRow = shellGroup.getByTestId("tool-call-badge").last();
    await expect(commandRow).toBeVisible();
    await expect(commandRow).toContainText("Shell");
    await expect(commandRow).toContainText("node scripts/simulate-stream-burst.mjs");

    // Each command row can be copied without expanding its output.
    await commandRow.hover();
    const copyCommandButton = commandRow.getByTestId("tool-call-copy-command");
    await expect(copyCommandButton).toBeVisible();
    await copyCommandButton.click();
    await expect(copyCommandButton).toHaveAttribute("aria-label", "Copied");

    const commandToggle = commandRow.getByRole("button").first();
    await commandRow.scrollIntoViewIfNeeded();
    await commandToggle.click();
    await expect(commandRow).toContainText("[burst] tick 1 userIsAtBottom=true");

    const activityOrder = await details.evaluate((root) =>
      [
        ...root.querySelectorAll(
          "[data-testid=assistant-message], [data-testid=turn-activity-shell-group]",
        ),
      ].map((node) => ({
        kind: node.getAttribute("data-testid"),
        text: node.textContent ?? "",
      })),
    );
    expect(activityOrder[0]?.kind).toBe("assistant-message");
    expect(activityOrder[0]?.text).toContain("I'll take a look");
    const groupIndex = activityOrder.findIndex(
      (entry) => entry.kind === "turn-activity-shell-group",
    );
    expect(groupIndex).toBeGreaterThan(0);
  } finally {
    await agent.cleanup();
  }
});

test("keeps completed turns collapsed after a reload", async ({ page }) => {
  test.setTimeout(150_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "turn-activity-reload-",
    title: "Turn activity reload",
    model: "ten-second-stream",
  });

  try {
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Review the scroll behavior.");
    await agent.client.waitForFinish(agent.agentId, 60_000);
    await expect(page.getByText("(end of synthetic stream)", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();
    await expectComposerVisible(page);
    await expect(page.getByText("(end of synthetic stream)", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // Nothing is expanded, so the history must not expose process rows or reasoning.
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);
    await expect(page.getByText("Thinking", { exact: true })).toHaveCount(0);

    // Scrolling into older rows must not reveal an unfolded process either.
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -4000);
    await expect(page.getByTestId("turn-activity").first()).toBeVisible();
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);
    await expect(page.getByText("Thinking", { exact: true })).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});
