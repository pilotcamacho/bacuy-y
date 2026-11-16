import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallSection } from "@/components/InstallSection";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import i18n from "@/lib/i18n";
import { usePwaStore, type InstallPromptEvent } from "@/lib/pwa";
import { usePageStore } from "@/stores/pageStore";

/** Phase 12 UI: "new version" (saves pending text first) and installing the app. */

const initial = usePwaStore.getState();

beforeEach(async () => {
  await i18n.changeLanguage("es");
});

afterEach(() => {
  usePwaStore.setState(initial, true);
  vi.restoreAllMocks();
});

describe("new version", () => {
  it("hidden until a version is waiting; Update saves pending text, then activates it", async () => {
    const order: string[] = [];
    vi.spyOn(usePageStore.getState(), "flushAll").mockImplementation(async () => void order.push("flush"));
    const update = vi.fn(async () => void order.push("update"));
    usePwaStore.setState({ update });
    const user = userEvent.setup();
    render(<UpdatePrompt />);
    expect(screen.queryByTestId("update-prompt")).toBeNull();

    act(() => usePwaStore.setState({ needRefresh: true }));
    expect(screen.getByTestId("update-prompt")).toHaveTextContent("Hay una versión nueva de bacuy-y.");
    await user.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(order).toEqual(["flush", "update"]));
  });

  it("Later dismisses it", async () => {
    const user = userEvent.setup();
    usePwaStore.setState({ needRefresh: true });
    render(<UpdatePrompt />);
    await user.click(screen.getByRole("button", { name: "Más tarde" }));
    expect(screen.queryByTestId("update-prompt")).toBeNull();
  });
});

describe("install", () => {
  it("without a browser prompt: how to install on each platform", () => {
    render(<InstallSection />);
    expect(screen.getByText(/Añadir a pantalla de inicio/, { selector: "li:last-child" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instalar bacuy-y" })).toBeNull();
  });

  it("with the browser's prompt: a button that shows it, used once", async () => {
    const prompt = vi.fn(async () => {});
    const event = { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) } as unknown as InstallPromptEvent;
    usePwaStore.setState({ installPrompt: event });
    const user = userEvent.setup();
    render(<InstallSection />);
    await user.click(screen.getByRole("button", { name: "Instalar bacuy-y" }));
    expect(prompt).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Instalar bacuy-y" })).toBeNull());
  });

  it("already installed: says so", () => {
    usePwaStore.setState({ installed: true });
    render(<InstallSection />);
    expect(screen.getByText("bacuy-y ya está instalada en este dispositivo.")).toBeInTheDocument();
  });
});
