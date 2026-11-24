import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineEditor } from "@/components/LineEditor";
import { LineTabs } from "@/components/LineTabs";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { resetEventsForTests } from "@/lib/events";
import i18n from "@/lib/i18n";
import { Groceries } from "@/routes/Groceries";
import { Hidden } from "@/routes/Hidden";
import { resetFeedbackStore } from "@/stores/feedbackStore";
import { resetPageStoreForTests } from "@/stores/pageStore";

/** The Mercado tab: the shopping list (GROCERY lines only), bought → "Ya comprados" → back. */

const SUB = "sub-groceries";
let db: LocalDb;
let n = 0;

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const row = (id: string, rawInput: string, position: string, over: Record<string, unknown> = {}) => ({
  id,
  title: rawInput,
  rawInput,
  activityType: "ACTION" as const, // re-derived from the text on load
  status: "DRAFT" as const,
  position,
  editedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage("es");
  db = await openLocalDb(`bacuyy-groceries-${++n}`);
  setDbForTests(db);
  resetPageStoreForTests();
  resetFeedbackStore();
  resetAuthForTests({ status: "signedIn", user: { userId: SUB, username: SUB, email: "a@b.c" }, offline: false });
  await db.putLocal("Activity", row("pan", "llamar al banco", "a0"));
  await db.putLocal("Activity", row("milk", "leche !mercado", "a1"));
  await db.putLocal("Activity", row("rice", "arroz !mercado", "a2", { isHidden: true, completedAt: daysAgo(3), completionCount: 2 }));
  await db.putLocal("Activity", row("sugar", "Azúcar morena !compra", "a3", { isHidden: true }));
  await db.putLocal("Activity", row("later", "pagar luz", "a4", { isHidden: true }));
});

afterEach(() => {
  cleanup();
  db.close();
  setDbForTests(null);
  resetAuthForTests();
  resetEventsForTests();
});

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LineEditor />} />
        <Route path="/groceries" element={<Groceries />} />
        <Route path="/hidden" element={<Hidden />} />
      </Routes>
    </MemoryRouter>,
  );
}

const values = () =>
  screen.queryAllByTestId(/^line-row-\d+$/).map((r) => (r.querySelector("textarea") as HTMLTextAreaElement).value);
const bought = () => screen.queryAllByTestId(/^grocery-bought-\d+$/).map((li) => li.querySelector("span.flex-1")!.textContent);

describe("Mercado", () => {
  it("shopping items are only on the Mercado tab, not on the page nor on Hidden", async () => {
    renderApp("/");
    await waitFor(() => expect(values()).toEqual(["llamar al banco"]));
    cleanup();
    resetPageStoreForTests();
    renderApp("/hidden");
    await waitFor(() => expect(screen.getAllByTestId(/^hidden-item-/)).toHaveLength(1));
    expect(screen.getByTestId("hidden-item-0")).toHaveTextContent("pagar luz");
  });

  it("lists what to buy (editable) and what was bought, A→Z, with when", async () => {
    renderApp("/groceries");
    await waitFor(() => expect(values()).toEqual(["leche !mercado"]));
    expect(bought()).toEqual(["arroz", "Azúcar morena"]);
    expect(screen.getByTestId("grocery-bought-0")).toHaveTextContent(/hace 3 días/);
    expect(within(screen.getByTestId("line-tabs")).getByRole("link", { name: "Mercado" })).toHaveAttribute("aria-current", "page");
  });

  it("a new line typed here is a shopping item", async () => {
    const user = userEvent.setup();
    renderApp("/groceries");
    await waitFor(() => expect(values()).toEqual(["leche !mercado"]));
    await user.click(screen.getByTestId("line-row-0").querySelector("textarea")!);
    await user.keyboard("{End}{Enter}huevos");
    await waitFor(() => expect(values()).toEqual(["leche !mercado", "huevos !mercado"]));
    await waitFor(async () => {
      const rows = (await db.getAll("Activity")).filter((r) => r.rawInput === "huevos !mercado");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.activityType).toBe("GROCERY");
    });
  });

  it("typing a list from the empty line: Enter before the mark keeps every item a shopping item", async () => {
    await db.putLocal("Activity", row("milk", "leche !mercado", "a1", { isHidden: true }));
    const user = userEvent.setup();
    renderApp("/groceries");
    await waitFor(() => expect(values()).toEqual([""]));
    await user.click(screen.getByTestId("line-row-0").querySelector("textarea")!);
    await user.keyboard("pan integral{Enter}huevos{Enter}café");
    await waitFor(() => expect(values()).toEqual(["pan integral !mercado", "huevos !mercado", "café !mercado"]));
    await user.click(screen.getByTestId("line-done-0"));
    expect(await screen.findByTestId("hidden-toast")).toHaveTextContent("Comprado.");
  });

  it("ticking means bought: it moves to Ya comprados; + puts it back on the list", async () => {
    const user = userEvent.setup();
    renderApp("/groceries");
    await waitFor(() => expect(values()).toEqual(["leche !mercado"]));
    await user.click(screen.getByTestId("line-done-0"));
    await waitFor(() => expect(bought()).toEqual(["arroz", "Azúcar morena", "leche"]));
    expect(screen.getByTestId("hidden-toast")).toHaveTextContent("Comprado.");
    expect(within(screen.getByTestId("hidden-toast")).queryByTestId("feedback-prompt")).toBeNull();
    expect(screen.getByTestId("grocery-bought-2")).toHaveTextContent("hoy");
    const milk = (await db.get("Activity", "milk"))!;
    expect(milk).toMatchObject({ isHidden: true, hiddenUntil: null, status: "DRAFT", completionCount: 1 });
    expect(milk.completedAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Volver a la lista: arroz" }));
    await waitFor(() => expect(values()).toContain("arroz !mercado"));
    expect(bought()).toEqual(["Azúcar morena", "leche"]);
    expect(await db.get("Activity", "rice")).toMatchObject({ isHidden: false, hiddenUntil: null, completionCount: 2 });
  });

  it("the search finds bought items by any part, ignoring case and accents", async () => {
    const user = userEvent.setup();
    renderApp("/groceries");
    await waitFor(() => expect(bought()).toHaveLength(2));
    await user.type(screen.getByTestId("groceries-search"), "azucar");
    expect(bought()).toEqual(["Azúcar morena"]);
    await user.keyboard("{Escape}");
    expect(bought()).toHaveLength(2);
  });

  it("from the page to an empty Mercado tab: typing starts a shopping item (no page line carried over)", async () => {
    await db.putLocal("Activity", row("milk", "leche !mercado", "a1", { isHidden: true }));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<><LineTabs /><LineEditor /></>} />
          <Route path="/groceries" element={<Groceries />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(values()).toEqual(["llamar al banco"]));
    await user.click(screen.getByRole("link", { name: "Mercado" }));
    await waitFor(() => expect(values()).toEqual([""]));
    await user.click(screen.getByTestId("line-row-0").querySelector("textarea")!);
    await user.keyboard("pan");
    await waitFor(() => expect(values()).toEqual(["pan !mercado"]));
    expect((await db.get("Activity", "pan"))!.rawInput).toBe("llamar al banco");
  });

  it("typing !mercado on the page keeps the line in view and says where it goes", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await waitFor(() => expect(values()).toEqual(["llamar al banco"]));
    await user.click(screen.getByTestId("line-row-0").querySelector("textarea")!);
    await user.keyboard("{End} !mercado");
    await waitFor(() => expect(screen.getByTestId("moved-to-groceries")).toBeInTheDocument());
    expect(values()).toEqual(["llamar al banco !mercado"]);
  });
});
