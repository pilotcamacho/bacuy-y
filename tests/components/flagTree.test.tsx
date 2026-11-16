import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { resetEventsForTests } from "@/lib/events";
import i18n from "@/lib/i18n";
import { flagId } from "@/lib/ids";
import { Flags } from "@/routes/Flags";
import { resetFlagStore, useFlagStore } from "@/stores/flagStore";
import { resetPageStoreForTests } from "@/stores/pageStore";

/** The Flags screen: the weight editor blocks saving until a group sums to 100; drift; delete. */

const SUB = "sub-flag-tree";
const INCOME = flagId(SUB, "income");
const SALARY = flagId(SUB, "income/salary");
const PROJECT = flagId(SUB, "income/project");
const RENT = flagId(SUB, "income/rent");

let db: LocalDb;
let n = 0;

beforeEach(async () => {
  await i18n.changeLanguage("es");
  db = await openLocalDb(`bacuyy-flagtree-${++n}`);
  setDbForTests(db);
  resetFlagStore();
  resetPageStoreForTests();
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
  render(<Flags />);
  await screen.findByTestId(`flag-weight-${SALARY}`);
}

describe("Flags screen", () => {
  it("shows the default tree with translated names and no drift warning", async () => {
    await mount();
    expect(screen.getByText("Salud")).toBeTruthy();
    expect(screen.getByText("Salario")).toBeTruthy();
    expect(screen.queryByTestId("flags-drift")).toBeNull();
    expect(screen.getByTestId(`flags-sum-${INCOME}`).textContent).toBe("Suma: 100 / 100");
    // System flags have no delete button.
    expect(screen.queryByTestId(`flag-delete-${SALARY}`)).toBeNull();
  });

  it("blocks saving until the siblings sum to 100", async () => {
    const user = userEvent.setup();
    await mount();
    const salary = screen.getByTestId(`flag-weight-${SALARY}`);
    await user.clear(salary);
    await user.type(salary, "60");
    expect(screen.getByTestId(`flags-sum-${INCOME}`).textContent).toBe("Suma: 110 / 100");
    const save = screen.getByTestId(`flags-save-${INCOME}`) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(screen.getByTestId(`flags-group-${INCOME}`)).getByText(/deben sumar 100/)).toBeTruthy();

    const rent = screen.getByTestId(`flag-weight-${RENT}`);
    await user.clear(rent);
    await user.type(rent, "10");
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(async () => expect((await db.get("Flag", SALARY))!.weight).toBe(60));
    expect((await db.get("Flag", RENT))!.weight).toBe(10);
    expect((await db.get("Flag", PROJECT))!.weight).toBe(30);
    expect(screen.queryByTestId(`flags-save-${INCOME}`)).toBeNull(); // nothing left to save
  });

  it("warns when a sync left a group that does not sum to 100", async () => {
    await useFlagStore.getState().load(SUB);
    const salary = (await db.get("Flag", SALARY))!;
    await db.putFromServer("Flag", { ...salary, weight: 70, editedAt: "2026-11-14T00:00:00.000Z" });
    await mount();
    await useFlagStore.getState().refresh();
    expect(await screen.findByTestId("flags-drift")).toBeTruthy();
    expect(screen.getByTestId(`flags-sum-${INCOME}`).textContent).toBe("Suma: 120 / 100");
  });

  it("adds a subflag, renames it, and deletes it after confirming", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("button", { name: "Añadir subbandera a Salud" }));
    await user.type(screen.getByPlaceholderText("Nueva subbandera"), "Gimnasio{Enter}");
    const created = await waitFor(() => {
      const f = useFlagStore.getState().flags.find((x) => x.name === "Gimnasio");
      expect(f).toBeTruthy();
      return f!;
    });
    expect(created.parentId).toBe(flagId(SUB, "health"));
    expect(created.weight).toBe(100);

    const name = await screen.findByTestId(`flag-name-${created.id}`);
    await user.clear(name);
    await user.type(name, "Salario{Enter}"); // "Salario" is taken under Ingresos, not under Salud
    await waitFor(async () => expect((await db.get("Flag", created.id))!.name).toBe("Salario"));

    await user.click(screen.getByTestId(`flag-delete-${created.id}`));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Los renglones conservan la marca/)).toBeTruthy();
    await user.click(screen.getByTestId(`flag-delete-confirm-${created.id}`));
    await waitFor(async () => expect((await db.get("Flag", created.id))!.deletedAt).toBeTruthy());
    // The screen follows once the write (and the re-parse of the lines) has finished.
    await waitFor(() => expect(screen.queryByTestId(`flag-${created.id}`)).toBeNull());
  });

  it("keys typed while a new flag saves start the next name (none are lost)", async () => {
    const user = userEvent.setup();
    await mount();
    // Hold the save until the next name is half typed.
    const real = useFlagStore.getState().create;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    useFlagStore.setState({ create: async (...args) => (await gate, real(...args)) });
    const input = screen.getByPlaceholderText("Nueva bandera");
    await user.type(input, "Lectura{Enter}Cor");
    release();
    await waitFor(() => expect(useFlagStore.getState().flags.some((f) => f.name === "Lectura")).toBe(true));
    await user.type(input, "rer");
    expect(input).toHaveValue("Correr");
  });

  it("refuses a duplicate name among siblings", async () => {
    const user = userEvent.setup();
    await mount();
    await user.type(screen.getByPlaceholderText("Nueva bandera"), "salud{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Ya hay una bandera/);
    expect(useFlagStore.getState().flags).toHaveLength(10);
  });
});
