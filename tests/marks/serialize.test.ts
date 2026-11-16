import { describe, expect, it } from "vitest";
import {
  addFlagMark,
  commitLine,
  flagMarkText,
  parseLine,
  removeFlagMark,
  setDateMark,
  setFrequencyMark,
  setTypeMark,
} from "@/services/marks";
import { CTX, FLAGS, day } from "./fixtures";

const flag = (id: string) => FLAGS.find((f) => f.id === id)!;

describe("commitLine", () => {
  it("rewrites relative and day/month dates to ISO, keeping punctuation and other text", () => {
    expect(commitLine("informe @viernes, #ingresos", CTX)).toBe("informe @2026-11-20, #ingresos");
    expect(commitLine("@hoy y @31/12", CTX)).toBe("@2026-11-14 y @2026-12-31");
  });

  it("leaves canonical, invalid and unknown @text alone", () => {
    const raw = "x @2026-12-01 @2026-02-30 @pronto ana@x.com";
    expect(commitLine(raw, CTX)).toBe(raw);
  });

  it("also rewrites a date that is not applicable to the type (meaning stays stable)", () => {
    expect(commitLine("leer !hábito @mañana", CTX)).toBe("leer !hábito @2026-11-15");
  });

  it("is idempotent and keeps the parsed date", () => {
    const once = commitLine("x @lunes", CTX);
    expect(commitLine(once, CTX)).toBe(once);
    expect(parseLine(once, CTX).date?.iso).toBe(parseLine("x @lunes", CTX).date?.iso);
  });
});

describe("setTypeMark", () => {
  it("writes the keyword of the UI locale", () => {
    expect(setTypeMark("meditar", "HABIT", CTX, "es")).toBe("meditar !hábito");
    expect(setTypeMark("meditar", "HABIT", CTX, "en")).toBe("meditar !habit");
  });

  it("replaces existing type marks, wherever they are", () => {
    expect(setTypeMark("!habit meditar !skill #salud", "ATTITUDE", CTX, "es")).toBe("meditar #salud !actitud");
  });

  it("writes no mark when the type is already the default", () => {
    expect(setTypeMark("comprar pan !hábito", "ACTION", CTX, "es")).toBe("comprar pan");
    expect(setTypeMark("regar ~semanal !hábito", "REPETITIVE_ACTION", CTX, "es")).toBe("regar ~semanal");
  });

  it("writes ACTION explicitly when a ~frequency would imply REPETITIVE_ACTION", () => {
    const out = setTypeMark("regar ~semanal", "ACTION", CTX, "es");
    expect(out).toBe("regar ~semanal !acción");
    expect(parseLine(out, CTX).activityType).toBe("ACTION");
  });

  it("leaves unknown !words alone", () => {
    expect(setTypeMark("x !urgente", "SKILL", CTX, "en")).toBe("x !urgente !skill");
  });
});

describe("setFrequencyMark", () => {
  it("adds, replaces and removes", () => {
    expect(setFrequencyMark("leer !hábito", "DAILY", CTX, "es")).toBe("leer !hábito ~diario");
    expect(setFrequencyMark("leer ~diario !hábito", "MONTHLY", CTX, "en")).toBe("leer !hábito ~monthly");
    expect(setFrequencyMark("leer ~diario !hábito", null, CTX, "es")).toBe("leer !hábito");
    expect(setFrequencyMark("leer ~diario !hábito", "CUSTOM", CTX, "es")).toBe("leer !hábito");
  });
});

describe("setDateMark", () => {
  it("adds a canonical date", () => {
    expect(setDateMark("informe", day(2026, 12, 3), CTX)).toBe("informe @2026-12-03");
  });

  it("replaces the winning date in place and drops the others", () => {
    expect(setDateMark("x @hoy informe @lunes #salud", day(2027, 1, 2), CTX)).toBe("x informe @2027-01-02 #salud");
  });

  it("removes every date mark with null", () => {
    expect(setDateMark("x @hoy y @mañana.", null, CTX)).toBe("x y.");
  });

  it("round-trips through the parser", () => {
    const out = setDateMark("pasaporte !vence", day(2027, 3, 1), CTX);
    expect(parseLine(out, CTX).date).toEqual({ field: "expirationDate", iso: day(2027, 3, 1) });
  });
});

describe("flag marks", () => {
  it("flagMarkText: localized system word, leaf when unique, path when ambiguous", () => {
    expect(flagMarkText(flag("health"), FLAGS, "es")).toBe("#salud");
    expect(flagMarkText(flag("health"), FLAGS, "en")).toBe("#health");
    expect(flagMarkText(flag("fun"), FLAGS, "es")).toBe("#diversión");
    expect(flagMarkText(flag("salary"), FLAGS, "es")).toBe("#salario");
    expect(flagMarkText(flag("project"), FLAGS, "es")).toBe("#ingresos/proyecto");
    expect(flagMarkText(flag("famproj"), FLAGS, "es")).toBe("#familia/Proyecto");
    expect(flagMarkText(flag("mine"), FLAGS, "es")).toBe("#Mi-proyecto");
  });

  it("every written flag mark resolves back to its flag", () => {
    for (const f of FLAGS) {
      for (const locale of ["es", "en"] as const) {
        const raw = addFlagMark("x", f, CTX, locale);
        expect(parseLine(raw, CTX).flagIds).toEqual([f.id]);
      }
    }
  });

  it("addFlagMark does nothing when the flag is already there", () => {
    expect(addFlagMark("x #health", flag("health"), CTX, "es")).toBe("x #health");
  });

  it("removeFlagMark removes every mark of that flag only", () => {
    expect(removeFlagMark("#salud correr #health #familia", "health", CTX)).toBe("correr #familia");
  });
});
