import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GratitudeSettings } from "@/components/GratitudeSettings";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import type { LocalDb } from "@/lib/db/types";
import { resetEventsForTests } from "@/lib/events";
import i18n from "@/lib/i18n";
import { Journal } from "@/routes/Journal";
import { getGratitudeSettings } from "@/services/gratitude/autoCreate";
import { resetPageStoreForTests } from "@/stores/pageStore";

/** Phase 10 screens: the gratitude setting creates the entry; the journal lists completed ones. */

const SUB = "sub-journal";
let db: LocalDb;
let n = 0;

beforeEach(async () => {
  await i18n.changeLanguage("es");
  localStorage.clear();
  db = await openLocalDb(`bacuyy-journal-${++n}`);
  setDbForTests(db);
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

const gratitude = (id: string, editedAt: string, status: "ACTIVE" | "COMPLETED", description: string | null = null) => ({
  id,
  title: `entrada ${id}`,
  rawInput: `entrada ${id} !gratitud`,
  activityType: "GRATITUDE" as const,
  status,
  description,
  position: `a${id}`,
  editedAt,
});

describe("Settings › gratitude", () => {
  it("on by default; turning it on creates this window's entry; an invalid schedule is not stored", async () => {
    await db.setMeta("lastPulledAt:Activity", "2026-11-01T00:00:00.000Z");
    const user = userEvent.setup();
    render(<GratitudeSettings />);
    const box = screen.getByLabelText("Crear entradas automáticamente");
    expect(box).toBeChecked(); // ticked by default
    await user.click(box); // off…
    expect(getGratitudeSettings().enabled).toBe(false);
    await user.click(box); // …and on again
    expect(getGratitudeSettings().enabled).toBe(true);
    await waitFor(async () => expect((await db.getAll("Activity")).filter((a) => a.activityType === "GRATITUDE")).toHaveLength(1));
    expect((await db.getAll("Activity"))[0]!.rawInput).toMatch(/^Gratitud — .+ !gratitud #personal$/);

    const cron = screen.getByLabelText("Horario (expresión cron)");
    await user.clear(cron);
    await user.type(cron, "0 7 * * *");
    expect(getGratitudeSettings().cron).toBe("0 7 * * *");
    expect(screen.getByText(/^Próxima entrada:/)).toBeInTheDocument();
    await user.type(cron, " x");
    expect(screen.getByText("La expresión cron no es válida.")).toBeInTheDocument();
    expect(getGratitudeSettings().cron).toBe("0 7 * * *");
  });
});

describe("Journal", () => {
  it("shows completed entries newest first, counts the pending ones, and edits notes in the panel", async () => {
    await db.putLocal("Activity", gratitude("1", "2026-11-10T21:00:00.000Z", "COMPLETED", "la lluvia"));
    await db.putLocal("Activity", gratitude("2", "2026-11-12T21:00:00.000Z", "COMPLETED", "una llamada"));
    await db.putLocal("Activity", gratitude("3", "2026-11-14T21:00:00.000Z", "ACTIVE"));
    const user = userEvent.setup();
    render(<Journal />);
    const entries = await screen.findAllByTestId("journal-entry");
    expect(entries.map((e) => within(e).getByRole("heading").textContent)).toEqual(["entrada 2", "entrada 1"]);
    expect(screen.getByText("Tienes 1 entrada pendiente en la página.")).toBeInTheDocument();
    expect(within(entries[1]!).getByText("la lluvia")).toBeInTheDocument();

    await user.click(within(entries[0]!).getByRole("button", { name: "Editar" }));
    const notes = within(screen.getByTestId("line-panel")).getByLabelText("Notas de gratitud");
    await waitFor(() => expect(notes).toHaveFocus());
    expect(notes).toHaveValue("una llamada");
  });

  it("says so when there is nothing yet", async () => {
    render(<Journal />);
    expect(await screen.findByText(/Aún no hay entradas completadas/)).toBeInTheDocument();
  });
});
