import { describe, expect, it } from "vitest";
import { getWinningPlayerIds } from "./winner";

describe("getWinningPlayerIds", () => {
  it("selects the player with the highest score", () => {
    const winners = getWinningPlayerIds([
      { playerId: "p1", score: 22515 },
      { playerId: "p2", score: 0 }
    ]);

    expect([...winners]).toEqual(["p1"]);
  });

  it("keeps all tied high-score players", () => {
    const winners = getWinningPlayerIds([
      { playerId: "p1", score: 1200 },
      { playerId: "p2", score: 900 },
      { playerId: "p3", score: 1200 }
    ]);

    expect([...winners]).toEqual(["p1", "p3"]);
  });
});
