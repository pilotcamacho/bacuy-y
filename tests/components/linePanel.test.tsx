import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineEditor } from "@/components/LineEditor";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import i18n from "@/lib/i18n";
import { activityFlagId, flagId } from "@/lib/ids";
import { resetFeedbackStore } from "@/stores/feedbackStore";
import { resetFlagStore } from "@/stores/flagStore";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";

/**
 * Phase 6 against a real (fake-indexeddb) LocalDb, signed in, so the default flags are seeded:
 * the tick per type, ActivityFlag rows and DRAFT ↔ ACTIVE, and the side panel rewriting marks.
 */

const SUB = "14b83488-e001-703e-30a3-cefb7b703fd9";
const HEALTH = flagId(SUB, "health");
const ERRAND = flagId(SUB, "errand");

let db: LocalDb;
let n = 0;
let dbName = "";

beforeEach(async () => {
  await i18n.changeLanguage("es");
  dbName = `bacuyy-panel-${++n}`;
  db = await openLocalDb(dbName);
  setDbForTests(db);
  resetPageStoreForTests();
  resetAuthForTests({ status: "signedIn", user: { userId: SUB, username: SUB, email: "a@b.c" }, offline: false });
});

afterEach(() => {
  cleanup(); // unmount before the auth reset re-renders the editor
  db.close();
  setDbForTests(null);
  resetAuthForTests();
});

async function mount() {
  const view = render(<LineEditor />);
  await screen.findAllByRole("textbox");
  return view;
}

async function remount(previous: { unmount(): void }) {
  await act(() => usePageStore.getState().flushAll());
  previous.unmount();
  resetPageStoreForTests();
  db.close();
  db = await openLocalDb(dbName);
  setDbForTests(db);
  return render(<LineEditor />);
}

const boxes = () => screen.getAllByRole("textbox", { name: /^Renglón/ }) as HTMLTextAreaElement[];
const flush = () => act(() => usePageStore.getState().flushAll());

