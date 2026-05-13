export const TILE_KINDS = ["blue", "pink", "yellow", "green", "silver", "red"] as const;

export type TileKind = (typeof TILE_KINDS)[number];
export type SpecialKind = "rocketH" | "rocketV" | "bomb" | "rainbow";
export type BoosterKind = "bomb" | "rocket" | "rainbow" | "shuffle";
export type TargetedBoosterKind = Exclude<BoosterKind, "shuffle">;

export interface Tile {
  id: number;
  kind: TileKind;
  special: SpecialKind | null;
}

export interface Position {
  row: number;
  col: number;
}

export interface MatchGroup {
  kind: TileKind;
  orientation: "horizontal" | "vertical";
  positions: Position[];
}

export interface ClearedTile {
  tile: Tile;
  position: Position;
}

export interface CreatedSpecial {
  position: Position;
  tile: Tile;
}

export interface ClearResult {
  groups: MatchGroup[];
  cleared: ClearedTile[];
  created: CreatedSpecial | null;
  score: number;
}

export interface TileMove {
  tile: Tile;
  from: Position;
  to: Position;
}

export interface CollapseResult {
  moves: TileMove[];
  refills: TileMove[];
}
