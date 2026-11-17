import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlagFilter } from "@/components/FlagFilter";
import { LineEditor } from "@/components/LineEditor";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import i18n from "@/lib/i18n";
import { flagId } from "@/lib/ids";
import { activeFilter, allowedFlagIds, filterLines, NO_FLAG, withFilterFlag } from "@/services/editor/flagFilter";
import type { ParseContext } from "@/services/marks";
import { resetPageStoreForTests, usePageStore } from "@/stores/pageStore";

/** Filtering the page by flag: the pure rules, and the page with the filter bar. */

const SUB = "sub-filter";
const HEALTH = flagId(SUB, "health");
const ERRAND = flagId(SUB, "errand");
const INCOME = flagId(SUB, "income");
const PROJECT = flagId(SUB, "income/project");

describe("filter rules", () => {
  const flags = [
    { id: HEALTH, name: "health", parentId: null, isSystemDefault: true },
    { id: ERRAND, name: "errand", parentId: null, isSystemDefault: true },
    { id: INCOME, name: "income", parentId: null, isSystemDefault: true },
    { id: PROJECT, name: "project", parentId: INCOME, isSystemDefault: true },
  ];
  const ctx: ParseContext = { flags, today: new Date(2026, 10, 17) };
  const line = (id: string, rawInput: string) => ({ id, rawInput, position: id });
  const page = [line("a", "correr #salud"), line("b", "pagar luz #recados"), line("c", "informe #proyecto"), line("d", "idea suelta")];

  it("a parent includes its children; unknown ids are ignored", () => {
    expect(allowedFlagIds([INCOME, "gone"], flags)).toEqual(new Set([INCOME, PROJECT]));
    expect(activeFilter([INCOME, "gone", NO_FLAG], flags)).toEqual([INCOME, NO_FLAG]);
  });

  it("several flags show lines with any of them; NO_FLAG shows lines without one; empty shows all", () => {
    const ids = (filter: string[]) => filterLines(page, filter, ctx).map((l) => l.id);
    expect(ids([HEALTH])).toEqual(["a"]);
    expect(ids([INCOME])).toEqual(["c"]);
    expect(ids([HEALTH, ERRAND])).toEqual(["a", "b"]);
    expect(ids([NO_FLAG])).toEqual(["d"]);
    expect(ids([])).toEqual(["a", "b", "c", "d"]);
    expect(ids(["gone"])).toEqual(["a", "b", "c", "d"]); // a filter of only deleted flags is off
  });

  it("a new line gets the filter's first flag unless it already matches", () => {
    expect(withFilterFlag("", [HEALTH], ctx, "es")).toBe(" #salud");
    expect(withFilterFlag("nadar", [HEALTH, ERRAND], ctx, "es")).toBe("nadar #salud");
    expect(withFilterFlag("pan #recados", [HEALTH, ERRAND], ctx, "es")).toBe("pan #recados");
    expect(withFilterFlag("algo", [NO_FLAG], ctx, "es")).toBe("algo");
    expect(withFilterFlag("algo", [], ctx, "es")).toBe("algo");
    expect(withFilterFlag("", [PROJECT], ctx, "en")).toBe(" #project");
  });
});

