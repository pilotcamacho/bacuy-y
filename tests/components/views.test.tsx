import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineEditor } from "@/components/LineEditor";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { resetEventsForTests } from "@/lib/events";
import i18n from "@/lib/i18n";
import { activityFlagId, flagId } from "@/lib/ids";
import { Archived } from "@/routes/Archived";
import { PriorityView } from "@/routes/PriorityView";
import { resetFeedbackStore } from "@/stores/feedbackStore";
import { resetPageStoreForTests } from "@/stores/pageStore";

/** Phase 11 screens against a real (fake-indexeddb) LocalDb, signed in (default flags seeded). */

const SUB = "sub-views";
const HEALTH = flagId(SUB, "health");
let db: LocalDb;
let n = 0;

beforeEach(async () => {
  await i18n.changeLanguage("es");
  db = await openLocalDb(`bacuyy-views-${++n}`);
  setDbForTests(db);
  resetPageStoreForTests();
  resetFeedbackStore();
  resetAuthForTests({ status: "signedIn", user: { userId: SUB, username: SUB, email: "a@b.c" }, offline: false });
});

afterEach(() => {
  cleanup();
  db.close();
  setDbForTests(null);
  resetAuthForTests();
  resetEventsForTests();
});

const line = (id: string, title: string, marks: string, position: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  rawInput: marks ? `${title} ${marks}` : title,
  activityType: "ACTION" as const,
  status: (marks ? "ACTIVE" : "DRAFT") as "ACTIVE" | "DRAFT",
  position,
  editedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LineEditor />} />
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const titles = () => screen.getAllByTestId(/^priority-item-/).map((li) => within(li).getAllByRole("button")[1]!.textContent);

