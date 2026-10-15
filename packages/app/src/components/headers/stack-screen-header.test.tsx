/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StackScreenHeader } from "./stack-screen-header";

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  dismissAll: vi.fn(),
  replace: vi.fn(),
}));

const runtime = vi.hoisted(() => ({ isCompact: false, isElectron: false }));

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 4: 16 },
    borderRadius: { md: 6, lg: 8, full: 9999 },
    opacity: { 50: 0.5 },
    iconSize: { sm: 14, md: 16, lg: 24 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface2: "#222",
      interactionHighlight: "rgba(255,255,255,0.08)",
    },
    shadow: { sm: {} },
  },
}));

vi.mock("expo-router", () => ({ router: routerMock }));
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => runtime.isCompact,
}));
vi.mock("@/constants/platform", () => ({
  getIsElectron: () => runtime.isElectron,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({ uniProps, ...rest }: { uniProps?: (theme: unknown) => Record<string, unknown> }) => (
      <Component {...rest} {...(uniProps ? uniProps(theme) : {})} />
    ),
}));
vi.mock("lucide-react-native", () => ({
  ArrowLeft: () => <span data-testid="glyph-back" />,
  X: () => <span data-testid="glyph-close" />,
}));
// The children are other header variants; this test is about which one the
// header chooses and what its buttons do.
vi.mock("@/components/headers/menu-header", () => ({
  MenuHeader: () => <div data-testid="menu-header" />,
}));
vi.mock("@/components/headers/back-header", () => ({
  BackHeader: ({ rightContent }: { rightContent?: React.ReactNode }) => (
    <div data-testid="back-header">{rightContent}</div>
  ),
}));
vi.mock("@/components/headers/screen-header", () => ({
  ScreenHeader: ({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) => (
    <div data-testid="screen-header">
      {left}
      {right}
    </div>
  ),
}));
vi.mock("@/components/headers/screen-title", () => ({
  ScreenTitle: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/headers/sidebar-menu-toggle", () => ({
  SidebarMenuToggle: () => <div data-testid="sidebar-menu-toggle" />,
}));

describe("StackScreenHeader", () => {
  beforeEach(() => {
    runtime.isCompact = false;
    runtime.isElectron = false;
    routerMock.canGoBack.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gives a wide host without window chrome a back button and a close button", () => {
    render(<StackScreenHeader title="Notes" />);

    expect(screen.getByTestId("stack-screen-back")).toBeTruthy();
    expect(screen.getByTestId("stack-screen-close")).toBeTruthy();
    expect(screen.getByTestId("sidebar-menu-toggle")).toBeTruthy();
  });

  it("steps up a screen with back and leaves the flow with close", () => {
    render(<StackScreenHeader title="Notes" />);

    fireEvent.click(screen.getByTestId("stack-screen-back"));
    expect(routerMock.back).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("stack-screen-close"));
    expect(routerMock.dismissAll).toHaveBeenCalledTimes(1);
  });

  it("leaves the desktop window to its own chrome", () => {
    runtime.isElectron = true;
    render(<StackScreenHeader title="Notes" />);

    expect(screen.getByTestId("menu-header")).toBeTruthy();
    expect(screen.queryByTestId("stack-screen-back")).toBeNull();
    expect(screen.queryByTestId("stack-screen-close")).toBeNull();
  });

  it("keeps the close button on a compact header", () => {
    runtime.isCompact = true;
    render(<StackScreenHeader title="Notes" />);

    expect(screen.getByTestId("back-header")).toBeTruthy();
    expect(screen.getByTestId("stack-screen-close")).toBeTruthy();
  });
});
