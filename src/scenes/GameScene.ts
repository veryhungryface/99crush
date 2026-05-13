import Phaser from "phaser";
import { playBurst, playPop, unlockAudio } from "../game/audio";
import { Match3Engine } from "../game/Match3Engine";
import { createMultiplicationQuestion } from "../game/mathQuiz";
import {
  type ClearResult,
  type CollapseResult,
  type BoosterKind,
  type Position,
  type SpecialKind,
  type TargetedBoosterKind,
  type Tile
} from "../game/types";
import { loadGeneratedAssets, specialTextureKey, textureKey, type TileFrame } from "./assets";

interface TileView {
  container: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Image;
  special: Phaser.GameObjects.Image | null;
  tile: Tile;
  blinkTimer: Phaser.Time.TimerEvent | null;
}

type PointerStart = {
  position: Position;
  x: number;
  y: number;
};

type BoosterSelectDetail = {
  playerId: string;
  kind: BoosterKind;
};

type ResetDetail = {
  playerId?: string;
  roundEndsAtMs?: number;
};

const BOARD_SIZE = 8;
const STARTING_TIME = 90;
export const ROUND_DURATION_MS = STARTING_TIME * 1000;

export type GameLayoutMode = "portrait" | "wide" | "mobile";

export const GAME_SCENE_LAYOUTS = {
  portrait: {
    width: 700,
    height: 860,
    cell: 78,
    boardY: 124,
    boardFrameSize: 690,
    titleY: 92,
    titleSize: "30px"
  },
  mobile: {
    width: 430,
    height: 900,
    cell: 45,
    boardY: 136,
    boardFrameSize: 412,
    titleY: 98,
    titleSize: "21px"
  },
  wide: {
    width: 1280,
    height: 720,
    cell: 64,
    boardY: 112,
    boardFrameSize: 590,
    titleY: 74,
    titleSize: "30px"
  }
} as const;

const easeOutBack = "Back.easeOut";
const sleep = (scene: Phaser.Scene, ms: number) =>
  new Promise<void>((resolve) => scene.time.delayedCall(ms, resolve));

export class GameScene extends Phaser.Scene {
  private readonly playerId: string;
  private readonly boardSeed: number;
  private readonly layout: (typeof GAME_SCENE_LAYOUTS)[GameLayoutMode];
  private engine!: Match3Engine;
  private views = new Map<number, TileView>();
  private tileLayer!: Phaser.GameObjects.Layer;
  private fxLayer!: Phaser.GameObjects.Layer;
  private inputZone!: Phaser.GameObjects.Zone;
  private selection: Position | null = null;
  private selectionRing!: Phaser.GameObjects.Graphics;
  private pointerStarts = new Map<number, PointerStart>();
  private busy = false;
  private score = 0;
  private moves = 30;
  private timeLeft = STARTING_TIME;
  private lastCombo = 0;
  private timerEvent: Phaser.Time.TimerEvent | null = null;
  private quizSerial = 1;
  private quizOpen = false;
  private finishActiveQuiz: ((correct: boolean) => void) | null = null;
  private resetToken = 0;
  private roundEndsAtMs: number;
  private gameOverDispatched = false;
  private selectedBooster: TargetedBoosterKind | null = null;
  private domEventsBound = false;

  constructor(
    playerId = "p1",
    boardSeed = 20260512,
    layoutMode: GameLayoutMode = "portrait",
    roundEndsAtMs = performance.now() + ROUND_DURATION_MS
  ) {
    super(`GameScene:${playerId}:${layoutMode}`);
    this.playerId = playerId;
    this.boardSeed = boardSeed;
    this.layout = GAME_SCENE_LAYOUTS[layoutMode];
    this.roundEndsAtMs = roundEndsAtMs;
  }

  preload() {
    loadGeneratedAssets(this);
  }

