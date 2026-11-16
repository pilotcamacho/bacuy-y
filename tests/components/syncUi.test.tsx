import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineEditor } from "@/components/LineEditor";
import { SyncIndicator } from "@/components/SyncIndicator";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { emit, resetEventsForTests, subscribe } from "@/lib/events";
import i18n from "@/lib/i18n";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";
import { resetSyncStoreForTests, useSyncStore } from "@/stores/syncStore";

let db: LocalDb;
let n = 0;

beforeEach(async () => {
  await i18n.changeLanguage("es");
  db = await openLocalDb(`bacuyy-syncui-${++n}`);
  setDbForTests(db);
  resetPageStoreForTests();
  resetSyncStoreForTests();
});

afterEach(() => {
  db.close();
  setDbForTests(null);
  resetEventsForTests();
});

const boxes = () => screen.getAllByRole("textbox") as HTMLTextAreaElement[];

describe("page reload after sync", () => {
  it("rows written by a sync appear; a line still being typed keeps its text", async () => {
    const user = userEvent.setup();
    render(<LineEditor />);
    await screen.findAllByRole("textbox");
    await user.click(boxes()[0]!);
    await user.keyboard("mía");
    await act(() => usePageStore.getState().flushAll());
    const mine = Object.keys(usePageStore.getState().activities)[0]!;

    await user.keyboard(" sin guardar"); // still inside the debounce
    // Another device's line arrives through a pull.
    await db.putFromServer("Activity", {
      id: "remote",
      title: "de otro dispositivo",
      rawInput: "de otro dispositivo",
      activityType: "ACTION",
      status: "DRAFT",
      position: "b0",
      editedAt: new Date().toISOString(),
    });
    await act(async () => emit({ type: "synced", changed: true }));
    await waitFor(() => expect(boxes().map((b) => b.value)).toEqual(["mía sin guardar", "de otro dispositivo"]));
    expect(usePageStore.getState().activities[mine]!.rawInput).toBe("mía sin guardar");
  });

  it("local writes are announced (the engine schedules a push from them)", async () => {
    const seen: string[] = [];
    subscribe((e) => seen.push(e.type));
    const user = userEvent.setup();
    render(<LineEditor />);
    await screen.findAllByRole("textbox");
    await user.click(boxes()[0]!);
    await user.keyboard("x");
    await act(() => usePageStore.getState().flushAll());
    expect(seen).toContain("localWrite");
  });
});

describe("SyncIndicator", () => {
  it("shows the translated state and the pending count", () => {
    render(<SyncIndicator />);
    const el = screen.getByTestId("sync-indicator");
    expect(el).toHaveTextContent("Sincronizado");
    act(() => useSyncStore.getState().set({ status: "offline", reason: null, lastSyncedAt: null, dirty: 2 }));
    expect(el).toHaveTextContent("Sin conexión");
    expect(el).toHaveAttribute("data-status", "offline");
    expect(el.getAttribute("title")).toContain("2 cambios sin subir");
    act(() => useSyncStore.getState().set({ status: "error", reason: "auth", lastSyncedAt: null, dirty: 0 }));
    expect(el.getAttribute("title")).toContain("Inicia sesión de nuevo");
  });
});
