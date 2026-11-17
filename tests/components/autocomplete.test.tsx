import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineEditor } from "@/components/LineEditor";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import i18n from "@/lib/i18n";
import { flagId } from "@/lib/ids";
import { applyMark, markQueryAt, suggestMarks, suggestRows, type SuggestContext } from "@/services/marks";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";

/** Autocomplete while typing a line: the pure rules, and the editor. */

const SUB = "sub-autocomplete";
const HEALTH = flagId(SUB, "health");
const INCOME = flagId(SUB, "income");
const PROJECT = flagId(SUB, "income/project");

describe("suggestion rules", () => {
  const flags = [
    { id: HEALTH, name: "health", parentId: null, isSystemDefault: true },
    { id: INCOME, name: "income", parentId: null, isSystemDefault: true },
    { id: PROJECT, name: "project", parentId: INCOME, isSystemDefault: true },
    { id: "own", name: "bacuy", parentId: null, isSystemDefault: false },
  ];
  // Tuesday 17 November 2026
  const es: SuggestContext = { flags, today: new Date(2026, 10, 17), locale: "es" };
  const en: SuggestContext = { ...es, locale: "en" };
  const at = (raw: string, caret = raw.length) => markQueryAt(raw, caret)!;
  const inserts = (raw: string, ctx = es) => suggestMarks(at(raw), ctx).items.map((s) => s.insert);

  it("finds the mark being typed at the caret, and nothing elsewhere", () => {
    expect(markQueryAt("pan #sal", 8)).toEqual({ kind: "flag", start: 4, end: 8, query: "sal" });
    expect(markQueryAt("pan #salud leche", 7)).toEqual({ kind: "flag", start: 4, end: 10, query: "sa" });
    expect(markQueryAt("pan ~", 5)).toEqual({ kind: "frequency", start: 4, end: 5, query: "" }); // the sigil alone: everything
    expect(markQueryAt("a#b", 3)).toBeNull(); // not at a word start
    expect(markQueryAt("pan leche", 9)).toBeNull();
  });

  it("flags: system ones in either language, written in the UI language; own flags; subflags", () => {
    expect(inserts("#sal")).toEqual(["#salud"]);
    expect(inserts("#heal")).toEqual(["#salud"]); // the English word finds it; Spanish is written
    expect(inserts("#heal", en)).toEqual(["#health"]);
    expect(inserts("#bac")).toEqual(["#bacuy"]);
    expect(inserts("#pro")).toEqual(["#proyecto"]);
    expect(inserts("#ingresos/pr")).toEqual(["#proyecto"]);
    expect(inserts("#zzz")).toEqual([]);
  });

  it("types, frequencies and dates: the UI language's word unless only the other one matches", () => {
    expect(inserts("!hab")).toEqual(["!hábito", "!habilidad"]);
    expect(inserts("!habit")).toEqual([]); // typed in full in English: kept as typed, nothing to add
    expect(inserts("#")).toHaveLength(4); // "#" alone lists the flags
    expect(inserts("~d")).toEqual(["~diario"]);
    expect(inserts("~dai")).toEqual(["~daily"]);
    expect(inserts("@ho")).toEqual(["@hoy"]);
    expect(inserts("@tod")).toEqual(["@today"]);
    expect(inserts("@tod", en)).toEqual(["@today"]);
    expect(inserts("@ma")).toEqual(["@mañana", "@martes"]);
    const friday = suggestMarks(at("@vie"), es).items[0]!;
    expect(friday).toMatchObject({ kind: "date", insert: "@viernes", day: { year: 2026, month: 11, day: 20 } });
  });

  it("a mark typed in full, in either language, is complete: left as typed, longer ones still listed", () => {
    expect(suggestMarks(at("#salud"), en)).toEqual({ items: [], complete: true }); // not rewritten to #health
    expect(suggestMarks(at("~daily"), es)).toEqual({ items: [], complete: true });
    expect(suggestMarks(at("@hoy"), en)).toEqual({ items: [], complete: true });
    const withLonger = { ...es, flags: [...flags, { id: "sm", name: "salud-mental", parentId: null }] };
    expect(suggestMarks(at("#salud"), withLonger)).toMatchObject({ complete: true, items: [{ insert: "#salud-mental" }] });
    expect(suggestMarks(at("#sal"), es).complete).toBe(false);
  });

  it("accepting replaces the whole word and leaves one space after it", () => {
    expect(applyMark("pan #sa", at("pan #sa"), "#salud")).toEqual({ raw: "pan #salud ", caret: 11 });
    expect(applyMark("pan #sa leche", at("pan #sa leche", 7), "#salud")).toEqual({ raw: "pan #salud leche", caret: 11 });
  });

  it("rows: same start (accents and case ignored), newest first, one per text, not itself", () => {
    const rows = [
      { id: "1", rawInput: "Comprar pan #recados", at: "2026-11-10" },
      { id: "2", rawInput: "comprar leche", at: "2026-11-16", completed: true },
      { id: "3", rawInput: "comprar pan #recados", at: "2026-11-15", completed: true },
      { id: "4", rawInput: "llamar a mamá", at: "2026-11-01" },
      { id: "5", rawInput: "ir a comprar sellos", at: "2026-11-02" },
      { id: "me", rawInput: "comp", at: "2026-11-17" },
    ];
    expect(suggestRows("comp", rows, "me").map((r) => r.id)).toEqual(["2", "3", "5"]);
    expect(suggestRows("mama", rows, null).map((r) => r.id)).toEqual(["4"]); // a later word's start counts too
    expect(suggestRows("amar", rows, null)).toEqual([]); // not inside a word
    expect(suggestRows("a mam", rows, null).map((r) => r.id)).toEqual(["4"]);
    expect(suggestRows("c", rows, null)).toEqual([]); // too short
    expect(suggestRows("comprar leche", rows, null)).toEqual([]); // nothing to complete
  });
});