describe("Priority view", () => {
  beforeEach(async () => {
    // Default roots: Salud 15, Recados 10, Diversión 15 (of 100).
    await db.putLocal("Activity", line("idea", "idea suelta", "", "a0"));
    await db.putLocal("Activity", line("bills", "pagar luz", "#recados", "a1"));
    await db.putLocal("Activity", line("run", "correr", "#salud", "a2"));
    await db.putLocal("Activity", line("read", "leer", "#diversión", "a3", { cron: "* * * * *" })); // ×1.3
    await db.putLocal("Activity", line("bread", "comprar pan", "#recados", "a4", { status: "COMPLETED" }));
  });

  it("lists the ACTIVE lines by score; a tick works here and completed lines leave", async () => {
    const user = userEvent.setup();
    renderAt("/priority", <PriorityView />);
    await waitFor(() => expect(titles()).toEqual(["leer · Ir al renglón en la página", "correr · Ir al renglón en la página", "pagar luz · Ir al renglón en la página"]));
    const first = screen.getByTestId("priority-item-0");
    expect(within(first).getByText("Ahora")).toBeInTheDocument();
    expect(within(first).getByText("Diversión")).toBeInTheDocument();

    // "correr" is line 3 of the page: the tick's label says so.
    await user.click(screen.getByRole("button", { name: "Marcar como hecha (renglón 3)" }));
    await waitFor(() => expect(titles()).toEqual(["leer · Ir al renglón en la página", "pagar luz · Ir al renglón en la página"]));
    expect((await db.get("Activity", "run"))!.status).toBe("COMPLETED");
    expect(screen.getByTestId("feedback-prompt")).toBeInTheDocument();
  });

  it("clicking a line goes to it on the page, focused", async () => {
    const user = userEvent.setup();
    renderAt("/priority", <PriorityView />);
    await user.click(await screen.findByRole("button", { name: /^pagar luz/ }));
    const box = await screen.findByRole("textbox", { name: "Renglón 2" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue("pagar luz #recados");
  });

  it("the panel opens from ⋯ and gives the focus back when it closes", async () => {
    const user = userEvent.setup();
    renderAt("/priority", <PriorityView />);
    const more = await screen.findByTestId("priority-more-0");
    await user.click(more);
    expect(await screen.findByTestId("line-panel")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("line-panel")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("priority-more-0")).toHaveFocus());
  });

  it("re-sorts when a flag's weight changes", async () => {
    renderAt("/priority", <PriorityView />);
    await waitFor(() => expect(titles()[0]).toMatch(/^leer/));
    const { usePageStore } = await import("@/stores/pageStore");
    const errand = (await db.get("Flag", flagId(SUB, "errand")))!;
    const { dirty: _d, ...row } = errand;
    await db.putLocal("Flag", { ...row, weight: 60, editedAt: "2026-11-15T10:00:00.000Z" });
    await usePageStore.getState().refresh();
    await waitFor(() => expect(titles()[0]).toMatch(/^pagar luz/));
  });

  it("says so when nothing is active", async () => {
    await db.putLocal("Activity", line("run", "correr", "#salud", "a2", { status: "INACTIVE" }));
    await db.putLocal("Activity", line("read", "leer", "#diversión", "a3", { status: "ARCHIVED" }));
    await db.putLocal("Activity", line("bills", "pagar luz", "#recados", "a1", { deletedAt: "2026-11-10T10:00:00.000Z" }));
    renderAt("/priority", <PriorityView />);
    expect(await screen.findByText(/^No hay renglones activos/)).toBeInTheDocument();
  });
});

describe("Archived view", () => {
  beforeEach(async () => {
    await db.putLocal("Activity", line("page", "en la página", "", "a5"));
    await db.putLocal("Activity", line("old", "viejo", "#salud", "a1", { status: "ARCHIVED", editedAt: "2026-11-01T10:00:00.000Z" }));
    await db.putLocal("Activity", line("new", "reciente", "", "a2", { status: "ARCHIVED", editedAt: "2026-11-12T10:00:00.000Z" }));
    await db.putLocal("Feedback", { id: "fb", activityId: "new", rating: 4, editedAt: "2026-11-12T10:00:00.000Z" });
  });

  it("lists archived lines newest first; restore puts one back at the end of the page", async () => {
    const user = userEvent.setup();
    renderAt("/archived", <Archived />);
    const items = await screen.findAllByTestId(/^archived-item-/);
    expect(items.map((li) => li.querySelector("p")!.textContent)).toEqual(["reciente", "viejo #salud"]);

    await user.click(screen.getByRole("button", { name: "Restaurar «viejo»" }));
    await waitFor(() => expect(screen.getAllByTestId(/^archived-item-/)).toHaveLength(1));
    const row = (await db.get("Activity", "old"))!;
    expect(row.status).toBe("ACTIVE"); // it has a flag
    expect(row.position > "a5").toBe(true);
    expect(await db.get("ActivityFlag", activityFlagId("old", HEALTH))).toMatchObject({ deletedAt: null });
    expect(screen.getByRole("status")).toHaveTextContent("«viejo» ha vuelto a la página.");
    // The focus stays on the list (the next row's restore button).
    await waitFor(() => expect(screen.getByRole("button", { name: "Restaurar «reciente»" })).toHaveFocus());
  });

  it("delete asks first, then soft-deletes the line and its feedback", async () => {
    const user = userEvent.setup();
    renderAt("/archived", <Archived />);
    await user.click(await screen.findByRole("button", { name: "Borrar «reciente»" }));
    // Cancel keeps it.
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Borrar «reciente»" }));
    await user.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(screen.getAllByTestId(/^archived-item-/)).toHaveLength(1));
    expect((await db.get("Activity", "new"))!.deletedAt).toBeTruthy();
    expect((await db.get("Feedback", "fb"))!.deletedAt).toBeTruthy();
    expect((await db.get("Activity", "old"))!.deletedAt ?? null).toBeNull();
  });

  it("restoring an unflagged line makes it a draft; an expiration is pending again", async () => {
    await db.putLocal(
      "Activity",
      line("exp", "pasaporte", "!vencimiento", "a3", { status: "ARCHIVED", activityType: "EXPIRATION", isRenewed: true }),
    );
    const user = userEvent.setup();
    renderAt("/archived", <Archived />);
    await user.click(await screen.findByRole("button", { name: "Restaurar «reciente»" }));
    await user.click(await screen.findByRole("button", { name: "Restaurar «pasaporte»" }));
    await waitFor(async () => expect((await db.get("Activity", "exp"))!.status).toBe("DRAFT"));
    expect((await db.get("Activity", "new"))!.status).toBe("DRAFT");
    expect((await db.get("Activity", "exp"))!.isRenewed).toBe(false);
    // Restored in order: each one goes after the last line of the page.
    const newPos = (await db.get("Activity", "new"))!.position;
    const expPos = (await db.get("Activity", "exp"))!.position;
    expect("a5" < newPos && newPos < expPos).toBe(true);
  });
});
