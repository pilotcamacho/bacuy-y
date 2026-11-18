import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineEditor } from "@/components/LineEditor";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import i18n from "@/lib/i18n";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";

/**
 * The editor against a real (fake-indexeddb) LocalDb. "Reload" = forget the store, unmount,
 * render again from the same database.
 */

let db: LocalDb;
let n = 0;
let dbName = "";

beforeEach(async () => {
  await i18n.changeLanguage("es");
  dbName = `bacuyy-editor-${++n}`;
  db = await openLocalDb(dbName);
  setDbForTests(db);
  resetPageStoreForTests();
});

afterEach(() => {
  db.close();
  setDbForTests(null);
});

async function mount() {
  const view = render(<LineEditor />);
  await screen.findAllByRole("textbox");
  return view;
}

async function reload(previous: { unmount(): void }) {
  await act(() => usePageStore.getState().flushAll());
  previous.unmount();
  return mountAgain();
}

async function mountAgain() {
  resetPageStoreForTests();
  db.close();
  db = await openLocalDb(dbName);
  setDbForTests(db);
  return render(<LineEditor />);
}

const boxes = () => screen.getAllByRole("textbox") as HTMLTextAreaElement[];
const values = () => boxes().map((b) => b.value);

async function storedLines() {
  const rows = (await db.getAll("Activity")).filter((r) => !r.deletedAt);
  return rows.sort((a, b) => (a.position < b.position ? -1 : 1)).map((r) => r.rawInput);
}

function caretAt(box: HTMLTextAreaElement, offset: number) {
  box.focus();
  box.setSelectionRange(offset, offset);
}