describe("autocomplete in the editor", () => {
  let db: LocalDb;
  let n = 0;

  beforeEach(async () => {
    await i18n.changeLanguage("es");
    db = await openLocalDb(`bacuyy-autocomplete-${++n}`);
    setDbForTests(db);
    resetPageStoreForTests();
    resetAuthForTests({ status: "signedIn", user: { userId: SUB, username: SUB, email: "a@b.c" }, offline: false });
    const row = (id: string, rawInput: string, position: string, extra = {}) => ({
      id,
      title: rawInput,
      rawInput,
      activityType: "ACTION" as const,
      status: "DRAFT" as const,
      position,
      editedAt: "2026-11-10T10:00:00.000Z",
      ...extra,
    });
    await db.putLocal("Activity", row("bread", "comprar pan #recados", "a1"));
    await db.putLocal(
      "Activity",
      row("milk", "comprar leche", "a0", { status: "COMPLETED", completedAt: "2026-11-16T09:00:00.000Z" }),
    );
  });

  afterEach(() => {
    cleanup();
    db.close();
    setDbForTests(null);
    resetAuthForTests();
  });

  const boxes = () => screen.getAllByRole("textbox", { name: /^Renglón/ }) as HTMLTextAreaElement[];
  const values = () => boxes().map((b) => b.value);
  const mount = async () => {
    render(<LineEditor />);
    await waitFor(() => expect(values()).toEqual(["comprar pan #recados"]));
    await waitFor(() => expect(usePageStore.getState().flags.length).toBeGreaterThan(0));
  };
  const newLine = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(boxes()[0]!);
    await user.keyboard("{End}{Enter}");
  };

  it("#: Enter or Tab completes the flag, with a space after it; the list closes", async () => {
    const user = userEvent.setup();
    await mount();
    await newLine(user);
    await user.keyboard("correr #sal");
    const list = await screen.findByTestId("suggestions");
    expect(list).toHaveTextContent("#salud");
    expect(boxes()[1]).toHaveAttribute("aria-activedescendant");
    await user.keyboard("{Enter}");
    expect(values()).toEqual(["comprar pan #recados", "correr #salud "]);
    expect(screen.queryByTestId("suggestions")).toBeNull();
    expect(boxes()[1]!.selectionStart).toBe("correr #salud ".length);

    await user.keyboard("~sem{Tab}");
    expect(values()[1]).toBe("correr #salud ~semanal ");
    expect(document.activeElement).toBe(boxes()[1]); // Tab completed, it did not leave the line
  });

  it("↓ chooses another suggestion; Esc closes the list and Enter splits as usual", async () => {
    const user = userEvent.setup();
    await mount();
    await newLine(user);
    await user.keyboard("cine @ma");
    expect(await screen.findByTestId("suggestions")).toHaveTextContent("@mañana");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(values()[1]).toBe("cine @martes ");

    await user.keyboard("!hab");
    await screen.findByTestId("suggestions");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("suggestions")).toBeNull();
    await user.keyboard("{Enter}");
    // (Enter commits the line: "@martes" becomes its date, as always.)
    expect(values()).toEqual(["comprar pan #recados", expect.stringMatching(/^cine @\d{4}-\d{2}-\d{2} !hab$/), ""]);
  });

  it("rows: page and completed lines that start the same; Enter still makes a new line; ↓ + Enter copies one", async () => {
    const user = userEvent.setup();
    await mount();
    await newLine(user);
    await user.keyboard("comp");
    const list = await screen.findByTestId("suggestions");
    await waitFor(() => expect(list.children).toHaveLength(2)); // completed lines are read from the device
    // (Order, newest first, is covered above: loading re-saved "comprar pan", so it is newest here.)
    const options = screen.getAllByRole("option");
    const milk = options.findIndex((o) => o.textContent?.startsWith("comprar leche"));
    expect(options[milk]).toHaveTextContent("completada");
    expect(options[1 - milk]).toHaveTextContent("comprar pan #recados");
    expect(options[1 - milk]).not.toHaveTextContent("completada");
    expect(list.querySelector('[aria-selected="true"]')).toBeNull(); // nothing chosen yet

    for (let i = 0; i <= milk; i++) await user.keyboard("{ArrowDown}");
    expect(options[milk]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(values()).toEqual(["comprar pan #recados", "comprar leche"]);
    await act(() => usePageStore.getState().flushAll());
    // A new row with the copied text; the completed one is untouched.
    expect((await db.get("Activity", "milk"))!.status).toBe("COMPLETED");

    await user.keyboard("{Enter}comp{Enter}");
    expect(values()).toEqual(["comprar pan #recados", "comprar leche", "comp", ""]);
  });

  it("a tap on a suggestion keeps the focus in the line", async () => {
    const user = userEvent.setup();
    await mount();
    await newLine(user);
    await user.keyboard("comprar p");
    await user.click(await screen.findByTestId("suggestion-0"));
    expect(values()[1]).toBe("comprar pan #recados");
    expect(document.activeElement).toBe(boxes()[1]);
  });

  it("clicking into a line does not open suggestions; only typing does", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(boxes()[0]!);
    expect(screen.queryByTestId("suggestions")).toBeNull();
  });
});
