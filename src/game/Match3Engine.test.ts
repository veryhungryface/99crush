import { describe, expect, it } from "vitest";
import { Match3Engine } from "./Match3Engine";

describe("Match3Engine", () => {
  it("starts without accidental matches and has a legal move", () => {
    const engine = new Match3Engine(8, 8, 123);
    expect(engine.findMatches()).toHaveLength(0);
    expect(engine.hasAvailableMove()).toBe(true);
  });

  it("detects horizontal and vertical match groups", () => {
    const engine = Match3Engine.fromKinds([
      ["blue", "blue", "blue", "green"],
      ["red", "yellow", "pink", "green"],
      ["silver", "yellow", "red", "green"],
      ["pink", "silver", "yellow", "red"]
    ]);

    const matches = engine.findMatches();
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.orientation).sort()).toEqual(["horizontal", "vertical"]);
  });

  it("turns a four-match into a special while clearing the other tiles", () => {
    const engine = Match3Engine.fromKinds([
      ["blue", "blue", "blue", "blue"],
      ["red", "yellow", "pink", "green"],
      ["silver", "yellow", "red", "green"],
      ["pink", "silver", "yellow", "red"]
    ]);

    const result = engine.clearMatches(engine.findMatches(), [{ row: 0, col: 2 }]);
    expect(result.created?.tile.special).toBe("rocketV");
    expect(result.cleared).toHaveLength(3);
    expect(engine.getTile({ row: 0, col: 2 })?.special).toBe("rocketV");
  });

  it("clears a 3x3 area with the bomb booster", () => {
    const engine = Match3Engine.fromKinds([
      ["blue", "green", "yellow", "red"],
      ["red", "yellow", "pink", "green"],
      ["silver", "yellow", "red", "green"],
      ["pink", "silver", "yellow", "red"]
    ]);

    const result = engine.clearBooster("bomb", { row: 1, col: 1 });
    expect(result?.cleared).toHaveLength(9);
    expect(engine.getTile({ row: 1, col: 1 })).toBeNull();
  });

  it("clears every tile of the selected kind with the rainbow booster", () => {
    const engine = Match3Engine.fromKinds([
      ["blue", "green", "blue", "red"],
      ["red", "yellow", "pink", "green"],
      ["silver", "yellow", "blue", "green"],
      ["pink", "silver", "yellow", "red"]
    ]);

    const result = engine.clearBooster("rainbow", { row: 0, col: 0 });
    expect(result?.cleared.map((cleared) => cleared.tile.kind)).toEqual(["blue", "blue", "blue"]);
    expect(engine.getTile({ row: 0, col: 0 })).toBeNull();
    expect(engine.getTile({ row: 0, col: 2 })).toBeNull();
    expect(engine.getTile({ row: 2, col: 2 })).toBeNull();
  });
});
