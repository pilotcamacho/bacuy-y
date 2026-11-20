import { logicalToday } from "@/lib/day";
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
import { COMPLETED_PAGE_SIZE, Completed } from "@/routes/Completed";
import { Expirations } from "@/routes/Expirations";
import { Hidden } from "@/routes/Hidden";
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

describe("Completed view", () => {
  const noon = (daysAgo: number) => {
    const d = logicalToday(new Date()); // the app's day: before 03:00 "today" is yesterday
    d.setDate(d.getDate() - daysAgo);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };

  beforeEach(async () => {
    await db.putLocal("Activity", line("page", "en la página", "", "a5"));
    await db.putLocal("Activity", line("t1", "hoy temprano", "#salud", "a1", { status: "COMPLETED", completedAt: noon(0) }));
    await db.putLocal("Activity", line("t2", "hoy tarde", "", "a2", { status: "COMPLETED", completedAt: new Date(Date.parse(noon(0)) + 3_600_000).toISOString() }));
    await db.putLocal("Activity", line("y1", "ayer", "", "a3", { status: "COMPLETED", completedAt: noon(1) }));
    // Completed before completedAt existed: its last edit stands in.
    await db.putLocal("Activity", line("old", "antigua", "", "a4", { status: "COMPLETED", editedAt: "2026-01-05T10:00:00.000Z" }));
    // Not listed: a gratitude entry (the journal's), and a deleted task.
    await db.putLocal("Activity", line("g", "gracias", "!gratitud", "a6", { status: "COMPLETED", activityType: "GRATITUDE", completedAt: noon(0) }));
    await db.putLocal("Activity", line("del", "borrada", "", "a7", { status: "COMPLETED", completedAt: noon(0), deletedAt: noon(0) }));
    await db.putLocal("Feedback", { id: "fb", activityId: "y1", rating: 4, editedAt: noon(1) });
  });

  const items = () => screen.getAllByTestId(/^completed-item-/).map((li) => li.querySelector("p")!.textContent);

  it("lists completed tasks newest first, grouped by day", async () => {
    renderAt("/completed", <Completed />);
    await waitFor(() => expect(items()).toEqual(["hoy tarde", "hoy temprano #salud", "ayer", "antigua"]));
    const days = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(days.slice(0, 2)).toEqual(["Hoy", "Ayer"]);
    expect(days[2]).toMatch(/2026/);
    // The tabs: "Completadas" is the current one.
    expect(within(screen.getByTestId("line-tabs")).getByRole("link", { name: "Completadas" })).toHaveAttribute("aria-current", "page");
  });

  it("unticking puts it back on the page at its old place", async () => {
    const user = userEvent.setup();
    renderAt("/completed", <Completed />);
    await user.click(await screen.findByRole("checkbox", { name: "Desmarcar «hoy temprano» y devolverla a la página" }));
    await waitFor(() => expect(items()).toEqual(["hoy tarde", "ayer", "antigua"]));
    expect(await db.get("Activity", "t1")).toMatchObject({ status: "ACTIVE", completedAt: null, position: "a1" });
    expect(screen.getByRole("status")).toHaveTextContent("«hoy temprano» ha vuelto a la página.");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /«ayer»/ })).toHaveFocus()); // the row taking its place
  });

  it("delete asks first, then soft-deletes the task and its feedback", async () => {
    const user = userEvent.setup();
    renderAt("/completed", <Completed />);
    await user.click(await screen.findByRole("button", { name: "Borrar «ayer»" }));
    await user.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(items()).toEqual(["hoy tarde", "hoy temprano #salud", "antigua"]));
    expect((await db.get("Activity", "y1"))!.deletedAt).toBeTruthy();
    expect((await db.get("Feedback", "fb"))!.deletedAt).toBeTruthy();
  });

  it("⋯ opens the panel of a completed task; reactivating it there puts it back on the page", async () => {
    const user = userEvent.setup();
    renderAt("/completed", <Completed />);
    await user.click(await screen.findByRole("button", { name: "Más opciones de «ayer»" }));
    const panel = within(screen.getByTestId("line-panel"));
    expect(panel.getByTestId("panel-status")).toHaveTextContent("Completada");
    await user.click(panel.getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(items()).toEqual(["hoy tarde", "hoy temprano #salud", "antigua"]));
    expect(await db.get("Activity", "y1")).toMatchObject({ status: "DRAFT", completedAt: null });
  });

  it("shows the newest first and more on request", async () => {
    const many = Array.from({ length: COMPLETED_PAGE_SIZE + 5 }, (_, i) =>
      line(`m${i}`, `tarea ${i}`, "", `b${i}`, { status: "COMPLETED", completedAt: new Date(Date.parse("2025-06-01T10:00:00.000Z") - i * 60_000).toISOString() }),
    );
    for (const row of many) await db.putLocal("Activity", row);
    const user = userEvent.setup();
    renderAt("/completed", <Completed />);
    await waitFor(() => expect(screen.getAllByTestId(/^completed-item-/)).toHaveLength(COMPLETED_PAGE_SIZE));
    await user.click(screen.getByTestId("completed-show-more"));
    await waitFor(() => expect(screen.getAllByTestId(/^completed-item-/)).toHaveLength(COMPLETED_PAGE_SIZE + 9));
    expect(screen.queryByTestId("completed-show-more")).toBeNull();
  });
});

