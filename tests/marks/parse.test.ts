import { describe, expect, it } from "vitest";
import { parseLine, scanMarks } from "@/services/marks";
import { CTX, FLAGS, day } from "./fixtures";

const parse = (raw: string) => parseLine(raw, CTX);
const statuses = (raw: string) => parse(raw).marks.map((m) => `${m.kind}:${m.body}:${m.status}`);

describe("docs/05-line-mapping.md §2.5 examples", () => {
  it("comprar pan", () => {
    expect(parse("comprar pan")).toMatchObject({
      title: "comprar pan",
      activityType: "ACTION",
      typeFromMark: false,
      flagIds: [],
      frequency: null,
      date: null,
    });
  });

  it("comprar pan #recados", () => {
    expect(parse("comprar pan #recados")).toMatchObject({ title: "comprar pan", flagIds: ["errand"] });
  });

  it("meditar 10 min !hábito ~diario #espiritual", () => {
    expect(parse("meditar 10 min !hábito ~diario #espiritual")).toMatchObject({
      title: "meditar 10 min",
      activityType: "HABIT",
      typeFromMark: true,
      flagIds: ["spiritual"],
      frequency: "DAILY",
    });
  });

  it("regar plantas ~semanal #personal → REPETITIVE_ACTION by default", () => {
    expect(parse("regar plantas ~semanal #personal")).toMatchObject({
      title: "regar plantas",
      activityType: "REPETITIVE_ACTION",
      typeFromMark: false,
      flagIds: ["personal"],
      frequency: "WEEKLY",
    });
  });

  it("pasaporte !vence @2027-03-01 #personal", () => {
    expect(parse("pasaporte !vence @2027-03-01 #personal")).toMatchObject({
      title: "pasaporte",
      activityType: "EXPIRATION",
      flagIds: ["personal"],
      date: { field: "expirationDate", iso: day(2027, 3, 1) },
    });
  });

  it("informe @viernes #ingresos/proyecto", () => {
    // today is Saturday 14 Nov 2026 → next Friday is 20 Nov
    expect(parse("informe @viernes #ingresos/proyecto")).toMatchObject({
      title: "informe",
      activityType: "ACTION",
      flagIds: ["project"],
      date: { field: "deadline", iso: day(2026, 11, 20) },
    });
  });

  it("revisar #xyz keeps the unknown mark in the title", () => {
    const p = parse("revisar #xyz");
    expect(p.title).toBe("revisar #xyz");
    expect(p.flagIds).toEqual([]);
    expect(statuses("revisar #xyz")).toEqual(["flag:xyz:unknown"]);
  });
});

describe("tokenizer", () => {
  it("a sigil inside a word is plain text", () => {
    expect(scanMarks("correo@x.com a#b hola!").tokens).toEqual([]);
    expect(parse("escribir a ana@x.com").title).toBe("escribir a ana@x.com");
  });

  it("a lone sigil is not a mark", () => {
    expect(scanMarks("precio # 3 ! @").tokens).toEqual([]);
  });

  it("marks start at the line start or after any whitespace", () => {
    expect(scanMarks("#salud\tcorrer").tokens.map((t) => t.body)).toEqual(["salud"]);
    expect(scanMarks("a\t#salud").tokens.map((t) => t.body)).toEqual(["salud"]);
  });

  it("trailing punctuation is not part of the mark and stays in the title", () => {
    const p = parse("ir al médico @lunes. luego #salud, sin falta");
    expect(p.marks.map((m) => m.body)).toEqual(["lunes", "salud"]);
    expect(p.title).toBe("ir al médico. luego, sin falta");
    expect(p.flagIds).toEqual(["health"]);
  });

  it("escaped sigils are literal text and the backslash is hidden", () => {
    const p = parse("canal \\#general y \\!importante #salud");
    expect(p.title).toBe("canal #general y !importante");
    expect(p.flagIds).toEqual(["health"]);
    expect(p.marks).toHaveLength(1);
  });

  it("mark spans point at the sigil and end before punctuation", () => {
    const raw = "x #salud.";
    const [m] = parse(raw).marks;
    expect(raw.slice(m!.start, m!.end)).toBe("#salud");
  });
});

describe("matching", () => {
  it("is case- and accent-insensitive, in both languages", () => {
    for (const raw of ["a !Hábito", "a !habito", "a !HABITO", "a !habit"]) {
      expect(parse(raw).activityType).toBe("HABIT");
    }
    for (const raw of ["a #Salud", "a #SALUD", "a #health", "a #Health"]) {
      expect(parse(raw).flagIds).toEqual(["health"]);
    }
    expect(parse("a #diversión").flagIds).toEqual(["fun"]);
    expect(parse("a #Diversion").flagIds).toEqual(["fun"]);
  });

  it("every type keyword resolves", () => {
    const cases: [string, string][] = [
      ["accion", "ACTION"], ["tarea", "ACTION"], ["task", "ACTION"],
      ["repetitiva", "REPETITIVE_ACTION"], ["repeat", "REPETITIVE_ACTION"],
      ["actitud", "ATTITUDE"], ["skill", "SKILL"], ["habilidad", "SKILL"],
      ["momento", "MOMENTO"], ["moment", "MOMENTO"], ["gratitud", "GRATITUDE"],
      ["vencimiento", "EXPIRATION"], ["expires", "EXPIRATION"],
    ];
    for (const [word, type] of cases) expect(parse(`x !${word}`).activityType).toBe(type);
  });

  it("unknown type and frequency keywords stay in the title", () => {
    const p = parse("x !urgente ~a-veces");
    expect(p.title).toBe("x !urgente ~a-veces");
    expect(p.activityType).toBe("ACTION");
    expect(statuses("x !urgente ~a-veces")).toEqual(["type:urgente:unknown", "frequency:a-veces:unknown"]);
  });
});