  create() {
    this.drawBackground();
    this.drawBoardFrame();

    this.tileLayer = this.add.layer();
    this.fxLayer = this.add.layer();
    this.selectionRing = this.add.graphics().setDepth(20);
    this.fxLayer.add(this.selectionRing);
    this.inputZone = this.add
      .zone(
        this.boardX + (BOARD_SIZE * this.layout.cell) / 2,
        this.layout.boardY + (BOARD_SIZE * this.layout.cell) / 2,
        BOARD_SIZE * this.layout.cell,
        BOARD_SIZE * this.layout.cell
      )
      .setInteractive({ useHandCursor: true });

    this.inputZone.on("pointerdown", this.handlePointerDown);
    this.input.on("pointerup", this.handlePointerUp);
    this.input.on("pointerupoutside", this.handlePointerCancel);
    window.addEventListener("game:reset", this.resetFromDom);
    window.addEventListener("booster:select", this.handleBoosterSelect);
    window.addEventListener("booster:cancel", this.handleBoosterCancel);
    window.addEventListener("game:teardown", this.teardownFromDom);
    this.domEventsBound = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardownDomEvents);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.teardownDomEvents);

    this.resetGame();
  }

  private resetFromDom = (event: Event) => {
    if (!this.canHandleDomEvent()) return;
    const detail = (event as CustomEvent<ResetDetail>).detail;
    if (detail?.playerId && detail.playerId !== this.playerId) return;
    this.roundEndsAtMs = detail?.roundEndsAtMs ?? performance.now() + ROUND_DURATION_MS;
    this.resetGame();
  };

  private handleBoosterSelect = (event: Event) => {
    if (!this.canHandleDomEvent()) return;
    const detail = (event as CustomEvent<BoosterSelectDetail>).detail;
    if (!detail || detail.playerId !== this.playerId) return;

    unlockAudio();
    if (this.busy || this.quizOpen || this.timeLeft <= 0 || this.gameOverDispatched) {
      this.dispatchBoosterUsed(detail.kind, false);
      return;
    }

    if (detail.kind === "shuffle") {
      void this.useShuffleBooster();
      return;
    }

    this.selectedBooster = detail.kind;
    this.setSelection(null);
    this.showToast("블록 선택!");
  };

  private handleBoosterCancel = (event: Event) => {
    if (!this.canHandleDomEvent()) return;
    const detail = (event as CustomEvent<{ playerId?: string }>).detail;
    if (detail?.playerId && detail.playerId !== this.playerId) return;
    this.selectedBooster = null;
    this.setSelection(null);
  };

  private teardownFromDom = () => {
    this.teardownDomEvents();
  };

  private teardownDomEvents = () => {
    if (!this.domEventsBound) return;
    this.domEventsBound = false;
    window.removeEventListener("game:reset", this.resetFromDom);
    window.removeEventListener("booster:select", this.handleBoosterSelect);
    window.removeEventListener("booster:cancel", this.handleBoosterCancel);
    window.removeEventListener("game:teardown", this.teardownFromDom);
    this.inputZone?.off("pointerdown", this.handlePointerDown);
    this.input?.off("pointerup", this.handlePointerUp);
    this.input?.off("pointerupoutside", this.handlePointerCancel);
    this.pointerStarts.clear();
    this.timerEvent?.remove(false);
    this.cancelActiveQuiz();
  };

  private canHandleDomEvent() {
    try {
      return this.domEventsBound && this.scene.isActive();
    } catch {
      return false;
    }
  }

  private resetGame() {
    this.resetToken++;
    this.cancelActiveQuiz();
    this.pointerStarts.clear();
    this.gameOverDispatched = false;
    this.busy = false;
    this.setSelection(null);
    this.selectedBooster = null;
    this.score = 0;
    this.moves = 30;
    this.timeLeft = this.computeTimeLeft();
    this.lastCombo = 0;
    this.timerEvent?.remove(false);
    this.views.forEach((view) => this.destroyTileView(view));
    this.views.clear();
    this.engine = new Match3Engine(BOARD_SIZE, BOARD_SIZE, this.boardSeed);
    this.renderInitialBoard();
    this.startRoundTimer();
    this.updateHud();
    this.time.delayedCall(1100, () => this.pulseSuggestedMove());
  }

  private startRoundTimer() {
    this.tickRoundTimer();
    this.timerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.tickRoundTimer()
    });
  }

  private computeTimeLeft() {
    return Math.max(0, Math.ceil((this.roundEndsAtMs - performance.now()) / 1000));
  }

  private tickRoundTimer() {
    if (this.gameOverDispatched) return;
    const nextTimeLeft = this.computeTimeLeft();
    if (nextTimeLeft !== this.timeLeft) {
      this.timeLeft = nextTimeLeft;
      this.updateHud();
    }
    if (this.timeLeft <= 0) this.finishRound();
  }

  private finishRound() {
    if (this.gameOverDispatched) return;
    this.gameOverDispatched = true;
    this.timeLeft = 0;
    this.cancelActiveQuiz();
    this.pointerStarts.clear();
    this.selectedBooster = null;
    this.busy = true;
    this.setSelection(null);
    this.timerEvent?.remove(false);
    this.timerEvent = null;
    this.updateHud();
    this.dispatchGameOver();
    this.showToast("TIME UP!");
  }

  private dispatchGameOver() {
    window.dispatchEvent(
      new CustomEvent("game:over", {
        detail: {
          playerId: this.playerId,
          score: this.score
        }
      })
    );
  }

  private drawBackground() {
    const { width, height } = this.layout;
    const backgroundKey = width > height ? "ui:background-wide" : "ui:background";
    this.add.image(width / 2, height / 2, backgroundKey).setDisplaySize(width, height);

    const bg = this.add.graphics();
    bg.fillStyle(0x10071f, 0.34);
    bg.fillRect(0, 0, width, height);

    for (let index = 0; index < 42; index++) {
      const x = Phaser.Math.Between(14, width - 14);
      const y = Phaser.Math.Between(16, Math.max(96, height - 168));
      const radius = Phaser.Math.Between(2, 9);
      const color = [0x7eeeff, 0xff77c9, 0xffdf5f, 0xffffff][index % 4];
      bg.fillStyle(color, Phaser.Math.FloatBetween(0.08, 0.24));
      bg.fillCircle(x, y, radius);
    }

    const topGlow = this.add.graphics();
    topGlow.fillStyle(0x7feeff, 0.12);
    topGlow.fillEllipse(width / 2, Math.min(70, height * 0.16), Math.min(310, width * 0.72), 116);
    topGlow.fillStyle(0xffd45f, 0.1);
    topGlow.fillEllipse(58, Math.max(140, height - 228), 140, 80);
  }

  private drawBoardFrame() {
    const boardPixels = BOARD_SIZE * this.layout.cell;
    const boardCenterX = this.boardX + boardPixels / 2;
    this.add
      .image(boardCenterX, this.layout.boardY + boardPixels / 2, "ui:board-frame")
      .setDisplaySize(this.layout.boardFrameSize, this.layout.boardFrameSize);

    const title = this.add.text(boardCenterX, this.layout.titleY, "99크러시", {
      fontFamily: "Arial Rounded MT Bold, Arial, sans-serif",
      fontSize: this.layout.titleSize,
      color: "#fff5c8",
      stroke: "#6a2a92",
      strokeThickness: 5
    });
    title.setOrigin(0.5);
    title.setShadow(0, 5, "#00000055", 0, true, true);
  }

  private renderInitialBoard() {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const tile = this.engine.getTile({ row, col });
        if (tile) this.createTileView(tile, { row, col }, { row, col }, true);
      }
    }
  }

  private createTileView(tile: Tile, from: Position, to: Position, intro = false): TileView {
    const { x, y } = this.cellToWorld(from);
    const base = this.add.image(0, 0, textureKey(tile.kind));
    base.setDisplaySize(this.layout.cell * 0.9, this.layout.cell * 0.9);
    const container = this.add.container(x, y, [base]);
    container.setSize(this.layout.cell, this.layout.cell);

    const view: TileView = { container, base, special: null, tile, blinkTimer: null };
    this.views.set(tile.id, view);
    this.tileLayer.add(container);
    this.updateSpecialOverlay(view);
    this.startSpriteExpressions(view);

    if (intro) {
      const destination = this.cellToWorld(to);
      container.setScale(0.92);
      this.tweens.add({
        targets: container,
        x: destination.x,
        y: destination.y,
        scale: 1,
        ease: easeOutBack,
        delay: (to.row * 21 + to.col * 11) % 130,
        duration: 320
      });
    }

    return view;
  }

  private async handleTap(position: Position) {
    if (!this.selection) {
      this.setSelection(position);
      return;
    }

    if (this.selection.row === position.row && this.selection.col === position.col) {
      this.setSelection(null);
      return;
    }

    if (this.engine.areAdjacent(this.selection, position)) {
      const from = this.selection;
      this.setSelection(null);
      await this.trySwap(from, position);
      return;
    }

    this.setSelection(position);
  }

  private handlePointerDown = (pointer: Phaser.Input.Pointer) => {
    unlockAudio();
    if (this.busy || this.gameOverDispatched) {
      this.pointerStarts.clear();
      return;
    }
    const position = this.worldToCell(pointer.worldX, pointer.worldY);
    if (!position) {
      this.pointerStarts.delete(pointer.id);
      return;
    }
    this.pointerStarts.set(pointer.id, { position, x: pointer.worldX, y: pointer.worldY });
  };

  private handlePointerUp = (pointer: Phaser.Input.Pointer) => {
    const start = this.pointerStarts.get(pointer.id);
    if (!start) return;
    this.pointerStarts.delete(pointer.id);
    if (this.busy || this.gameOverDispatched) return;
    const dx = pointer.worldX - start.x;
    const dy = pointer.worldY - start.y;
    const tapPosition = this.worldToCell(pointer.worldX, pointer.worldY) ?? start.position;

    if (this.selectedBooster) {
      void this.useTargetedBooster(this.selectedBooster, tapPosition);
      return;
    }

    if (Math.max(Math.abs(dx), Math.abs(dy)) > 16) {
      const target =
        Math.abs(dx) > Math.abs(dy)
          ? { row: start.position.row, col: start.position.col + Math.sign(dx) }
          : { row: start.position.row + Math.sign(dy), col: start.position.col };
      if (this.engine.inBounds(target)) void this.trySwap(start.position, target);
      return;
    }

    void this.handleTap(tapPosition);
  };

  private handlePointerCancel = (pointer: Phaser.Input.Pointer) => {
    this.pointerStarts.delete(pointer.id);
  };

  private async useShuffleBooster() {
    if (this.busy || this.timeLeft <= 0 || this.gameOverDispatched) {
      this.dispatchBoosterUsed("shuffle", false);
      return;
    }

    const turnResetToken = this.resetToken;
    this.busy = true;
    this.pointerStarts.clear();
    try {
      this.selectedBooster = null;
      this.setSelection(null);
      this.engine.shuffleUntilPlayable();
      this.dispatchBoosterUsed("shuffle", true);
      this.cameras.main.shake(110, 0.006);
      this.quizSparkAt({
        x: this.layout.width / 2,
        y: this.layout.boardY + (BOARD_SIZE * this.layout.cell) / 2
      });
      await this.syncAllViewsAfterShuffle();
      if (turnResetToken !== this.resetToken) return;
      this.showToast("SHUFFLE!");
    } catch (error) {
      this.handleActionError(error, "shuffle booster");
    } finally {
      if (turnResetToken === this.resetToken) {
        this.busy = this.gameOverDispatched;
        this.updateHud();
      }
    }
  }

  private async useTargetedBooster(kind: TargetedBoosterKind, target: Position) {
    if (this.busy || this.timeLeft <= 0 || this.gameOverDispatched) {
      this.dispatchBoosterUsed(kind, false);
      return;
    }

    const turnResetToken = this.resetToken;
    this.busy = true;
    this.pointerStarts.clear();
    try {
      this.selectedBooster = null;
      this.setSelection(null);

      const clear = this.engine.clearBooster(kind, target);
      if (!clear) {
        this.invalidNudge(target);
        this.dispatchBoosterUsed(kind, false);
        return;
      }

      this.score += clear.score;
      this.lastCombo = kind === "rainbow" ? 2 : 1;
      this.updateHud();
      this.dispatchBoosterUsed(kind, true);
      this.boosterImpactAt(kind, target);
      await this.animateClear(clear, kind === "rainbow" ? 2 : 1, turnResetToken);
      if (turnResetToken !== this.resetToken || this.gameOverDispatched) return;
      await this.animateCollapse(this.engine.collapseAndRefill());
      if (turnResetToken !== this.resetToken || this.gameOverDispatched) return;
      if (!(await this.resolveCascades([target], turnResetToken))) return;
      if (!this.engine.hasAvailableMove()) {
        this.engine.shuffleUntilPlayable();
        await this.syncAllViewsAfterShuffle();
        if (turnResetToken !== this.resetToken || this.gameOverDispatched) return;
        this.showToast("RESHUFFLE!");
      }
    } catch (error) {
      this.handleActionError(error, `${kind} booster`);
    } finally {
      if (turnResetToken === this.resetToken) {
        this.busy = this.gameOverDispatched;
        this.updateHud();
      }
    }
  }

  private async trySwap(first: Position, second: Position) {
    if (
      this.busy ||
      this.moves <= 0 ||
      this.timeLeft <= 0 ||
      this.gameOverDispatched ||
      !this.engine.areAdjacent(first, second)
    ) return;
    const turnResetToken = this.resetToken;
    this.busy = true;
    this.pointerStarts.clear();
    try {
      this.setSelection(null);
      this.engine.swap(first, second);
      await this.animateSwap(first, second);
      if (turnResetToken !== this.resetToken) return;

      const hasSwapSpecial = this.hasSwapSpecial(first, second);
      const matches = this.engine.findMatches();
      if (!hasSwapSpecial && matches.length === 0) {
        this.engine.swap(first, second);
        await this.animateSwap(first, second, true);
        if (turnResetToken !== this.resetToken) return;
        this.invalidNudge(first);
        return;
      }

      const quizAnchor = this.getQuizAnchor(matches, first, second);
      const answeredCorrectly = await this.askMultiplicationQuiz(quizAnchor);
      if (turnResetToken !== this.resetToken || this.gameOverDispatched || this.timeLeft <= 0) return;
      if (!answeredCorrectly) {
        this.engine.swap(first, second);
        await this.animateSwap(first, second, true);
        if (turnResetToken !== this.resetToken) return;
        this.invalidNudge(first);
        this.showToast("TRY AGAIN!");
        return;
      }

      this.quizSparkAt(quizAnchor);
      this.showToast("CORRECT!");
      this.moves = Math.max(0, this.moves - 1);
      if (hasSwapSpecial) {
        const specialClear = this.engine.clearSwapSpecial(first, second);
        if (!specialClear) return;
        this.score += specialClear.score;
        await this.animateClear(specialClear, 1, turnResetToken);
        if (turnResetToken !== this.resetToken || this.gameOverDispatched) return;
        await this.animateCollapse(this.engine.collapseAndRefill());
        if (turnResetToken !== this.resetToken || this.gameOverDispatched) return;
      }

      if (!(await this.resolveCascades([first, second], turnResetToken))) return;
      if (!this.engine.hasAvailableMove()) {
        this.engine.shuffleUntilPlayable();
        await this.syncAllViewsAfterShuffle();
        if (turnResetToken !== this.resetToken || this.gameOverDispatched) return;
        this.showToast("RESHUFFLE!");
      }
    } catch (error) {
      this.handleActionError(error, "swap action");
    } finally {
      if (turnResetToken === this.resetToken) {
        this.busy = this.gameOverDispatched;
        this.updateHud();
      }
    }
  }

  private hasSwapSpecial(first: Position, second: Position) {
    return Boolean(this.engine.getTile(first)?.special || this.engine.getTile(second)?.special);
  }

  private getQuizAnchor(matches: ReturnType<Match3Engine["findMatches"]>, first: Position, second: Position) {
    const positions = matches[0]?.positions ?? [first, second];
    const total = positions.reduce(
      (sum, position) => ({
        row: sum.row + position.row,
        col: sum.col + position.col
      }),
      { row: 0, col: 0 }
    );
    const center = {
      row: total.row / positions.length,
      col: total.col / positions.length
    };

    return {
      x: this.boardX + center.col * this.layout.cell + this.layout.cell / 2,
      y: this.layout.boardY + center.row * this.layout.cell + this.layout.cell / 2
    };
  }

  private askMultiplicationQuiz(anchor: { x: number; y: number }) {
    const question = createMultiplicationQuestion();
    const id = `quiz-${this.quizSerial++}`;
    this.quizOpen = true;

    return new Promise<boolean>((resolve) => {
      const finish = (correct: boolean) => {
        window.removeEventListener("quiz:answer", onAnswer);
        this.quizOpen = false;
        this.finishActiveQuiz = null;
        window.dispatchEvent(new CustomEvent("quiz:hide", { detail: { playerId: this.playerId, id, correct } }));
        resolve(correct);
      };

      const onAnswer = (event: Event) => {
        const detail = (event as CustomEvent<{ playerId: string; id: string; value: number }>).detail;
        if (!detail || detail.playerId !== this.playerId || detail.id !== id) return;
        finish(detail.value === question.answer);
      };

      this.finishActiveQuiz = finish;
      window.addEventListener("quiz:answer", onAnswer);
      window.dispatchEvent(
        new CustomEvent("quiz:show", {
          detail: {
            id,
            playerId: this.playerId,
            question: `${question.left} x ${question.right}`,
            answer: question.answer,
            choices: question.choices,
            anchor,
            gameSize: {
              width: this.layout.width,
              height: this.layout.height
            }
          }
        })
      );
    });
  }

  private cancelActiveQuiz() {
    const finish = this.finishActiveQuiz;
    if (!finish) return;
    this.finishActiveQuiz = null;
    finish(false);
  }

  private async resolveCascades(anchors: Position[], turnResetToken: number) {
    let combo = 0;
    let matches = this.engine.findMatches();
    while (matches.length > 0 && combo < 12) {
      if (turnResetToken !== this.resetToken || this.gameOverDispatched) return false;
      combo++;
      this.lastCombo = combo;
      const clear = this.engine.clearMatches(matches, anchors);
      this.score += clear.score * combo;
      this.updateHud();
      if (combo >= 2) this.showComboPraise(combo, clear);
      await this.animateClear(clear, combo, turnResetToken);
      if (turnResetToken !== this.resetToken || this.gameOverDispatched) return false;
      await this.animateCollapse(this.engine.collapseAndRefill());
      if (turnResetToken !== this.resetToken || this.gameOverDispatched) return false;
      matches = this.engine.findMatches();
      anchors = [];
    }
    await sleep(this, 80);
    if (turnResetToken !== this.resetToken || this.gameOverDispatched) return false;
    this.lastCombo = 0;
    this.updateHud();
    return true;
  }

  private async animateSwap(first: Position, second: Position, reverse = false) {
    const firstTile = this.engine.getTile(second);
    const secondTile = this.engine.getTile(first);
    const firstView = firstTile ? this.views.get(firstTile.id) : null;
    const secondView = secondTile ? this.views.get(secondTile.id) : null;
    const firstWorld = this.cellToWorld(second);
    const secondWorld = this.cellToWorld(first);
    const duration = reverse ? 145 : 170;

    await this.tweenAll([
      firstView
        ? {
        targets: firstView.container,
        x: firstWorld.x,
        y: firstWorld.y,
        duration,
        ease: "Cubic.easeOut"
          }
        : null,
      secondView
        ? {
        targets: secondView.container,
        x: secondWorld.x,
        y: secondWorld.y,
        duration,
        ease: "Cubic.easeOut"
          }
        : null
    ]);
  }

  private async animateClear(clear: ClearResult, combo: number, turnResetToken: number) {
    if (clear.cleared.length === 0) return;
    playBurst(combo);
    this.cameras.main.shake(95 + combo * 20, Math.min(0.004 + combo * 0.0015, 0.012));
    await sleep(this, Math.min(42 + combo * 12, 90));
    if (turnResetToken !== this.resetToken) return;

    for (const cleared of clear.cleared) {
      const view = this.views.get(cleared.tile.id);
      if (!view) continue;
      this.setTileFrame(view, "surprise");
      this.burstAt(cleared.position, combo, cleared.tile.special);
    }

    await this.tweenAll(
      clear.cleared
        .map((cleared, index) => {
          const view = this.views.get(cleared.tile.id);
          if (!view) return null;
          return {
            targets: view.container,
            scale: 0,
            angle: index % 2 === 0 ? 18 : -18,
            alpha: 0.15,
            duration: 210,
            ease: "Back.easeIn"
          };
        })
        .filter(Boolean)
    );
    if (turnResetToken !== this.resetToken) return;

    for (const cleared of clear.cleared) {
      const view = this.views.get(cleared.tile.id);
      if (view) this.destroyTileView(view);
      this.views.delete(cleared.tile.id);
    }

    if (clear.created) {
      if (turnResetToken !== this.resetToken) return;
      const view = this.views.get(clear.created.tile.id);
      if (view) {
        view.tile = clear.created.tile;
        this.updateSpecialOverlay(view);
        view.container.setScale(0.65);
        playPop(combo);
        await this.tweenAll([
          {
            targets: view.container,
            scale: 1.16,
            duration: 120,
            ease: "Sine.easeOut",
            yoyo: true
          }
        ]);
      }
    }
  }

  private async animateCollapse(collapse: CollapseResult) {
    for (const refill of collapse.refills) {
      this.createTileView(refill.tile, refill.from, refill.from);
    }

    const animations = [...collapse.moves, ...collapse.refills].map((move) => {
      const view = this.views.get(move.tile.id);
      if (!view) return null;
      const destination = this.cellToWorld(move.to);
      return {
        targets: view.container,
        x: destination.x,
        y: destination.y,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        angle: 0,
        duration: 210 + Math.max(0, move.to.row - move.from.row) * 32,
        ease: "Bounce.easeOut"
      };
    });

    await this.tweenAll(animations.filter(Boolean));
  }

  private async syncAllViewsAfterShuffle() {
    const animations: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const tile = this.engine.getTile({ row, col });
        if (!tile) continue;
        let view = this.views.get(tile.id);
        if (!view) view = this.createTileView(tile, { row: -1, col }, { row, col });
        const destination = this.cellToWorld({ row, col });
        animations.push({
          targets: view.container,
          x: destination.x,
          y: destination.y,
          scale: 1,
          duration: 360,
          ease: easeOutBack
        });
      }
    }
    await this.tweenAll(animations);
  }

  private burstAt(position: Position, combo: number, special: SpecialKind | null) {
    const world = this.cellToWorld(position);
    const ring = this.add.image(world.x, world.y, "item:shockwave");
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.setScale(0.2);
    this.fxLayer.add(ring);
    this.tweens.add({
      targets: ring,
      scale: special ? 3.2 : 2.15 + combo * 0.2,
      alpha: 0,
      duration: 340,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy()
    });

    const flash = this.add.image(world.x, world.y, "item:starburst");
    flash.setBlendMode(Phaser.BlendModes.ADD);
    flash.setScale(0.2);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      scale: special ? 1.55 : 1.14,
      alpha: 0,
      duration: 280,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy()
    });

    const particles = this.add.particles(world.x, world.y, "item:confetti", {
      lifespan: { min: 260, max: 560 },
      speed: { min: 130 + combo * 18, max: 260 + combo * 42 },
      scale: { start: special ? 0.72 : 0.46, end: 0 },
      rotate: { min: 0, max: 360 },
      quantity: special ? 26 : 14 + combo * 3,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD
    });
    this.fxLayer.add(particles);
    particles.explode(special ? 32 : 18 + combo * 2);
    this.time.delayedCall(700, () => particles.destroy());

    const shards = this.add.particles(world.x, world.y, "item:fragments", {
      lifespan: 460,
      speed: { min: 70, max: 190 + combo * 24 },
      scale: { start: 0.5, end: 0 },
      rotate: { min: 0, max: 360 },
      gravityY: 360,
      emitting: false
    });
    this.fxLayer.add(shards);
    shards.explode(special ? 20 : 8);
    this.time.delayedCall(760, () => shards.destroy());
  }

  private showComboPraise(combo: number, clear: ClearResult) {
    const center = this.getClearCenter(clear);
    const label =
      combo >= 5 ? "PERFECT" :
        combo >= 4 ? "AMAZING" :
          combo >= 3 ? "GREAT" :
            "NICE";
    const color = combo >= 4 ? "#fff078" : combo >= 3 ? "#7bf7ff" : "#ff93dc";
    const glow = combo >= 4 ? "#ff4dc4" : "#5c2db8";

    const shockwave = this.add.image(center.x, center.y, "item:shockwave");
    shockwave.setBlendMode(Phaser.BlendModes.ADD);
    shockwave.setScale(0.3);
    shockwave.setDepth(55);
    this.fxLayer.add(shockwave);
    this.tweens.add({
      targets: shockwave,
      scale: 2.6 + combo * 0.38,
      alpha: 0,
      duration: 560,
      ease: "Cubic.easeOut",
      onComplete: () => shockwave.destroy()
    });

    const text = this.add.text(center.x, center.y - this.layout.cell * 0.45, `${label} x${combo}`, {
      fontFamily: "Arial Rounded MT Bold, Arial, sans-serif",
      fontSize: `${Math.min(34 + combo * 6, 68)}px`,
      color,
      stroke: glow,
      strokeThickness: 8
    });
    text.setOrigin(0.5);
    text.setDepth(60);
    text.setShadow(0, 8, "#00000066", 0, true, true);
    this.fxLayer.add(text);
    this.tweens.add({
      targets: text,
      y: text.y - 42,
      scale: { from: 0.72, to: 1.22 + combo * 0.03 },
      alpha: 0,
      angle: combo % 2 === 0 ? 5 : -5,
      duration: 760,
      ease: "Back.easeOut",
      onComplete: () => text.destroy()
    });

    const particles = this.add.particles(center.x, center.y, "item:starburst", {
      lifespan: { min: 420, max: 780 },
      speed: { min: 170 + combo * 20, max: 340 + combo * 62 },
      scale: { start: 0.28 + combo * 0.03, end: 0 },
      rotate: { min: 0, max: 360 },
      quantity: 12 + combo * 5,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD
    });
    this.fxLayer.add(particles);
    particles.explode(18 + combo * 6);
    this.time.delayedCall(900, () => particles.destroy());
  }

  private getClearCenter(clear: ClearResult) {
    if (clear.cleared.length === 0) {
      return {
        x: this.layout.width / 2,
        y: this.layout.boardY + (BOARD_SIZE * this.layout.cell) / 2
      };
    }

    const total = clear.cleared.reduce(
      (sum, cleared) => ({
        row: sum.row + cleared.position.row,
        col: sum.col + cleared.position.col
      }),
      { row: 0, col: 0 }
    );
    return this.cellToWorld({
      row: total.row / clear.cleared.length,
      col: total.col / clear.cleared.length
    });
  }

  private quizSparkAt(anchor: { x: number; y: number }) {
    const flash = this.add.image(anchor.x, anchor.y, "item:sparkle");
    flash.setBlendMode(Phaser.BlendModes.ADD);
    flash.setScale(0.18);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      scale: 1.05,
      alpha: 0,
      duration: 360,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy()
    });

    const particles = this.add.particles(anchor.x, anchor.y, "item:confetti", {
      lifespan: 420,
      speed: { min: 120, max: 260 },
      scale: { start: 0.42, end: 0 },
      rotate: { min: 0, max: 360 },
      quantity: 18,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD
    });
    this.fxLayer.add(particles);
    particles.explode(18);
    this.time.delayedCall(560, () => particles.destroy());
  }

  private boosterImpactAt(kind: TargetedBoosterKind, target: Position) {
    const world = this.cellToWorld(target);
    const texture = kind === "rocket" ? "item:rocket" : kind === "rainbow" ? "item:rainbow" : "item:bomb";
    const icon = this.add.image(world.x, world.y, texture);
    icon.setDepth(54);
    icon.setBlendMode(kind === "rainbow" ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    icon.setScale(0.24);
    this.fxLayer.add(icon);

    this.tweens.add({
      targets: icon,
      scale: kind === "rainbow" ? 1.5 : 1.25,
      angle: kind === "rocket" ? 38 : 0,
      alpha: 0,
      duration: 380,
      ease: "Cubic.easeOut",
      onComplete: () => icon.destroy()
    });

    const pulse = this.add.image(world.x, world.y, "item:splash");
    pulse.setBlendMode(Phaser.BlendModes.ADD);
    pulse.setDepth(53);
    pulse.setScale(0.24);
    this.fxLayer.add(pulse);
    this.tweens.add({
      targets: pulse,
      scale: kind === "bomb" ? 2.1 : 1.65,
      alpha: 0,
      duration: 430,
      ease: "Cubic.easeOut",
      onComplete: () => pulse.destroy()
    });
  }

  private dispatchBoosterUsed(kind: BoosterKind, success: boolean) {
    window.dispatchEvent(
      new CustomEvent("booster:used", {
        detail: {
          playerId: this.playerId,
          kind,
          success
        }
      })
    );
  }

  private handleActionError(error: unknown, context: string) {
    console.error(`[99crush] ${context} failed`, error);
    this.selectedBooster = null;
    this.pointerStarts.clear();
    this.setSelection(null);
    this.showToast("RETRY!");
  }

  private invalidNudge(position: Position) {
    const tile = this.engine.getTile(position);
    const view = tile ? this.views.get(tile.id) : null;
    if (!view) return;
    this.cameras.main.shake(55, 0.002);
    this.tweens.add({
      targets: view.container,
      x: view.container.x + 5,
      duration: 40,
      yoyo: true,
      repeat: 2
    });
  }

  private setSelection(position: Position | null) {
    this.selection = position;
    this.selectionRing.clear();
    if (!position) return;

    const { x, y } = this.cellToWorld(position);
    this.selectionRing.lineStyle(4, 0xfff176, 1);
    this.selectionRing.strokeRoundedRect(
      x - this.layout.cell / 2 + 3,
      y - this.layout.cell / 2 + 3,
      this.layout.cell - 6,
      this.layout.cell - 6,
      13
    );
  }

  private showToast(message: string) {
    const toastY = Math.min(
      this.layout.boardY + BOARD_SIZE * this.layout.cell + 38,
      this.layout.height - 92
    );
    const toast = this.add.text(this.layout.width / 2, toastY, message, {
      fontFamily: "Arial Rounded MT Bold, Arial, sans-serif",
      fontSize: "24px",
      color: "#fff6a8",
      stroke: "#6d2c89",
      strokeThickness: 6
    });
    toast.setOrigin(0.5);
    toast.setDepth(50);
    this.fxLayer.add(toast);
    this.tweens.add({
      targets: toast,
      y: toast.y - 34,
      scale: 1.28,
      alpha: 0,
      duration: 650,
      ease: "Cubic.easeOut",
      onComplete: () => toast.destroy()
    });
  }

  private pulseSuggestedMove() {
    if (this.busy || this.selection || this.selectedBooster || this.gameOverDispatched) return;
    const move = this.engine.findAvailableSwap();
    if (!move) return;
    for (const position of [move.first, move.second]) {
      const tile = this.engine.getTile(position);
      const view = tile ? this.views.get(tile.id) : null;
      if (!view) continue;
      this.tweens.add({
        targets: view.container,
        scale: 1.18,
        duration: 180,
        yoyo: true,
        repeat: 1,
        ease: "Sine.easeInOut"
      });
    }
  }

  private updateSpecialOverlay(view: TileView) {
    view.special?.destroy();
    view.special = null;
    if (!view.tile.special) return;

    const image = this.add.image(0, 1, specialTextureKey(view.tile.special));
    image.setDisplaySize(this.layout.cell * 0.76, this.layout.cell * 0.76);
    if (view.tile.special === "rocketH") image.setRotation(Math.PI / 2);
    image.setBlendMode(view.tile.special === "rainbow" ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    view.container.add(image);
    view.special = image;
  }

  private updateHud() {
    window.dispatchEvent(
      new CustomEvent("hud:update", {
        detail: {
          score: this.score,
          playerId: this.playerId,
          moves: this.moves,
          timeLeft: this.timeLeft,
          combo: this.lastCombo
        }
      })
    );
  }

  private cellToWorld(position: Position) {
    return {
      x: this.boardX + position.col * this.layout.cell + this.layout.cell / 2,
      y: this.layout.boardY + position.row * this.layout.cell + this.layout.cell / 2
    };
  }

  private worldToCell(x: number, y: number): Position | null {
    const col = Math.floor((x - this.boardX) / this.layout.cell);
    const row = Math.floor((y - this.layout.boardY) / this.layout.cell);
    const position = { row, col };
    return this.engine?.inBounds(position) ? position : null;
  }

  private get boardX() {
    return (this.layout.width - BOARD_SIZE * this.layout.cell) / 2;
  }

  private async tweenAll(configs: Array<Phaser.Types.Tweens.TweenBuilderConfig | null | false>) {
    const valid = configs.filter(Boolean) as Phaser.Types.Tweens.TweenBuilderConfig[];
    if (valid.length === 0) {
      await sleep(this, 20);
      return;
    }

    await Promise.all(
      valid.map(
        (config) =>
          new Promise<void>((resolve) => {
            const timing = config as {
              delay?: number;
              duration?: number;
              repeat?: number;
              yoyo?: boolean;
              onComplete?: (...args: unknown[]) => void;
              onStop?: (...args: unknown[]) => void;
            };
            const delay = typeof timing.delay === "number" ? timing.delay : 0;
            const duration = typeof timing.duration === "number" ? timing.duration : 0;
            const repeat = typeof timing.repeat === "number" && timing.repeat > 0 ? timing.repeat : 0;
            const yoyoMultiplier = timing.yoyo ? 2 : 1;
            const timeoutMs = Math.max(120, delay + duration * yoyoMultiplier * (repeat + 1) + 420);
            let settled = false;
            let fallback: Phaser.Time.TimerEvent | null = null;
            const finish = () => {
              if (settled) return;
              settled = true;
              fallback?.remove(false);
              resolve();
            };
            const originalOnComplete = timing.onComplete;
            const originalOnStop = timing.onStop;

            fallback = this.time.delayedCall(timeoutMs, finish);
            this.tweens.add({
              ...config,
              onComplete: (...args: unknown[]) => {
                originalOnComplete?.(...args);
                finish();
              },
              onStop: (...args: unknown[]) => {
                originalOnStop?.(...args);
                finish();
              }
            } as Phaser.Types.Tweens.TweenBuilderConfig);
          })
      )
    );
  }

  private startSpriteExpressions(view: TileView) {
    view.blinkTimer = this.time.addEvent({
      delay: Phaser.Math.Between(1600, 3200),
      loop: true,
      callback: () => {
        if (!view.container.active || this.busy) return;
        const expressive = Math.random() > 0.72 ? "happy" : "idle";
        this.setTileFrame(view, "blink");
        this.time.delayedCall(70, () => this.setTileFrame(view, "closed"));
        this.time.delayedCall(150, () => this.setTileFrame(view, expressive));
        this.time.delayedCall(520, () => this.setTileFrame(view, "idle"));
      }
    });
  }

  private setTileFrame(view: TileView, frame: TileFrame) {
    const scene = view.base.scene as Phaser.Scene | undefined;
    const key = textureKey(view.tile.kind, frame);
    if (!view.container.active || !view.base.active || !scene?.textures.exists(key)) return;
    view.base.setTexture(key);
  }

  private destroyTileView(view: TileView) {
    view.blinkTimer?.remove(false);
    view.blinkTimer = null;
    view.container.destroy();
  }
}