describe("Hidden view", () => {
  const inDays = (days: number, hour = 9) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  beforeEach(async () => {
    await db.putLocal("Activity", line("page", "en la página", "", "a0"));
    await db.putLocal("Activity", line("later", "más adelante", "", "a1", { hiddenUntil: inDays(5) }));
    await db.putLocal("Activity", line("soon", "pronto", "", "a2", { hiddenUntil: inDays(1) }));
    await db.putLocal("Activity", line("someday", "algún día", "", "a3", { isHidden: true }));
    await db.putLocal("Activity", line("past", "ya volvió", "", "a4", { hiddenUntil: inDays(-1) }));
  });

  const items = () => screen.getAllByTestId(/^hidden-item-/).map((li) => li.querySelector("p")!.textContent);

  it("lists hidden lines, the soonest back first, 'until shown' last; the tab shows the count", async () => {
    renderAt("/hidden", <Hidden />);
    await waitFor(() => expect(items()).toEqual(["pronto", "más adelante", "algún día"]));
    expect(screen.getByTestId("hidden-item-2")).toHaveTextContent("oculto hasta que lo muestres");
    expect(screen.getByTestId("hidden-count")).toHaveTextContent("3");
    expect(within(screen.getByTestId("line-tabs")).getByRole("link", { name: /^Ocultas/ })).toHaveAttribute("aria-current", "page");
  });

  it("'show now' puts it back on the page; 'change' sets a new time or 'until shown'", async () => {
    const user = userEvent.setup();
    renderAt("/hidden", <Hidden />);
    await user.click(await screen.findByRole("button", { name: "Mostrar ahora «pronto»" }));
    await waitFor(() => expect(items()).toEqual(["más adelante", "algún día"]));
    expect(await db.get("Activity", "soon")).toMatchObject({ hiddenUntil: null, isHidden: false });
    expect(screen.getByRole("status")).toHaveTextContent("«pronto» ha vuelto a la página.");

    // "más adelante" → until shown again: with "algún día", in page order.
    await user.click(screen.getByRole("button", { name: "Cambiar hasta cuándo se oculta «más adelante»" }));
    await user.click(screen.getByTestId("hidden-0-indefinite"));
    await waitFor(async () => expect(await db.get("Activity", "later")).toMatchObject({ isHidden: true, hiddenUntil: null }));
    await waitFor(() => expect(items()).toEqual(["más adelante", "algún día"]));

    // "algún día" → tomorrow 8:00.
    await user.click(screen.getByRole("button", { name: "Cambiar hasta cuándo se oculta «algún día»" }));
    await user.click(screen.getByTestId("hidden-1-preset-tomorrow"));
    await waitFor(async () => expect((await db.get("Activity", "someday"))!.isHidden).toBe(false));
    expect(new Date((await db.get("Activity", "someday"))!.hiddenUntil!).getHours()).toBe(8);
  });

  it("a text filter finds any part of the line, ignoring case and accents; Escape clears it", async () => {
    const user = userEvent.setup();
    renderAt("/hidden", <Hidden />);
    await waitFor(() => expect(items()).toHaveLength(3));
    const search = screen.getByRole("searchbox", { name: "Buscar en ocultas" });

    await user.type(search, "ADELA");
    expect(items()).toEqual(["más adelante"]);
    expect(screen.getByTestId("hidden-search-count")).toHaveTextContent("1 de 3");

    await user.clear(search);
    await user.type(search, "algun di"); // no accents, two words
    expect(items()).toEqual(["algún día"]);

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.queryAllByTestId(/^hidden-item-/)).toHaveLength(0);
    expect(screen.getByTestId("hidden-search-empty")).toHaveTextContent("Ninguna oculta contiene «zzz».");

    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(items()).toEqual(["pronto", "más adelante", "algún día"]);
    expect(screen.queryByTestId("hidden-search-count")).toBeNull();
  });
});