async function onlyActivity() {
  const rows = (await db.getAll("Activity")).filter((r) => !r.deletedAt);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function typeLine(text: string) {
  const user = userEvent.setup();
  await mount();
  await user.click(boxes()[0]!);
  await user.keyboard(text);
  await flush();
  return user;
}

describe("flags and status", () => {
  it("seeds the default flags once per user", async () => {
    await mount();
    await flush();
    const flags = await db.getAll("Flag");
    expect(flags).toHaveLength(10);
    expect(flags.every((f) => f.dirty === 1)).toBe(true); // pushed by the sync engine later
  });

  it("the first #flag makes the line ACTIVE with an ActivityFlag row; removing it returns to DRAFT", async () => {
    const user = await typeLine("comprar pan #recados");
    const row = await onlyActivity();
    expect(row).toMatchObject({ title: "comprar pan", status: "ACTIVE" });
    const link = await db.get("ActivityFlag", activityFlagId(row.id, ERRAND));
    expect(link).toMatchObject({ activityId: row.id, flagId: ERRAND, deletedAt: null, dirty: 1 });

    await user.keyboard("{Backspace>9/}");
    await flush();
    expect((await onlyActivity()).status).toBe("DRAFT");
    expect((await db.get("ActivityFlag", activityFlagId(row.id, ERRAND)))!.deletedAt).toBeTruthy();
  });

  it("a line saved before its flag existed is reconciled on load", async () => {
    await db.putLocal("Activity", {
      id: "old",
      title: "correr #salud",
      rawInput: "correr #salud",
      activityType: "ACTION",
      status: "DRAFT",
      position: "a0",
      editedAt: "2026-11-01T00:00:00.000Z",
    });
    await mount();
    await flush();
    expect(await db.get("Activity", "old")).toMatchObject({ title: "correr", status: "ACTIVE" });
    expect(await db.get("ActivityFlag", activityFlagId("old", HEALTH))).toBeTruthy();
  });

  it("deleting a line soft-deletes its ActivityFlag and Feedback rows; undo brings them back", async () => {
    const user = await typeLine("uno #salud");
    const row = await onlyActivity();
    await db.putLocal("Feedback", { id: "fb1", activityId: row.id, rating: 4, editedAt: "2026-11-14T00:00:00.000Z" });

    await user.keyboard("{Control>}.{/Control}");
    await user.click(within(screen.getByTestId("line-panel")).getByRole("button", { name: "Borrar renglón" }));
    await flush();
    expect(screen.queryByTestId("line-panel")).toBeNull();
    expect((await db.get("Activity", row.id))!.deletedAt).toBeTruthy();
    expect((await db.get("ActivityFlag", activityFlagId(row.id, HEALTH)))!.deletedAt).toBeTruthy();
    expect((await db.get("Feedback", "fb1"))!.deletedAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await flush();
    expect((await db.get("Activity", row.id))!.deletedAt).toBeNull();
    expect((await db.get("ActivityFlag", activityFlagId(row.id, HEALTH)))!.deletedAt).toBeNull();
    expect((await db.get("Feedback", "fb1"))!.deletedAt).toBeNull();
  });
});

describe("tick", () => {
  it("ACTION: the tick completes it (stamped) and it leaves the page; undo brings it back", async () => {
    const user = await typeLine("llamar #familia");
    const before = Date.now();
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    const done = await onlyActivity();
    expect(done.status).toBe("COMPLETED");
    expect(Date.parse(done.completedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(boxes().map((b) => b.value)).toEqual([""]); // only the ghost line is left
    const toast = screen.getByTestId("completed-toast");
    expect(toast).toHaveTextContent("Completada.");

    await user.click(within(toast).getByRole("button", { name: "Deshacer" }));
    await flush();
    expect(await onlyActivity()).toMatchObject({ status: "ACTIVE", completedAt: null });
    expect(boxes().map((b) => b.value)).toEqual(["llamar #familia"]);
  });

  it("completed tasks are not loaded into memory with the page (the Completed page reads them)", async () => {
    await db.putLocal("Activity", {
      id: "done",
      title: "hecha",
      rawInput: "hecha",
      activityType: "ACTION",
      status: "COMPLETED",
      completedAt: "2026-11-10T09:00:00.000Z",
      position: "a0",
      editedAt: "2026-11-10T09:00:00.000Z",
    });
    await mount();
    await flush();
    expect(usePageStore.getState().activities.done).toBeUndefined();

    // Opened from the Completed page while the store was still loading: the load keeps it.
    resetPageStoreForTests();
    const loading = usePageStore.getState().load(SUB);
    usePageStore.getState().adopt([(await db.get("Activity", "done"))!]);
    await loading;
    expect(usePageStore.getState().activities.done).toMatchObject({ status: "COMPLETED" });

    // Reopening reads it from the device and puts it back at its old place.
    await act(() => usePageStore.getState().reopen("done"));
    await flush();
    expect(await db.get("Activity", "done")).toMatchObject({ status: "DRAFT", completedAt: null, position: "a0" });
    expect(boxes().map((b) => b.value)).toEqual(["hecha"]);
  });

  it("Ctrl+Enter ticks the focused line and does not split it", async () => {
    const user = await typeLine("leer");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await flush();
    expect(boxes()).toHaveLength(1);
    expect((await onlyActivity()).status).toBe("COMPLETED");
  });

  it("REPETITIVE_ACTION: done for this time hides the line until next week; undo and 'show now'", async () => {
    const user = await typeLine("regar ~semanal");
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    const row = await onlyActivity();
    expect(row).toMatchObject({ activityType: "REPETITIVE_ACTION", completionCount: 1 });
    const back = new Date(row.hiddenUntil!);
    expect(back.getHours()).toBe(0);
    expect(Math.round((back.getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(6);
    // Gone from the page (only the empty line to type in), and a toast to undo.
    expect(boxes().map((b) => b.value)).toEqual([""]);
    const toast = screen.getByTestId("hidden-toast");
    expect(toast).toHaveTextContent(/^Hecho por ahora\. Vuelve el /);

    await user.click(within(toast).getByRole("button", { name: "Deshacer" }));
    await flush();
    expect(await onlyActivity()).toMatchObject({ completionCount: 0, hiddenUntil: null });
    expect(boxes().map((b) => b.value)).toEqual(["regar ~semanal"]);

    // Ticked again, then brought back by hand (the Hidden page's "show now"): the count stays.
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    await act(() => usePageStore.getState().showNow(row.id));
    await flush();
    expect(await onlyActivity()).toMatchObject({ completionCount: 1, hiddenUntil: null });
    expect(boxes().map((b) => b.value)).toEqual(["regar ~semanal"]);
  });

  it("hide from the panel: a quick choice hides it until then, undo brings it back", async () => {
    const user = await typeLine("uno{Enter}dos");
    await user.click(screen.getByTestId("line-more-0"));
    await user.click(within(screen.getByTestId("line-panel")).getByRole("button", { name: "Mañana 8:00" }));
    await flush();
    expect(screen.queryByTestId("line-panel")).toBeNull();
    expect(boxes().map((b) => b.value)).toEqual(["dos"]);
    await waitFor(() => expect(boxes()[0]).toHaveFocus());
    const uno = (await db.getAll("Activity")).find((r) => r.rawInput === "uno")!;
    const back = new Date(uno.hiddenUntil!);
    expect([back.getHours(), back.getMinutes()]).toEqual([8, 0]);
    expect(back.getDate()).toBe(new Date(Date.now() + 86_400_000).getDate());
    expect(uno.isHidden).toBe(false);

    const toast = screen.getByTestId("hidden-toast");
    expect(toast).toHaveTextContent(/^Oculta hasta el /);
    expect(within(toast).queryByRole("button", { name: "Valorar" })).toBeNull(); // nothing to rate
    await user.click(within(toast).getByRole("button", { name: "Deshacer" }));
    await flush();
    expect(boxes().map((b) => b.value)).toEqual(["uno", "dos"]);
    expect(await db.get("Activity", uno.id)).toMatchObject({ hiddenUntil: null, isHidden: false });
  });

  it("hide until shown again: it stays hidden (no time), and the panel offers 'show now'", async () => {
    const user = await typeLine("algún día");
    await user.click(screen.getByTestId("line-more-0"));
    await user.click(within(screen.getByTestId("line-panel")).getByRole("button", { name: "Hasta que la muestre" }));
    await flush();
    const row = await onlyActivity();
    expect(row).toMatchObject({ isHidden: true, hiddenUntil: null });
    expect(screen.getByTestId("hidden-toast")).toHaveTextContent("Oculta hasta que la muestres.");
    expect(boxes().map((b) => b.value)).toEqual([""]);

    act(() => usePageStore.getState().openPanel(row.id));
    const panel = within(screen.getByTestId("line-panel"));
    expect(panel.getByTestId("panel-hidden")).toHaveTextContent("oculto hasta que lo muestres");
    await user.click(panel.getByRole("button", { name: "Mostrar ahora" }));
    await flush();
    expect(await onlyActivity()).toMatchObject({ isHidden: false, hiddenUntil: null });
    expect(boxes().map((b) => b.value)).toEqual(["algún día"]);
  });

  it("a hidden line comes back by itself when its time arrives", async () => {
    await typeLine("estirar ~diario");
    const row = await onlyActivity();
    // As if ticked earlier: hidden until 300 ms from now.
    await act(() => usePageStore.getState().updateFields(row.id, { hiddenUntil: new Date(Date.now() + 300).toISOString() }));
    expect(boxes().map((b) => b.value)).toEqual([""]);
    await waitFor(() => expect(boxes().map((b) => b.value)).toEqual(["estirar ~diario"]), { timeout: 3000 });
  });

  it("ticking a line moves the focus to the one taking its place", async () => {
    const user = await typeLine("uno ~diario{Enter}dos");
    await user.click(boxes()[0]!);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(boxes().map((b) => b.value)).toEqual(["dos"]));
    await waitFor(() => expect(boxes()[0]).toHaveFocus());
  });

  it("HABIT: a day ticked hides it until tomorrow and offers 'formed' at the target", async () => {
    const user = await typeLine("meditar !hábito");
    const habit = await onlyActivity();
    await act(() => usePageStore.getState().updateFields(habit.id, { targetStreak: 1 }));
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    const after = await onlyActivity();
    expect(after.streak).toBe(1);
    expect(new Date(after.hiddenUntil!).getDate()).toBe(new Date(Date.now() + 86_400_000).getDate());
    await user.click(await screen.findByRole("button", { name: "Marcar como formado" }));
    await flush();
    expect((await onlyActivity()).status).toBe("COMPLETED");
  });

  it("GRATITUDE opens the panel on the notes; completing needs notes", async () => {
    const user = await typeLine("hoy !gratitud");
    await user.click(screen.getByTestId("line-done-0"));
    const panel = screen.getByTestId("line-panel");
    const notes = within(panel).getByLabelText("Notas de gratitud");
    expect(document.activeElement).toBe(notes);
    const save = within(panel).getByRole("button", { name: "Guardar y completar" });
    expect(save).toBeDisabled();
    await user.type(notes, "el sol");
    expect(save).toBeEnabled();
    await user.click(save);
    await flush();
    expect(await onlyActivity()).toMatchObject({ status: "COMPLETED", description: "el sol" });
  });

  it("MOMENTO shows a star badge, not a button", async () => {
    await typeLine("boda !momento");
    expect(screen.getByTestId("line-done-0").tagName).toBe("SPAN");
    expect(screen.getByTestId("line-done-0")).toHaveTextContent("★");
  });
});

describe("side panel", () => {
  it("Ctrl+. opens it; Esc closes it and the focus returns to the line", async () => {
    const user = await typeLine("algo");
    await user.keyboard("{Control>}.{/Control}");
    expect(screen.getByTestId("line-panel")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("line-panel")).toBeNull();
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it("after a tick the focus goes to the line taking its place; Ctrl+. also works from the tick itself", async () => {
    const user = await typeLine("uno{Enter}dos");
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    await waitFor(() => expect(document.activeElement).toBe(boxes()[0])); // Safari never focuses a clicked button
    expect(boxes()[0]!.value).toBe("dos");
    act(() => screen.getByTestId("line-done-0").focus()); // reached with Tab
    await user.keyboard("{Control>}.{/Control}");
    expect(screen.getByTestId("line-panel")).toBeInTheDocument();
  });

  it("panel edits rewrite the marks in the text, and the text round-trips back to the fields", async () => {
    const user = await typeLine("informe");
    await user.click(screen.getByTestId("line-more-0"));
    const panel = () => within(screen.getByTestId("line-panel"));

    await user.selectOptions(panel().getByLabelText("Añadir bandera"), HEALTH);
    await user.selectOptions(panel().getByLabelText("Añadir bandera"), flagId(SUB, "income/project"));
    await flush();
    expect(boxes()[0]!.value).toBe("informe #salud #proyecto");
    expect(await onlyActivity()).toMatchObject({ status: "ACTIVE", title: "informe" });

    fireDate(panel().getByLabelText("Fecha límite") as HTMLInputElement, "2026-12-31");
    await flush();
    expect(boxes()[0]!.value).toBe("informe #salud #proyecto @2026-12-31");
    expect((await onlyActivity()).deadline).toBe(new Date(2026, 11, 31).toISOString());

    await user.click(panel().getByRole("button", { name: "Quitar Salud" }));
    await flush();
    expect(boxes()[0]!.value).toBe("informe #proyecto @2026-12-31");

    await user.selectOptions(panel().getByLabelText("Tipo", { selector: "select" }), "EXPIRATION");
    await flush();
    const row = await onlyActivity();
    expect(row.rawInput).toBe("informe #proyecto @2026-12-31 !vence");
    expect(row).toMatchObject({ activityType: "EXPIRATION", expirationDate: new Date(2026, 11, 31).toISOString(), deadline: null });
  });

  it("frequency CUSTOM has no mark and survives re-deriving the text", async () => {
    const user = await typeLine("yoga !hábito ~diario");
    await user.click(screen.getByTestId("line-more-0"));
    const panel = within(screen.getByTestId("line-panel"));
    await user.selectOptions(panel.getByLabelText("Frecuencia"), "CUSTOM");
    await user.type(panel.getByLabelText("Expresión cron"), "0 7 * * 1-5");
    await flush();
    const row = await onlyActivity();
    expect(row).toMatchObject({ rawInput: "yoga !hábito", frequency: "CUSTOM", cron: "0 7 * * 1-5" });
    expect(panel.getByText(/^Próxima vez:/)).toBeInTheDocument();
  });

  it("EXPIRATION: renewing rewrites the date mark; archiving removes the line and sets isRenewed", async () => {
    const user = await typeLine("pasaporte !vence @2026-12-01");
    await user.click(screen.getByTestId("line-done-0"));
    const panel = within(screen.getByTestId("line-panel"));
    fireDate(panel.getByLabelText("Nueva fecha") as HTMLInputElement, "2036-12-01");
    await user.click(panel.getByRole("button", { name: "Renovada" }));
    await flush();
    expect(boxes()[0]!.value).toBe("pasaporte !vence @2036-12-01");

    await user.click(panel.getByRole("button", { name: "Archivar sin renovar" }));
    await flush();
    expect(await onlyActivity()).toMatchObject({ status: "ARCHIVED", isRenewed: true });
    expect(screen.queryByTestId("line-panel")).toBeNull();
    expect(boxes()[0]!.value).toBe(""); // only the empty ghost line is left
  });

  it("pausing shows the line in italics without a tick; everything survives a reload", async () => {
    const user = userEvent.setup();
    const first = await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("correr #salud");
    await user.click(screen.getByTestId("line-more-0"));
    await user.click(within(screen.getByTestId("line-panel")).getByRole("button", { name: "Pausar" }));
    await flush();
    expect(screen.getByTestId("line-done-0").tagName).toBe("SPAN");

    const { unmount } = await remount(first);
    await waitFor(() => expect(screen.getByTestId("line-done-0")).toHaveAttribute("title", "En pausa"));
    expect(await onlyActivity()).toMatchObject({ status: "INACTIVE", title: "correr" });
    unmount();
  });
});

/** Date inputs: user-event cannot type into type="date" in jsdom. */
function fireDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("unknown flag marks", () => {
  beforeEach(() => resetFlagStore());

  it("the panel offers to create the flag, and the line resolves at once", async () => {
    const user = await typeLine("nadar #natación");
    expect((await onlyActivity()).status).toBe("DRAFT");
    await user.click(screen.getByTestId("line-more-0"));
    await user.click(within(screen.getByTestId("line-panel")).getByRole("button", { name: "Crear bandera «natación»" }));
    await waitFor(async () => expect((await onlyActivity()).status).toBe("ACTIVE"));
    const created = (await db.getAll("Flag")).find((f) => f.name === "natación")!;
    expect(created).toMatchObject({ parentId: null, weight: 0, isSystemDefault: false });
    const row = await onlyActivity();
    expect(row.rawInput).toBe("nadar #natación");
    expect((await db.get("ActivityFlag", activityFlagId(row.id, created.id)))?.deletedAt ?? null).toBeNull();
    // The chip replaces the offer.
    await waitFor(() => expect(screen.queryByTestId("panel-create-flag")).toBeNull());
    expect(within(screen.getByTestId("line-panel")).getByRole("button", { name: "Quitar natación" })).toBeTruthy();
  });
});

describe("feedback", () => {
  beforeEach(() => resetFeedbackStore());

  it("after completing an ACTION, 'Valorar' in the toast opens the feedback form of the completed line", async () => {
    const user = await typeLine("llamar #familia");
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    const prompt = await screen.findByTestId("feedback-prompt");
    expect(prompt).toHaveTextContent("Valorar");
    await user.click(prompt);
    const panel = within(screen.getByTestId("line-panel"));
    await waitFor(() => expect(panel.getByRole("heading", { name: "Valoraciones" })).toHaveFocus());
    expect(screen.queryByTestId("completed-toast")).toBeNull();
  });

  it("saves a rating with an optional emotion and notes, lists it, and deletes it", async () => {
    const user = await typeLine("correr #salud");
    await user.click(screen.getByTestId("line-more-0"));
    const panel = () => within(screen.getByTestId("line-panel"));
    const save = panel().getByRole("button", { name: "Guardar valoración" });
    expect(save).toBeDisabled(); // a rating is required

    await user.click(panel().getByLabelText("4 de 5"));
    fireRange(panel().getByLabelText("Ánimo") as HTMLInputElement, "0.8");
    await user.type(panel().getByLabelText("Notas"), "  buen ritmo  ");
    await user.click(save);

    const row = await onlyActivity();
    await waitFor(async () => expect(await db.listByIndex("Feedback", "activityId", row.id)).toHaveLength(1));
    const [fb] = await db.listByIndex("Feedback", "activityId", row.id);
    expect(fb).toMatchObject({ rating: 4, emotionValence: 0.8, emotionArousal: null, content: "buen ritmo", dirty: 1 });

    const list = within(await screen.findByTestId("feedback-list"));
    expect(list.getByLabelText("4 de 5")).toBeInTheDocument();
    expect(list.getByText("Bien")).toBeInTheDocument();
    expect(list.getByText("buen ritmo")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Guardar valoración" })).toBeDisabled(); // form reset

    await user.click(list.getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(screen.queryByTestId("feedback-list")).toBeNull());
    expect((await db.get("Feedback", fb!.id))!.deletedAt).toBeTruthy();
  });
});

function fireRange(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("schedule picker (weekly / monthly / daily)", () => {
  it("weekly: pick weekdays and a time; ticking hides it until the next picked day", async () => {
    const user = await typeLine("regar plantas ~semanal");
    await user.click(screen.getByTestId("line-more-0"));
    const panel = within(screen.getByTestId("line-panel"));
    expect(panel.getByText("Sin día elegido: vuelve 7 días después de marcarlo.")).toBeInTheDocument();
    expect(panel.getByTestId("schedule-time")).toBeDisabled(); // a time needs a day first

    await user.click(panel.getByRole("button", { name: "lunes" }));
    await user.click(panel.getByRole("button", { name: "jueves" }));
    expect(panel.getByRole("button", { name: "lunes" })).toHaveAttribute("aria-pressed", "true");
    fireDate(panel.getByTestId("schedule-time") as HTMLInputElement, "08:30");
    await flush();
    expect(await onlyActivity()).toMatchObject({ frequency: "WEEKLY", cron: "30 8 * * 1,4", rawInput: "regar plantas ~semanal" });
    expect(panel.getByTestId("schedule-next")).toHaveTextContent(/^Próxima vez: (lunes|jueves)/);

    await user.click(panel.getByRole("button", { name: "Cerrar" }));
    await user.click(screen.getByTestId("line-done-0"));
    await flush();
    const back = new Date((await onlyActivity()).hiddenUntil!);
    expect([1, 4]).toContain(back.getDay());
    expect([back.getHours(), back.getMinutes()]).toEqual([8, 30]);
    expect(back.getTime() - Date.now()).toBeLessThanOrEqual(4 * 86_400_000); // never more than 4 days away
  });

  it("switching to monthly drops the weekdays; a day of the month or the last day can be picked", async () => {
    const user = await typeLine("pagar cuota ~semanal");
    await user.click(screen.getByTestId("line-more-0"));
    const panel = within(screen.getByTestId("line-panel"));
    await user.click(panel.getByRole("button", { name: "viernes" }));
    await flush();
    expect((await onlyActivity()).cron).toBe("0 0 * * 5");

    await user.selectOptions(panel.getByLabelText("Frecuencia"), "MONTHLY");
    await flush();
    expect(await onlyActivity()).toMatchObject({ rawInput: "pagar cuota ~mensual", frequency: "MONTHLY", cron: null });
    expect(panel.getByText("Sin día elegido: vuelve el mismo día del mes siguiente.")).toBeInTheDocument();

    await user.selectOptions(panel.getByTestId("schedule-monthday"), "last");
    await flush();
    expect((await onlyActivity()).cron).toBe("0 0 L * *");
    await user.selectOptions(panel.getByTestId("schedule-monthday"), "5");
    fireDate(panel.getByTestId("schedule-time") as HTMLInputElement, "09:00");
    await flush();
    expect((await onlyActivity()).cron).toBe("0 9 5 * *");

    // The mark typed by hand works the same: back to weekly drops the monthly day.
    await user.selectOptions(panel.getByLabelText("Frecuencia"), "WEEKLY");
    await flush();
    expect((await onlyActivity()).cron).toBeNull();
  });

  it("daily: a time makes it come back at that time; a custom cron is kept and shown as custom", async () => {
    const user = await typeLine("meditar !hábito ~diario");
    await user.click(screen.getByTestId("line-more-0"));
    const panel = within(screen.getByTestId("line-panel"));
    fireDate(panel.getByTestId("schedule-time") as HTMLInputElement, "07:15");
    await flush();
    expect((await onlyActivity()).cron).toBe("15 7 * * *");

    await user.clear(panel.getByLabelText("Expresión cron"));
    await user.type(panel.getByLabelText("Expresión cron"), "0 7 * * 1-5");
    await flush();
    expect(panel.getByText(/horario personalizado/)).toBeInTheDocument();
    expect((await onlyActivity()).cron).toBe("0 7 * * 1-5");
  });
});
