import { describe, expect, it } from "vitest";
import { swipeIntent, swipeStage, swipeStops } from "@/services/editor/swipe";

describe("swipe right to hide", () => {
  it("two stops: about a third of the line hides until tomorrow, about two thirds lets you choose", () => {
    expect(swipeStops(400)).toEqual({ quick: 120, pick: 248 });
    expect(swipeStage(0, 400)).toBe("none");
    expect(swipeStage(119, 400)).toBe("none");
    expect(swipeStage(120, 400)).toBe("quick");
    expect(swipeStage(247, 400)).toBe("quick");
    expect(swipeStage(248, 400)).toBe("pick");
  });

  it("narrow lines still need a real movement", () => {
    expect(swipeStops(100)).toEqual({ quick: 64, pick: 160 });
  });

  it("only a clearly sideways move to the right is a swipe; vertical is a scroll; left is unused", () => {
    expect(swipeIntent(5, 2)).toBe("undecided");
    expect(swipeIntent(30, 5)).toBe("swipe");
    expect(swipeIntent(20, 18)).toBe("scroll");
    expect(swipeIntent(3, 25)).toBe("scroll");
    expect(swipeIntent(-30, 2)).toBe("scroll");
  });
});
