import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/lib/i18n";
import { Help } from "@/routes/Help";
import { TYPE_KEYWORDS, type ActivityType } from "@/services/marks";

/** The in-app manual: every type explained, in both languages, reachable by #type-<TYPE>. */

const TYPES = Object.keys(TYPE_KEYWORDS) as ActivityType[];

afterEach(() => cleanup());

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Help />
    </MemoryRouter>,
  );

describe("Manual", () => {
  it.each(["es", "en"] as const)("explains every line type: mark, example, panel fields and life cycle (%s)", async (lang) => {
    await i18n.changeLanguage(lang);
    renderAt("/help");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(lang === "es" ? "Manual" : "Guide");
    for (const type of TYPES) {
      const card = within(screen.getByTestId(`help-type-${type}`));
      const title = card.getByRole("heading", { level: 3 });
      expect(title).toHaveTextContent(i18n.t(`activityType.${type}`));
      expect(title).toHaveTextContent(`!${TYPE_KEYWORDS[type][lang][0]}`);
      // Its life cycle: starts, day to day, repeats, ends — each with real text.
      const steps = within(card.getByTestId(`help-life-${type}`)).getAllByRole("listitem");
      expect(steps).toHaveLength(4);
      for (const step of steps) expect(step.textContent!.length).toBeGreaterThan(10);
      // No missing translation keys leak through as raw text.
      expect(screen.getByTestId(`help-type-${type}`).textContent).not.toMatch(/\b(help|panel|activityType)\.[a-zA-Z]+\b/);
    }
    expect(screen.getByTestId("help").textContent).not.toMatch(/\bhelp\.[a-z]/);
    expect(within(screen.getByTestId("help-lifecycle")).getAllByRole("listitem")).toHaveLength(8); // …and the day starts at 03:00
    // A few facts that must match the app.
    expect(within(screen.getByTestId("help-type-EXPIRATION")).getByText(i18n.t("panel.expirationDate"))).toBeInTheDocument();
    expect(within(screen.getByTestId("help-type-MOMENTO")).getByText(i18n.t("panel.eventDate"))).toBeInTheDocument();
    expect(within(screen.getByTestId("help-type-HABIT")).getByText(i18n.t("help.types.noDate"))).toBeInTheDocument();
  });

  it("opening /help#type-HABIT scrolls to that type and focuses it", async () => {
    await i18n.changeLanguage("es");
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    }; // not in jsdom
    renderAt("/help#type-HABIT");
    expect(document.activeElement).toBe(screen.getByTestId("help-type-HABIT"));
    expect(scrolled).toEqual([screen.getByTestId("help-type-HABIT")]);
  });
});