describe("single-value marks: the last one wins", () => {
  it("two types → the last one, the first is a duplicate (still removed from the title)", () => {
    const p = parse("x !habit y !skill");
    expect(p.activityType).toBe("SKILL");
    expect(p.title).toBe("x y");
    expect(statuses("x !habit y !skill")).toEqual(["type:habit:duplicate", "type:skill:ok"]);
  });

  it("two dates and two frequencies", () => {
    const p = parse("x @2026-12-01 @2026-12-24 ~diario ~semanal");
    expect(p.date?.iso).toBe(day(2026, 12, 24));
    expect(p.frequency).toBe("WEEKLY");
  });

  it("an explicit type beats the ~frequency default", () => {
    expect(parse("x ~diario !hábito").activityType).toBe("HABIT");
  });
});

describe("applicability by type", () => {
  it("@date on a habit is not applicable", () => {
    const p = parse("leer !hábito @mañana");
    expect(p.date).toBeNull();
    expect(p.title).toBe("leer");
    expect(statuses("leer !hábito @mañana")).toEqual(["type:hábito:ok", "date:mañana:notApplicable"]);
  });

  it("@date fills deadline / eventDate / expirationDate by type", () => {
    expect(parse("x @hoy").date).toEqual({ field: "deadline", iso: day(2026, 11, 14) });
    expect(parse("x !momento @hoy").date?.field).toBe("eventDate");
    expect(parse("x !vence @hoy").date?.field).toBe("expirationDate");
    expect(parse("x !repetir @hoy").date?.field).toBe("deadline");
  });

  it("~frequency on a non-recurring type is not applicable", () => {
    const p = parse("x !accion ~diario");
    expect(p.frequency).toBeNull();
    expect(p.activityType).toBe("ACTION");
    expect(statuses("x !accion ~diario")[1]).toBe("frequency:diario:notApplicable");
  });
});

describe("flags", () => {
  it("several flags, each once", () => {
    expect(parse("x #salud #familia #health").flagIds).toEqual(["health", "family"]);
  });

  it("child flags by path, or by leaf when unique", () => {
    expect(parse("x #ingresos/salario").flagIds).toEqual(["salary"]);
    expect(parse("x #income/salary").flagIds).toEqual(["salary"]);
    expect(parse("x #salario").flagIds).toEqual(["salary"]);
    expect(parse("x #ingresos/renta").flagIds).toEqual(["rent"]);
  });

  it("a leaf shared by two flags is ambiguous until the path is used", () => {
    expect(statuses("x #proyecto")).toEqual(["flag:proyecto:ambiguous"]);
    expect(parse("x #proyecto").title).toBe("x #proyecto");
    expect(parse("x #familia/proyecto").flagIds).toEqual(["famproj"]);
    expect(parse("x #ingresos/proyecto").flagIds).toEqual(["project"]);
  });

  it("flag names with spaces are written with dashes", () => {
    expect(parse("x #mi-proyecto").flagIds).toEqual(["mine"]);
    expect(parse("x #Mi-Proyecto").flagIds).toEqual(["mine"]);
  });

  it("a wrong path is unknown", () => {
    expect(statuses("x #salud/salario")).toEqual(["flag:salud/salario:unknown"]);
  });

  it("user flags do not get system aliases", () => {
    const flags = [{ id: "u", name: "health" }]; // a user flag literally named "health"
    expect(parseLine("x #salud", { flags, today: CTX.today }).flagIds).toEqual([]);
    expect(parseLine("x #health", { flags, today: CTX.today }).flagIds).toEqual(["u"]);
  });

  it("a flag cycle in corrupt data does not hang", () => {
    const flags = [
      { id: "a", name: "a", parentId: "b" },
      { id: "b", name: "b", parentId: "a" },
    ];
    expect(parseLine("x #a", { flags, today: CTX.today }).flagIds).toEqual(["a"]);
    expect(FLAGS.length).toBeGreaterThan(0);
  });
});

describe("title", () => {
  it("collapses whitespace and trims", () => {
    expect(parse("  #salud   correr   10 km  !hábito ").title).toBe("correr 10 km");
  });

  it("an empty line and a marks-only line have an empty title", () => {
    expect(parse("").title).toBe("");
    expect(parse("#salud !hábito").title).toBe("");
  });
});
