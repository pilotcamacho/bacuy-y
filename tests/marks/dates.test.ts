import { describe, expect, it } from "vitest";
import { canonicalDateBody, dayToIso, isoToDay, parseDateBody } from "@/services/marks";
import { TODAY } from "./fixtures";

// TODAY = Saturday 14 Nov 2026
const d = (body: string, today = TODAY) => {
  const r = parseDateBody(body, today);
  return r ? `${canonicalDateBody(r)}${r.canonical ? "" : "*"}` : undefined;
};

describe("@date bodies", () => {
  it("today / tomorrow in both languages", () => {
    expect(d("hoy")).toBe("2026-11-14*");
    expect(d("today")).toBe("2026-11-14*");
    expect(d("mañana")).toBe("2026-11-15*");
    expect(d("manana")).toBe("2026-11-15*");
    expect(d("Tomorrow")).toBe("2026-11-15*");
  });

  it("weekdays: the next one, today excluded", () => {
    expect(d("sábado")).toBe("2026-11-21*"); // today is Saturday → next week
    expect(d("saturday")).toBe("2026-11-21*");
    expect(d("domingo")).toBe("2026-11-15*");
    expect(d("lunes")).toBe("2026-11-16*");
    expect(d("miércoles")).toBe("2026-11-18*");
    expect(d("friday")).toBe("2026-11-20*");
  });

  it("ISO is canonical; invalid days are rejected", () => {
    expect(d("2027-03-01")).toBe("2027-03-01");
    expect(d("2026-02-30")).toBeUndefined();
    expect(d("2026-13-01")).toBeUndefined();
    expect(d("2028-02-29")).toBe("2028-02-29");
  });

  it("day/month: next occurrence, today included; day/month/year", () => {
    expect(d("14/11")).toBe("2026-11-14*");
    expect(d("13/11")).toBe("2027-11-13*");
    expect(d("31/12")).toBe("2026-12-31*");
    expect(d("1/1")).toBe("2027-01-01*");
    expect(d("29/2")).toBe("2028-02-29*");
    expect(d("31/12/2030")).toBe("2030-12-31*");
    expect(d("31/2/2030")).toBeUndefined();
    expect(d("32/1")).toBeUndefined();
  });

  it("crosses month and year ends", () => {
    const dec31 = new Date(2026, 11, 31); // Thursday
    expect(d("mañana", dec31)).toBe("2027-01-01*");
    expect(d("viernes", dec31)).toBe("2027-01-01*");
  });

  it("anything else is not a date", () => {
    for (const body of ["pronto", "2026", "11/2026", "1-1", "lunes2"]) expect(d(body)).toBeUndefined();
  });

  it("stores the start of the local day and reads it back", () => {
    const iso = dayToIso({ year: 2026, month: 3, day: 29 });
    expect(new Date(iso).getHours()).toBe(0);
    expect(isoToDay(iso)).toEqual({ year: 2026, month: 3, day: 29 });
  });
});
