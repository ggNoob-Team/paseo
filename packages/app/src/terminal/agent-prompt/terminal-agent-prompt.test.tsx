// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/stores/session-store";
import { TerminalAgentPrompt } from "./terminal-agent-prompt";

const {
  client,
  createWorkspaceMock,
  sendAgentMessageMock,
  waitForFinishMock,
  setAgentModelMock,
  archiveWorkspaceMock,
} = vi.hoisted(() => {
  const createWorkspaceFn = vi.fn();
  const sendAgentMessageFn = vi.fn(async () => ({}));
  const waitForFinishFn = vi.fn();
  const setAgentModelFn = vi.fn(async () => undefined);
  const archiveWorkspaceFn = vi.fn(async () => ({}));
  return {
    createWorkspaceMock: createWorkspaceFn,
    sendAgentMessageMock: sendAgentMessageFn,
    waitForFinishMock: waitForFinishFn,
    setAgentModelMock: setAgentModelFn,
    archiveWorkspaceMock: archiveWorkspaceFn,
    client: {
      supportsBackgroundWorkspaces: () => true,
      createWorkspace: createWorkspaceFn,
      sendAgentMessage: sendAgentMessageFn,
      waitForFinish: waitForFinishFn,
      setAgentModel: setAgentModelFn,
      archiveWorkspace: archiveWorkspaceFn,
    },
  };
});

const { theme } = vi.hoisted(() => ({
  theme: {
    colors: {
      border: "#333",
      surface0: "#111",
      surface1: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      primary: "#08f",
      accent: "#08f",
      accentForeground: "#fff",
      surface3: "#333",
      destructive: "#f00",
      destructiveForeground: "#fff",
      borderAccent: "#08f",
    },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    fontSize: { sm: 12, base: 14 },
    fontFamily: { mono: "monospace" },
    fontWeight: { medium: "500", normal: "400" },
    borderRadius: { sm: 4, md: 6, lg: 8, xl: 12 },
    opacity: { 50: 0.5 },
  },
}));

const agent = {
  id: "agent-1",
  title: "Codex",
  provider: "codex",
  model: "deepseek-flash",
  workspaceId: "workspace-1",
  cwd: "/repo",
  archivedAt: null,
  lastActivityAt: new Date("2026-01-01T00:00:00Z"),
} as unknown as Agent;

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const domProps = (props: Record<string, unknown>) => ({
    "data-testid": typeof props.testID === "string" ? props.testID : undefined,
  });
  return {
    Platform: {
      OS: "web",
      select: (values: Record<string, unknown>) => values.web ?? values.default,
    },
    StyleSheet: {
      create: (styles: unknown) => styles,
      flatten: (styles: unknown) => styles,
      absoluteFill: {},
    },
    View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactModule.createElement("div", domProps(props), children),
    Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactModule.createElement("span", domProps(props), children),
    ScrollView: ({
      children,
      contentContainerStyle: _contentContainerStyle,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactModule.createElement("div", domProps(props), children),
    Modal: ({ visible, children }: React.PropsWithChildren<{ visible?: boolean }>) =>
      visible ? ReactModule.createElement("div", { "data-testid": "modal" }, children) : null,
    Keyboard: { dismiss: () => {} },
    Pressable: ({
      children,
      onPress,
      disabled,
      ...props
    }: React.PropsWithChildren<Record<string, unknown> & { onPress?: () => void }>) =>
      ReactModule.createElement(
        "button",
        { ...domProps(props), type: "button", disabled, onClick: () => !disabled && onPress?.() },
        typeof children === "function" ? null : children,
      ),
  };
});