describe("the page with a filter", () => {
  let db: LocalDb;
  let n = 0;

  beforeEach(async () => {
    await i18n.changeLanguage("es");
    db = await openLocalDb(`bacuyy-filter-${++n}`);
    setDbForTests(db);
    resetPageStoreForTests();
    resetAuthForTests({ status: "signedIn", user: { userId: SUB, username: SUB, email: "a@b.c" }, offline: false });
    const row = (id: string, rawInput: string, position: string) => ({
      id,
      title: rawInput,
      rawInput,
      activityType: "ACTION" as const,
      status: "DRAFT" as const,
      position,
      editedAt: "2026-11-10T10:00:00.000Z",
    });
    await db.putLocal("Activity", row("run", "correr #salud", "a1"));
    await db.putLocal("Activity", row("bills", "pagar luz #recados", "a2"));
    await db.putLocal("Activity", row("report", "informe #proyecto", "a3"));
    await db.putLocal("Activity", row("idea", "idea suelta", "a4"));
  });

  afterEach(() => {
    cleanup();
    db.close();
    setDbForTests(null);
    resetAuthForTests();
  });

  const mount = async () => {
    const view = render(
      <>
        <FlagFilter />
        <LineEditor />
      </>,
    );
    await waitFor(() => expect(values()).toHaveLength(4));
    return view;
  };
  const boxes = () => screen.getAllByRole("textbox", { name: /^Renglón/ }) as HTMLTextAreaElement[];
  const values = () => boxes().map((b) => b.value);
  const flush = () => act(() => usePageStore.getState().flushAll());

  it("picking flags filters the page (parent includes children); chips show it; clear shows all", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByTestId("flag-filter-toggle"));
    await user.click(screen.getByTestId(`flag-filter-option-${HEALTH}`));
    expect(values()).toEqual(["correr #salud"]);
    expect(screen.getByTestId(`flag-filter-chip-${HEALTH}`)).toHaveTextContent("Salud");

    await user.click(screen.getByTestId(`flag-filter-option-${INCOME}`));
    expect(values()).toEqual(["correr #salud", "informe #proyecto"]);

    await user.click(screen.getByTestId("flag-filter-option-none"));
    expect(values()).toEqual(["correr #salud", "informe #proyecto", "idea suelta"]);

    await user.click(screen.getByTestId("flag-filter-clear"));
    expect(values()).toEqual(["correr #salud", "pagar luz #recados", "informe #proyecto", "idea suelta"]);
    expect(screen.queryByTestId(`flag-filter-chip-${HEALTH}`)).toBeNull();
  });

  it("a line typed while filtered gets the flag and stays; a line whose mark is removed stays in view", async () => {
    const user = userEvent.setup();
    await mount();
    act(() => usePageStore.getState().setFilter([HEALTH]));
    await waitFor(() => expect(values()).toEqual(["correr #salud"]));

    // Enter at the end: the new line already carries the flag; typing goes before it.
    await user.click(boxes()[0]!);
    await user.keyboard("{End}{Enter}nadar");
    await flush();
    expect(values()).toEqual(["correr #salud", "nadar #salud"]);
    const swim = (await db.getAll("Activity")).find((r) => r.rawInput === "nadar #salud")!;
    expect(swim.title).toBe("nadar");
    expect(swim.position > "a1" && swim.position < "a2").toBe(true); // right after "correr" on the whole page

    // Typing over the mark of the line being edited does not make it vanish.
    await user.keyboard("{End}{Backspace>7/}");
    await flush();
    expect(values()).toEqual(["correr #salud", "nadar"]);

    // A new filter starts fresh: "nadar" no longer matches.
    act(() => usePageStore.getState().setFilter([HEALTH, ERRAND]));
    expect(values()).toEqual(["correr #salud", "pagar luz #recados"]);
  });

  it("the filter is kept on this device", async () => {
    act(() => usePageStore.getState().setFilter([ERRAND]));
    const first = await (async () => {
      const view = render(<LineEditor />);
      await waitFor(() => expect(values()).toEqual(["pagar luz #recados"]));
      return view;
    })();
    first.unmount();
    resetPageStoreForTests();
    render(<LineEditor />);
    await waitFor(() => expect(values()).toEqual(["pagar luz #recados"]));
    expect(usePageStore.getState().filter).toEqual([ERRAND]);
  });

  it("an empty filtered page offers a line to type in that gets the flag", async () => {
    const user = userEvent.setup();
    act(() => usePageStore.getState().setFilter([flagId(SUB, "fun")]));
    render(<LineEditor />);
    await waitFor(() => expect(boxes()).toHaveLength(1));
    expect(boxes()[0]).toHaveAttribute("placeholder", "Nada con este filtro. Escribe aquí para añadir.");
    await user.click(boxes()[0]!);
    await user.keyboard("cine");
    await flush();
    await waitFor(() => expect(values()).toEqual(["cine #diversión"]));
    expect(within(document.body).getAllByRole("textbox", { name: /^Renglón/ })).toHaveLength(1);
  });
});
