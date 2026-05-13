import {
  type ClearedTile,
  type TargetedBoosterKind,
  type ClearResult,
  type CollapseResult,
  type CreatedSpecial,
  type MatchGroup,
  type Position,
  type SpecialKind,
  type Tile,
  type TileKind,
  TILE_KINDS
} from "./types";

const posKey = (position: Position) => `${position.row}:${position.col}`;

const clonePos = (position: Position): Position => ({
  row: position.row,
  col: position.col
});

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export class Match3Engine {
  readonly width: number;
  readonly height: number;
  board: Array<Array<Tile | null>>;
  private nextId = 1;
  private readonly random: () => number;

  constructor(width = 8, height = 8, seed = Date.now()) {
    this.width = width;
    this.height = height;
    this.random = mulberry32(seed);
    this.board = Array.from({ length: height }, () => Array<Tile | null>(width).fill(null));
    this.fillFreshBoard();
  }

  static fromKinds(matrix: TileKind[][]): Match3Engine {
    const engine = new Match3Engine(matrix[0]?.length ?? 0, matrix.length, 1);
    engine.board = matrix.map((row) =>
      row.map((kind) => ({
        id: engine.nextId++,
        kind,
        special: null
      }))
    );
    return engine;
  }

  inBounds(position: Position): boolean {
    return (
      position.row >= 0 &&
      position.row < this.height &&
      position.col >= 0 &&
      position.col < this.width
    );
  }

  areAdjacent(first: Position, second: Position): boolean {
    return Math.abs(first.row - second.row) + Math.abs(first.col - second.col) === 1;
  }

  getTile(position: Position): Tile | null {
    if (!this.inBounds(position)) return null;
    return this.board[position.row][position.col];
  }

  swap(first: Position, second: Position): void {
    const firstTile = this.getTile(first);
    const secondTile = this.getTile(second);
    this.board[first.row][first.col] = secondTile;
    this.board[second.row][second.col] = firstTile;
  }

  findMatches(): MatchGroup[] {
    const groups: MatchGroup[] = [];

    for (let row = 0; row < this.height; row++) {
      let col = 0;
      while (col < this.width) {
        const tile = this.board[row][col];
        if (!tile) {
          col++;
          continue;
        }

        let end = col + 1;
        while (end < this.width && this.board[row][end]?.kind === tile.kind) end++;
        if (end - col >= 3) {
          groups.push({
            kind: tile.kind,
            orientation: "horizontal",
            positions: Array.from({ length: end - col }, (_, index) => ({ row, col: col + index }))
          });
        }
        col = end;
      }
    }

    for (let col = 0; col < this.width; col++) {
      let row = 0;
      while (row < this.height) {
        const tile = this.board[row][col];
        if (!tile) {
          row++;
          continue;
        }

        let end = row + 1;
        while (end < this.height && this.board[end][col]?.kind === tile.kind) end++;
        if (end - row >= 3) {
          groups.push({
            kind: tile.kind,
            orientation: "vertical",
            positions: Array.from({ length: end - row }, (_, index) => ({ row: row + index, col }))
          });
        }
        row = end;
      }
    }

    return groups;
  }

  hasAvailableMove(): boolean {
    return this.findAvailableSwap() !== null;
  }

  findAvailableSwap(): { first: Position; second: Position } | null {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const current = { row, col };
        for (const next of [
          { row: row + 1, col },
          { row, col: col + 1 }
        ]) {
          if (!this.inBounds(next)) continue;
          this.swap(current, next);
          const hasMatch = this.findMatches().length > 0;
          this.swap(current, next);
          if (hasMatch) return { first: current, second: next };
        }
      }
    }
    return null;
  }

  shuffleUntilPlayable(): void {
    const existing = this.board.flat().filter((tile): tile is Tile => tile !== null);
    for (let attempt = 0; attempt < 80; attempt++) {
      const pool = [...existing].sort(() => this.random() - 0.5);
      this.board = Array.from({ length: this.height }, () => Array<Tile | null>(this.width).fill(null));
      for (let row = 0; row < this.height; row++) {
        for (let col = 0; col < this.width; col++) {
          this.board[row][col] = pool.pop() ?? this.createTile();
        }
      }
      if (this.findMatches().length === 0 && this.hasAvailableMove()) return;
    }
    this.fillFreshBoard();
  }

  clearMatches(matches: MatchGroup[], anchors: Position[] = []): ClearResult {
    const created = this.createSpecialFromMatches(matches, anchors);
    const pendingSpecial = created?.tile.special ?? null;
    if (created) created.tile.special = null;
    const baseClear = new Map<string, Position>();
    for (const group of matches) {
      for (const position of group.positions) {
        baseClear.set(posKey(position), position);
      }
    }

    const expanded = this.expandSpecialClears([...baseClear.values()]);
    if (created) expanded.delete(posKey(created.position));
    if (created) created.tile.special = pendingSpecial;

    const cleared = this.collectAndRemove(expanded);
    if (created) {
      this.board[created.position.row][created.position.col] = created.tile;
    }

    return {
      groups: matches,
      cleared,
      created,
      score: cleared.length * 90 + matches.length * 120 + (created ? 220 : 0)
    };
  }

  clearSwapSpecial(first: Position, second: Position): ClearResult | null {
    const firstTile = this.getTile(first);
    const secondTile = this.getTile(second);
    if (!firstTile?.special && !secondTile?.special) return null;

    const start = new Map<string, Position>();
    if (firstTile?.special === "rainbow" && secondTile) {
      this.addAllOfKind(start, secondTile.kind);
      start.set(posKey(first), clonePos(first));
    } else if (secondTile?.special === "rainbow" && firstTile) {
      this.addAllOfKind(start, firstTile.kind);
      start.set(posKey(second), clonePos(second));
    } else {
      start.set(posKey(first), clonePos(first));
      start.set(posKey(second), clonePos(second));
    }

    const expanded = this.expandSpecialClears([...start.values()]);
    const cleared = this.collectAndRemove(expanded);
    return {
      groups: [],
      cleared,
      created: null,
      score: cleared.length * 120 + 300
    };
  }

  clearBooster(kind: TargetedBoosterKind, target: Position): ClearResult | null {
    if (!this.inBounds(target)) return null;
    const targetTile = this.getTile(target);
    if (!targetTile) return null;

    const start = new Map<string, Position>();
    if (kind === "bomb") {
      for (let row = target.row - 1; row <= target.row + 1; row++) {
        for (let col = target.col - 1; col <= target.col + 1; col++) {
          const position = { row, col };
          if (this.inBounds(position)) start.set(posKey(position), position);
        }
      }
    }

    if (kind === "rocket") {
      for (let col = 0; col < this.width; col++) start.set(posKey({ row: target.row, col }), { row: target.row, col });
      for (let row = 0; row < this.height; row++) start.set(posKey({ row, col: target.col }), { row, col: target.col });
    }

    if (kind === "rainbow") {
      this.addAllOfKind(start, targetTile.kind);
    }

    const expanded = this.expandSpecialClears([...start.values()]);
    const cleared = this.collectAndRemove(expanded);
    if (cleared.length === 0) return null;

    const bonus = kind === "rainbow" ? 420 : kind === "rocket" ? 320 : 260;
    return {
      groups: [],
      cleared,
      created: null,
      score: cleared.length * 105 + bonus
    };
  }

  collapseAndRefill(): CollapseResult {
    const moves: CollapseResult["moves"] = [];
    const refills: CollapseResult["refills"] = [];

    for (let col = 0; col < this.width; col++) {
      let writeRow = this.height - 1;
      for (let row = this.height - 1; row >= 0; row--) {
        const tile = this.board[row][col];
        if (!tile) continue;
        if (writeRow !== row) {
          this.board[writeRow][col] = tile;
          this.board[row][col] = null;
          moves.push({
            tile,
            from: { row, col },
            to: { row: writeRow, col }
          });
        }
        writeRow--;
      }

      let spawnOffset = 1;
      for (let row = writeRow; row >= 0; row--) {
        const tile = this.createTile();
        this.board[row][col] = tile;
        refills.push({
          tile,
          from: { row: -spawnOffset, col },
          to: { row, col }
        });
        spawnOffset++;
      }
    }

    return { moves, refills };
  }

  private fillFreshBoard(): void {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const disallowed = new Set<TileKind>();
        const leftA = this.board[row][col - 1];
        const leftB = this.board[row][col - 2];
        const upA = this.board[row - 1]?.[col];
        const upB = this.board[row - 2]?.[col];
        if (leftA && leftB && leftA.kind === leftB.kind) disallowed.add(leftA.kind);
        if (upA && upB && upA.kind === upB.kind) disallowed.add(upA.kind);
        this.board[row][col] = this.createTile(disallowed);
      }
    }

    if (!this.hasAvailableMove()) {
      this.shuffleUntilPlayable();
    }
  }

  private createTile(disallowed = new Set<TileKind>()): Tile {
    const candidates = TILE_KINDS.filter((kind) => !disallowed.has(kind));
    const kind = candidates[Math.floor(this.random() * candidates.length)] ?? TILE_KINDS[0];
    return {
      id: this.nextId++,
      kind,
      special: null
    };
  }

  private createSpecialFromMatches(matches: MatchGroup[], anchors: Position[]): CreatedSpecial | null {
    const positionToOrientations = new Map<string, Set<MatchGroup["orientation"]>>();
    const positionToGroups = new Map<string, MatchGroup[]>();

    for (const group of matches) {
      for (const position of group.positions) {
        const key = posKey(position);
        if (!positionToOrientations.has(key)) positionToOrientations.set(key, new Set());
        if (!positionToGroups.has(key)) positionToGroups.set(key, []);
        positionToOrientations.get(key)?.add(group.orientation);
        positionToGroups.get(key)?.push(group);
      }
    }

    const allPositions = [...positionToGroups.keys()].map((key) => {
      const [row, col] = key.split(":").map(Number);
      return { row, col };
    });

    const anchor = anchors.find((candidate) => positionToGroups.has(posKey(candidate)));
    const longest = [...matches].sort((a, b) => b.positions.length - a.positions.length)[0];
    if (!longest || longest.positions.length < 4) {
      const corner = allPositions.find((position) => positionToOrientations.get(posKey(position))?.size === 2);
      if (!corner) return null;
      const tile = this.getTile(corner);
      if (!tile) return null;
      tile.special = "bomb";
      return { position: corner, tile };
    }

    const specialPosition =
      anchor ??
      longest.positions[Math.floor(longest.positions.length / 2)] ??
      longest.positions[0];
    const specialTile = this.getTile(specialPosition);
    if (!specialTile) return null;

    const intersection = allPositions.find(
      (position) => positionToOrientations.get(posKey(position))?.size === 2
    );
    let special: SpecialKind;
    if (longest.positions.length >= 5) {
      special = "rainbow";
    } else if (intersection) {
      special = "bomb";
    } else {
      special = longest.orientation === "horizontal" ? "rocketV" : "rocketH";
    }

    specialTile.special = special;
    return {
      position: specialPosition,
      tile: specialTile
    };
  }

  private expandSpecialClears(seedPositions: Position[]): Map<string, Position> {
    const expanded = new Map<string, Position>();
    const queue = [...seedPositions];

    while (queue.length > 0) {
      const position = queue.shift();
      if (!position || !this.inBounds(position)) continue;
      const key = posKey(position);
      if (expanded.has(key)) continue;
      expanded.set(key, clonePos(position));

      const tile = this.getTile(position);
      if (!tile?.special) continue;

      if (tile.special === "rocketH") {
        for (let col = 0; col < this.width; col++) queue.push({ row: position.row, col });
      }
      if (tile.special === "rocketV") {
        for (let row = 0; row < this.height; row++) queue.push({ row, col: position.col });
      }
      if (tile.special === "bomb") {
        for (let row = position.row - 1; row <= position.row + 1; row++) {
          for (let col = position.col - 1; col <= position.col + 1; col++) {
            queue.push({ row, col });
          }
        }
      }
      if (tile.special === "rainbow") {
        this.addAllOfKind(expanded, tile.kind);
      }
    }

    return expanded;
  }

  private collectAndRemove(positions: Map<string, Position>): ClearedTile[] {
    const cleared: ClearedTile[] = [];
    for (const position of positions.values()) {
      const tile = this.getTile(position);
      if (!tile) continue;
      cleared.push({ tile, position: clonePos(position) });
      this.board[position.row][position.col] = null;
    }
    return cleared;
  }

  private addAllOfKind(target: Map<string, Position>, kind: TileKind): void {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const tile = this.board[row][col];
        if (tile?.kind === kind) {
          target.set(posKey({ row, col }), { row, col });
        }
      }
    }
  }
}