vi.mock("react-native-unistyles", () => ({
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
  StyleSheet: {
    create: (factory: (value: typeof theme) => unknown) => factory(theme),
    absoluteFill: {},
  },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("@/components/ui/scroll-view", async () => {
  const ReactModule = await import("react");
  return {
    ScrollView: ({
      children,
      contentContainerStyle: _contentContainerStyle,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactModule.createElement("div", props, children),
  };
});

vi.mock("@/components/markdown/renderer", async () => {
  const ReactModule = await import("react");
  return {
    MarkdownRenderer: ({ text }: { text: string }) =>
      ReactModule.createElement("span", { "data-testid": "markdown" }, text),
  };
});

vi.mock("@/components/ui/loading-spinner", async () => {
  const ReactModule = await import("react");
  return { LoadingSpinner: () => ReactModule.createElement("span") };
});

vi.mock("@/hooks/use-agent-form-state", () => ({
  useAgentFormState: () => ({
    selectedProvider: "codex",
    selectedModel: "deepseek-flash",
    modelSelectorProviders: [],
    setProviderAndModelFromUser: () => {},
    isAllModelsLoading: false,
    workingDirIsEmpty: false,
  }),
}));

vi.mock("@/components/ui/text-input", async () => {
  const ReactModule = await import("react");
  const EditingTextInput = ReactModule.forwardRef(function MockEditingTextInput(
    {
      initialValue,
      onChangeText,
      onSubmitEditing,
      placeholder,
      editable,
      accessibilityLabel,
      testID,
    }: {
      initialValue?: string;
      onChangeText?: (value: string) => void;
      onSubmitEditing?: () => void;
      placeholder?: string;
      editable?: boolean;
      accessibilityLabel?: string;
      testID?: string;
    },
    ref: React.ForwardedRef<unknown>,
  ) {
    const [value, setValue] = ReactModule.useState(initialValue ?? "");
    ReactModule.useImperativeHandle(
      ref,
      () => ({
        focus: () => {},
        blur: () => {},
        isFocused: () => true,
        getText: () => value,
        replaceText: (next: string) => setValue(next),
        setSelection: () => {},
        reset: () => setValue(""),
        getNativeRef: () => null,
      }),
      [setValue, value],
    );
    return ReactModule.createElement("input", {
      "data-testid": testID,
      "aria-label": accessibilityLabel,
      placeholder,
      disabled: editable === false,
      value,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setValue(event.target.value);
        onChangeText?.(event.target.value);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") onSubmitEditing?.();
      },
    });
  });
  return { EditingTextInput };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  const Button = ({
    testID,
    accessibilityLabel,
    disabled,
    loading,
    onPress,
    children,
  }: React.PropsWithChildren<{
    testID?: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    loading?: boolean;
    onPress?: () => void;
  }>) =>
    ReactModule.createElement(
      "button",
      {
        "data-testid": testID,
        "aria-label": accessibilityLabel,
        type: "button",
        disabled: disabled || loading,
        onClick: () => {
          if (!disabled && !loading) onPress?.();
        },
      },
      children ?? null,
    );
  return { Button };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("lucide-react-native", async () => {
  const ReactModule = await import("react");
  const Icon = () => ReactModule.createElement("span");
  return { ArrowUp: Icon, X: Icon };
});

vi.mock("./terminal-model-selector", () => ({
  TerminalModelSelector: () => null,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => client,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (
    selector: (state: {
      sessions: Record<string, { agents: Map<string, Agent>; focusedAgentId: string | null }>;
    }) => unknown,
  ) =>
    selector({
      sessions: {
        "server-1": {
          agents: new Map([[agent.id, agent]]),
          focusedAgentId: null,
        },
      },
    }),
}));

function renderPrompt() {
  const runCommands = vi.fn(async () => "load average: 0.97, 1.04, 1.13\n32");
  const view = render(
    <TerminalAgentPrompt
      projectId="prj-1"
      runCommands={runCommands}
      serverId="server-1"
      workspaceDirectory="/repo"
      workspaceId="workspace-1"
    />,
  );
  return { ...view, runCommands };
}

async function submit(value: string) {
  const input = screen.getByTestId("terminal-agent-prompt-input");
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByTestId("terminal-agent-prompt-send"));
  return input as HTMLInputElement;
}

describe("TerminalAgentPrompt", () => {
  beforeEach(() => {
    createWorkspaceMock.mockReset();
    createWorkspaceMock.mockResolvedValue({
      error: null,
      workspace: { id: "wks-operator" },
      agent: { id: "operator-agent" },
    });
    sendAgentMessageMock.mockClear();
    waitForFinishMock.mockReset();
    setAgentModelMock.mockClear();
    archiveWorkspaceMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses an isolated background agent and shows process plus summary", async () => {
    waitForFinishMock
      .mockResolvedValueOnce({
        status: "idle",
        final: null,
        error: null,
        lastMessage: "```bash\nuptime\ndf -h\n```",
      })
      .mockResolvedValueOnce({
        status: "idle",
        final: null,
        error: null,
        lastMessage: "Load is normal.",
      });

    const { runCommands } = renderPrompt();
    const input = await submit("当前服务器负载");

    await waitFor(() => expect(screen.getByTestId("terminal-operator-summary")).toBeTruthy());

    expect(createWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        background: true,
        source: expect.objectContaining({ kind: "directory", path: "/repo", projectId: "prj-1" }),
        agent: expect.objectContaining({
          config: expect.objectContaining({
            provider: "codex",
            cwd: "/repo",
            model: "deepseek-flash",
          }),
        }),
      }),
    );
    expect(sendAgentMessageMock).toHaveBeenNthCalledWith(
      1,
      "operator-agent",
      expect.stringContaining("当前服务器负载"),
    );
    expect(sendAgentMessageMock).toHaveBeenNthCalledWith(
      2,
      "operator-agent",
      expect.stringContaining("load average: 0.97, 1.04, 1.13"),
    );
    expect(sendAgentMessageMock).not.toHaveBeenCalledWith("agent-1", expect.anything());
    expect(runCommands).toHaveBeenCalledWith(["uptime", "df -h"]);
    expect(screen.getByTestId("terminal-operator-summary").textContent).toContain(
      "Load is normal.",
    );
    expect(screen.getByTestId("terminal-operator-stage").textContent).toBe(
      "workspace.terminal.agentPrompt.stageDone",
    );
    expect(input.value).toBe("");
  });

  it("submits with Enter", async () => {
    waitForFinishMock
      .mockResolvedValueOnce({
        status: "idle",
        final: null,
        error: null,
        lastMessage: "free -m",
      })
      .mockResolvedValueOnce({
        status: "idle",
        final: null,
        error: null,
        lastMessage: "Memory is fine.",
      });

    const { runCommands } = renderPrompt();
    const input = screen.getByTestId("terminal-agent-prompt-input");
    fireEvent.change(input, { target: { value: "show memory usage" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(runCommands).toHaveBeenCalledWith(["free -m"]));
  });

  it("reports when the operator returns no runnable command", async () => {
    waitForFinishMock.mockResolvedValueOnce({
      status: "idle",
      final: null,
      error: null,
      lastMessage: "NO_COMMAND",
    });

    const { runCommands } = renderPrompt();
    const input = await submit("hello");

    await waitFor(() =>
      expect(screen.getByTestId("terminal-operator-error").textContent).toBe(
        "workspace.terminal.agentPrompt.noCommands",
      ),
    );
    expect(runCommands).not.toHaveBeenCalled();
    expect(input.value).toBe("hello");
    expect(screen.getByTestId("terminal-operator-stage").textContent).toBe(
      "workspace.terminal.agentPrompt.stageError",
    );
  });

  it("reports a planning timeout", async () => {
    waitForFinishMock.mockResolvedValueOnce({
      status: "timeout",
      final: null,
      error: null,
      lastMessage: null,
    });

    renderPrompt();
    await submit("hello");

    await waitFor(() =>
      expect(screen.getByTestId("terminal-operator-error").textContent).toBe(
        "workspace.terminal.agentPrompt.timeout",
      ),
    );
  });

  it("archives the background operator workspace when the terminal closes", async () => {
    waitForFinishMock
      .mockResolvedValueOnce({
        status: "idle",
        final: null,
        error: null,
        lastMessage: "uptime",
      })
      .mockResolvedValueOnce({
        status: "idle",
        final: null,
        error: null,
        lastMessage: "Summary.",
      });

    const { unmount } = renderPrompt();
    await submit("load");
    await waitFor(() => expect(screen.getByTestId("terminal-operator-summary")).toBeTruthy());

    unmount();
    expect(archiveWorkspaceMock).toHaveBeenCalledWith("wks-operator");
  });
});
