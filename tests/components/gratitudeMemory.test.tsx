import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GratitudeMemory } from "@/components/GratitudeMemory";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { ActivityRow, LocalDb } from "@/lib/db/types";
import { resetEventsForTests } from "@/lib/events";
import i18n from "@/lib/i18n";
import { memoryCandidates, pickMemory, resetGratitudeMemoryForTests } from "@/services/gratitude/memory";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";

/** "A moment of gratitude" at the top of the page: one past entry at random. */

const SUB = "sub-memory";
let db: LocalDb;
let n = 0;

const entry = (id: string, description: string | null, extra: Partial<ActivityRow> = {}) => ({
  id,
  title: `Gratitud ${id}`,
  rawInput: `Gratitud ${id} !gratitud`,
  activityType: "GRATITUDE" as const,
  status: "COMPLETED" as const,
  description,
  completedAt: new Date(2026, 7, 28, 20, 0).toISOString(), // local: the 28th in any time zone
  position: `a${id}`,
  editedAt: "2026-08-28T23:00:00.000Z",
  ...extra,
});

describe("memory picker", () => {
  const rows = (list: ReturnType<typeof entry>[]) => Object.fromEntries(list.map((r) => [r.id, r as unknown as ActivityRow]));

  it("only completed, not deleted gratitude entries with notes", () => {
    const got = memoryCandidates(
      rows([
        entry("b", "la lluvia"),
        entry("a", "una llamada"),
        entry("c", "   "),
        entry("d", null),
        entry("e", "pendiente", { status: "ACTIVE" }),
        entry("f", "borrada", { deletedAt: "2026-11-01T00:00:00.000Z" }),
        entry("g", "otra cosa", { activityType: "ACTION" as never }),
      ]),
    );
    expect(got.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("never repeats the one to avoid when there is another; one entry is always that one", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) expect(pickMemory(["a", "b", "c"], "b", () => r)).not.toBe("b");
    expect(pickMemory(["a"], "a")).toBe("a");
    expect(pickMemory([], null)).toBeNull();
    expect(pickMemory(["a", "b"], null, () => 0.999)).toBe("b");
  });
});

describe("GratitudeMemory", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    localStorage.clear();
    db = await openLocalDb(`bacuyy-memory-${++n}`);
    setDbForTests(db);
    resetPageStoreForTests();
    resetGratitudeMemoryForTests();
    resetAuthForTests({ status: "signedIn", user: { userId: SUB, username: SUB, email: "a@b.c" }, offline: false });
  });

  afterEach(() => {
    cleanup();
    db.close();
    setDbForTests(null);
    resetAuthForTests();
    resetEventsForTests();
  });

  async function mount() {
    await usePageStore.getState().load(SUB);
    return render(<GratitudeMemory />);
  }
  const shown = () => screen.getByTestId("gratitude-memory").getAttribute("data-id");

  it("shows nothing without entries", async () => {
    await db.putLocal("Activity", entry("1", null));
    await mount();
    expect(screen.queryByTestId("gratitude-memory")).toBeNull();
  });

  it("shows one entry with its day; a tap shows another; a new visit avoids the last one", async () => {
    await db.putLocal("Activity", entry("1", "Ida a IKEA.\nExercicio con Fio."));
    await db.putLocal("Activity", entry("2", "Natación con Fío"));
    await db.putLocal("Activity", entry("3", "Una llamada"));
    const user = userEvent.setup();
    await mount();
    const first = await screen.findByTestId("gratitude-memory");
    expect(first).toHaveTextContent("Un momento de gratitud");
    expect(screen.getByText(/— \S+, 28 de agosto/)).toBeInTheDocument();
    const a = shown();

    const button = screen.getByRole("button", { name: /Mostrar otro/ });
    await user.click(button);
    const b = shown();
    expect(b).not.toBe(a);
    await user.click(button);
    expect(shown()).not.toBe(b);

    // Opening the app again (a reload): never the one shown last.
    const last = shown();
    cleanup();
    resetGratitudeMemoryForTests();
    render(<GratitudeMemory />);
    expect(shown()).not.toBe(last);
  });

  it("keeps the line breaks of the notes", async () => {
    await db.putLocal("Activity", entry("1", "Ida a IKEA.\nExercicio con Fio."));
    await mount();
    expect(screen.getByTestId("gratitude-memory-text").textContent).toBe("Ida a IKEA.\nExercicio con Fio.");
    // A single entry: nothing else to show, so it is not a button that does nothing.
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("keeps the same entry across tabs in one visit; a new one when back after a while", async () => {
    for (const id of ["1", "2", "3", "4"]) await db.putLocal("Activity", entry(id, `nota ${id}`));
    await mount();
    const a = shown();
    cleanup();
    render(<GratitudeMemory />); // another tab and back: same visit
    expect(shown()).toBe(a);

    const realNow = Date.now;
    const vis = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    try {
      act(() => vis("hidden"));
      Date.now = () => realNow() + 11 * 60 * 1000;
      act(() => vis("visible"));
      expect(shown()).not.toBe(a);
    } finally {
      Date.now = realNow;
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    }
  });
});