describe("LineEditor", () => {
  it("text typed just before the page is killed (no flush, debounce pending) is back on the next load", async () => {
    const user = userEvent.setup();
    const view = await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("comprar pan");
    await act(() => usePageStore.getState().flushAll());
    await user.keyboard(" y leche"); // still in its 300 ms debounce
    // Killed: no flush, the pending timer dies with the page.
    view.unmount();
    resetPageStoreForTests();
    expect(await storedLines()).toEqual(["comprar pan"]);

    await mountAgain();
    await waitFor(() => expect(values()).toEqual(["comprar pan y leche"]));
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["comprar pan y leche"]);
    expect((await db.getAll("Activity"))[0]!.dirty).toBe(1); // goes to the cloud on the next sync
    expect(localStorage.getItem("bacuyy_pendingRows")).toBeNull(); // the backup is gone once written
  });

  it("an older backup never overwrites a newer stored row", async () => {
    const user = userEvent.setup();
    const view = await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno");
    await act(() => usePageStore.getState().flushAll());
    const row = (await db.getAll("Activity"))[0]!;
    // A stale backup (e.g. another tab's) older than what the database holds.
    localStorage.setItem("bacuyy_pendingRows", JSON.stringify({ [row.id]: { ...row, rawInput: "viejo", title: "viejo", editedAt: "2000-01-01T00:00:00.000Z" } }));
    await reload(view);
    await waitFor(() => expect(values()).toEqual(["uno"]));
  });

  it("an empty page shows one line to type in; typing creates the first row", async () => {
    const user = userEvent.setup();
    await mount();
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]).toHaveAttribute("placeholder", "Escribe aquí…");
    expect(await db.getAll("Activity")).toHaveLength(0); // nothing stored until you type

    await user.click(boxes()[0]!);
    await user.keyboard("comprar pan");
    expect(values()).toEqual(["comprar pan"]);
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["comprar pan"]);
  });

  it("typed lines survive a reload", async () => {
    const user = userEvent.setup();
    const first = await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos{Enter}tres");
    expect(values()).toEqual(["uno", "dos", "tres"]);

    const { unmount } = await reload(first);
    await waitFor(() => expect(values()).toEqual(["uno", "dos", "tres"]));
    unmount();
  });

  it("Enter in the middle splits the line and moves the caret to the new one", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("pan leche");
    caretAt(boxes()[0]!, 3);
    await user.keyboard("{Enter}");
    expect(values()).toEqual(["pan", " leche"]);
    expect(document.activeElement).toBe(boxes()[1]);
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["pan", " leche"]);
  });

  it("Backspace at the start merges into the line above; undo restores both", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos");
    caretAt(boxes()[1]!, 0);
    await user.keyboard("{Backspace}");
    expect(values()).toEqual(["uno dos"]);
    expect(document.activeElement).toBe(boxes()[0]);
    expect(boxes()[0]!.selectionStart).toBe(4);

    await user.click(await screen.findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(values()).toEqual(["uno", "dos"]));
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["uno", "dos"]);
  });

  it("Backspace on an empty line deletes it (soft delete) but never the last line", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}{Backspace}");
    expect(values()).toEqual(["uno"]);
    await act(() => usePageStore.getState().flushAll());
    const all = await db.getAll("Activity");
    expect(all.filter((r) => r.deletedAt)).toHaveLength(1);
    expect(all.every((r) => r.dirty === 1)).toBe(true);

    caretAt(boxes()[0]!, 3);
    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}");
    expect(values()).toEqual([""]);
  });

  it("Delete at the end merges the line below", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("a{Enter}b");
    caretAt(boxes()[0]!, 1);
    await user.keyboard("{Delete}");
    expect(values()).toEqual(["a b"]);
  });

  it("pasting several lines creates one row per line", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.paste("leche\nhuevos\n\npan");
    expect(values()).toEqual(["leche", "huevos", "pan"]);
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["leche", "huevos", "pan"]);
  });

  it("Alt+↓ / Alt+↑ move the line and keep the order after a reload", async () => {
    const user = userEvent.setup();
    const first = await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos{Enter}tres");
    caretAt(boxes()[0]!, 0);
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(values()).toEqual(["dos", "uno", "tres"]);
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(values()).toEqual(["dos", "tres", "uno"]);
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(values()).toEqual(["dos", "uno", "tres"]);

    const { unmount } = await reload(first);
    await waitFor(() => expect(values()).toEqual(["dos", "uno", "tres"]));
    unmount();
  });

  it("after Alt+↑, a slow save never pulls the focus back from where the user went (e.g. the panel)", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos");
    await act(() => usePageStore.getState().flushAll());

    // Hold the move's write until released.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const put = db.putManyLocal.bind(db);
    db.putManyLocal = async (ops) => {
      await held;
      return put(ops);
    };
    const other = document.createElement("input");
    try {
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(values()).toEqual(["dos", "uno"]);
      document.body.appendChild(other);
      act(() => other.focus()); // like Ctrl+. focusing the panel's text field
      await act(async () => {
        release();
        await usePageStore.getState().flushAll();
      });
      expect(document.activeElement).toBe(other);
    } finally {
      db.putManyLocal = put;
      other.remove();
    }
  });

  it("Enter at the start of a line adds an empty line above; the line keeps its row and fields", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos");
    await act(() => usePageStore.getState().flushAll());
    const dos = (await db.getAll("Activity")).find((r) => r.rawInput === "dos")!;
    await db.putLocal("Activity", { ...dos, description: "notas de dos", editedAt: new Date().toISOString() });
    await act(() => usePageStore.getState().refresh());

    caretAt(boxes()[1]!, 0);
    await user.keyboard("{Enter}");
    expect(values()).toEqual(["uno", "", "dos"]);
    expect(document.activeElement).toBe(boxes()[2]);
    expect(boxes()[2]!.selectionStart).toBe(0);
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["uno", "", "dos"]);
    expect(await db.get("Activity", dos.id)).toMatchObject({ rawInput: "dos", description: "notas de dos" });

    // Backspace takes the empty line away again; "dos" still keeps its row.
    await user.keyboard("{Backspace}");
    expect(values()).toEqual(["uno", "dos"]);
    await act(() => usePageStore.getState().flushAll());
    expect(await db.get("Activity", dos.id)).toMatchObject({ rawInput: "dos", description: "notas de dos" });
    expect((await db.get("Activity", dos.id))!.deletedAt).toBeFalsy();
  });

  it("↑ / ↓ move the focus between lines", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(boxes()[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(boxes()[1]);
  });

  it("stores the title without marks and the type from !type", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("meditar !hábito ~diario");
    await act(() => usePageStore.getState().flushAll());
    const [row] = await db.getAll("Activity");
    expect(row).toMatchObject({ rawInput: "meditar !hábito ~diario", title: "meditar", activityType: "HABIT", frequency: "DAILY", status: "DRAFT" });
  });

  it("leaving the line rewrites relative dates to ISO", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("informe @hoy");
    await user.keyboard("{Enter}");
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await waitFor(() => expect(values()[0]).toBe(`informe @${iso}`));
  });

  it("highlights marks in the mirror (unknown flag underlined)", async () => {
    const user = userEvent.setup();
    const { container } = await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("leer !hábito #xyz");
    const spans = [...container.querySelectorAll('[aria-hidden="true"] span')].filter((s) => s.className);
    expect(spans.map((s) => s.textContent)).toEqual(["!hábito", "#xyz"]);
    expect(spans[0]!.className).toContain("bg-indigo");
    expect(spans[1]!.className).toContain("decoration-dotted");
  });

  it("the textarea never paints a background over the mirror (typed text must stay visible)", async () => {
    await mount();
    const box = boxes()[0]!;
    const backgrounds = box.className.split(/\s+/).filter((c) => /(^|:)bg-/.test(c) && !c.startsWith("selection:") && !c.startsWith("dark:selection:"));
    expect(backgrounds).toEqual(["bg-transparent"]);
  });

  it("has a labelled drag handle per line (disabled while there is only one line)", async () => {
    const user = userEvent.setup();
    await mount();
    expect(screen.getByTestId("line-handle-0")).toBeDisabled();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos");
    expect(screen.getByRole("button", { name: "Mover el renglón 2" })).toBeEnabled();
    expect(screen.getByTestId("line-row-1")).toBeInTheDocument();
  });
});

describe("the add-line button under the page", () => {
  const addButton = () => screen.getByRole("button", { name: /Añadir renglón/ });

  it("is not there on an empty page (its placeholder line is the place to type)", async () => {
    await mount();
    expect(screen.queryByTestId("line-add")).toBeNull();
  });

  it("adds an empty line at the very end, focused, and typing fills it", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno{Enter}dos");
    await user.click(boxes()[0]!); // the caret is far from the end
    await user.click(addButton());
    expect(values()).toEqual(["uno", "dos", ""]);
    expect(boxes()[2]).toHaveFocus();
    await user.keyboard("tres");
    await act(() => usePageStore.getState().flushAll());
    expect(await storedLines()).toEqual(["uno", "dos", "tres"]);
  });

  it("does not pile up empty lines: with an empty last line it just focuses it", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    await user.keyboard("uno");
    await user.click(addButton());
    await user.click(boxes()[0]!);
    await user.click(addButton());
    expect(values()).toEqual(["uno", ""]);
    expect(boxes()[1]).toHaveFocus();
  });
});
