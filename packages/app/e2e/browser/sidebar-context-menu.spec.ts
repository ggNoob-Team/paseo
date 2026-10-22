import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import type { Locator } from "@playwright/test";
import {
  closeProjectContextMenu,
  closeWorkspaceContextMenu,
  expectProjectContextMenuActions,
  expectWorkspaceContextMenuActions,
  expectWorkspaceContextMenuOwnsAttention,
  expectWorkspaceRowHoverCleared,
  openProjectContextMenu,
  openWorkspaceContextMenu,
  showWorkspaceHoverCard,
} from "../support/helpers/sidebar";

async function expectButtonVisibleThroughAncestors(button: Locator): Promise<void> {
  await expect
    .poll(() =>
      button.evaluate((element) => {
        let opacity = 1;
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          opacity *= Number(getComputedStyle(ancestor).opacity);
        }
        return opacity;
      }),
    )
    .toBe(1);
}

test.describe("Sidebar context menus", () => {
  test("Enter and Space toggle a project without starting a drag", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-project-keyboard-" });
    try {
      await gotoAppShell(page);
      const projectRow = page.getByTestId(`sidebar-project-row-${workspace.projectKey}`);
      const workspaceRow = page.getByTestId(
        `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
      );
      await expect(workspaceRow).toBeVisible({ timeout: 30_000 });
      await projectRow.focus();
      await page.keyboard.press("Enter");
      await expect(workspaceRow).toHaveCount(0);
      await expectButtonVisibleThroughAncestors(projectRow);
      await page.keyboard.press("Space");
      await expect(workspaceRow).toBeVisible();
      await expectButtonVisibleThroughAncestors(projectRow);
    } finally {
      await workspace.cleanup();
    }
  });

  test("right-clicking workspace and project rows opens their actions at the pointer", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-menu-" });

    try {
      await gotoAppShell(page);

      await showWorkspaceHoverCard(page, workspace.workspaceId);
      await openWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceContextMenuActions(page, workspace.workspaceId);
      await expectWorkspaceContextMenuOwnsAttention(page);

      await closeWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceRowHoverCleared(page, workspace.workspaceId);
      await openProjectContextMenu(page, workspace.projectKey);
      await expectProjectContextMenuActions(page, workspace.projectKey);

      await closeProjectContextMenu(page, workspace.projectKey);
    } finally {
      await workspace.cleanup();
    }
  });
});

for (const input of ["mouse", "touch"] as const) {
  const activationMethod = input === "touch" ? "tap" : "click";
  test.describe(`Project buttons with ${input} input`, () => {
    test.use({
      viewport: { width: 900, height: 960 },
      isMobile: input === "touch",
      hasTouch: input === "touch",
    });

    for (const groupMode of ["project", "host"] as const) {
      test(`${groupMode} grouping shows clickable project buttons without hovering`, async ({
        page,
      }, testInfo) => {
        const workspace = await seedWorkspace({ repoPrefix: "sidebar-project-buttons-" });
        const serverId = getServerId();
        const projectViewKey = projectEquivalenceViewKey(workspace.projectKey);
        const actionKey =
          groupMode === "host" ? `host:${serverId}:${projectViewKey}` : projectViewKey;
        try {
          await page.addInitScript((mode) => {
            localStorage.setItem(
              "sidebar-view",
              JSON.stringify({ state: { groupMode: mode }, version: 7 }),
            );
          }, groupMode);
          await gotoAppShell(page);
          await page.mouse.move(850, 800);

          const addButton = page.getByTestId(`sidebar-project-new-worktree-${actionKey}`);
          const menuButton = page.getByTestId(`sidebar-project-kebab-${actionKey}`);
          await expect(addButton).toBeVisible({ timeout: 30_000 });
          await expect(addButton).toHaveCSS("opacity", "1");
          await expect(menuButton).toBeVisible();
          await expectButtonVisibleThroughAncestors(menuButton);
          await page.screenshot({ path: testInfo.outputPath("project-buttons.png") });

          await addButton[activationMethod]();
          await expect(
            page.getByRole("button", { name: "Workspace project", exact: true }),
          ).toContainText(workspace.projectDisplayName);
          await expect(page).toHaveURL(
            (url) =>
              url.pathname === "/new" &&
              url.searchParams.get("serverId") === serverId &&
              url.searchParams.get("projectId") === workspace.projectId,
          );

          await gotoAppShell(page);
          await page.mouse.move(850, 800);
          await menuButton[activationMethod]();
          await page.mouse.move(850, 800);
          const settingsItem = page.getByTestId(`sidebar-project-menu-open-settings-${actionKey}`);
          await expect(settingsItem).toBeVisible();
          await expect(
            page.getByRole("menuitem", { name: "Remove project", exact: true }),
          ).toBeVisible();
          await settingsItem[activationMethod]();
          await expect(page).toHaveURL(
            (url) =>
              url.pathname ===
              `/settings/hosts/${encodeURIComponent(serverId)}/projects/${encodeURIComponent(workspace.projectId)}`,
          );
        } finally {
          await workspace.cleanup();
        }
      });
    }
  });
}