describe("Expirations view (Vencimientos)", () => {
  // `!vence @yyyy-mm-dd` N days from the app's today (the text is what the store derives from).
  const mark = (days: number) => {
    const d = new Date();
    if (d.getHours() < 3) d.setDate(d.getDate() - 1); // the app's day starts at 03:00
    d.setDate(d.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `!vence @${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const exp = (over: Record<string, unknown> = {}) => ({ activityType: "EXPIRATION" as const, ...over });

  beforeEach(async () => {
    await db.putLocal("Activity", line("passport", "pasaporte", mark(400), "a1", exp()));
    await db.putLocal("Activity", line("soat", "soat", mark(10), "a2", exp()));
    await db.putLocal("Activity", line("licence", "licencia", "!vence", "a3", exp()));
    await db.putLocal("Activity", line("old", "seguro", mark(-3), "a4", exp()));
    await db.putLocal("Activity", line("hid", "visa", mark(5), "a5", exp({ isHidden: true })));
    await db.putLocal("Activity", line("todo", "comprar pan", "", "a6"));
  });

  const items = () => screen.getAllByTestId(/^expiration-item-/).map((li) => li.querySelector("p")!.textContent!.split(" !")[0]);

  it("lists every expiration, soonest first, undated last, with where each one is", async () => {
    renderAt("/expirations", <Expirations />);
    await waitFor(() => expect(items()).toEqual(["seguro", "visa", "soat", "pasaporte", "licencia"]));
    expect(screen.getByTestId("expiration-item-0")).toHaveTextContent("Venció hace 3 días");
    expect(screen.getByTestId("expiration-where-0")).toHaveTextContent("en la página");
    expect(screen.getByTestId("expiration-where-1")).toHaveTextContent("oculto por ti");
    expect(screen.getByTestId("expiration-where-2")).toHaveTextContent("en la página");
    expect(screen.getByTestId("expiration-where-3")).toHaveTextContent(/^aparece el /);
    expect(screen.getByTestId("expiration-where-4")).toHaveTextContent("sin fecha");
    expect(within(screen.getByTestId("line-tabs")).getByRole("link", { name: "Vencimientos" })).toHaveAttribute("aria-current", "page");
    // The waiting one is neither on Hidden's count nor on the page.
    expect(screen.getByTestId("hidden-count")).toHaveTextContent("1");
  });

  it("Renovar opens the line's expiration section; the search filters", async () => {
    const user = userEvent.setup();
    renderAt("/expirations", <Expirations />);
    await user.click(await screen.findByRole("button", { name: "Renovar o archivar «pasaporte»" }));
    expect(await screen.findByTestId("line-panel")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.type(screen.getByRole("searchbox", { name: "Buscar en vencimientos" }), "PASA");
    expect(items()).toEqual(["pasaporte"]);
  });
});
