import Phaser from "phaser";
import "./style.css";
import { type BoosterKind } from "./game/types";
import { GameScene, GAME_SCENE_LAYOUTS, type GameLayoutMode } from "./scenes/GameScene";

const PLAYER_OPTIONS = [1, 2, 3, 4] as const;
const BOOSTERS = [
  { kind: "bomb", label: "폭탄 아이템", icon: "bomb", count: 3 },
  { kind: "rocket", label: "로켓 아이템", icon: "rocket", count: 3 },
  { kind: "rainbow", label: "무지개 아이템", icon: "rainbow", count: 1 },
  { kind: "shuffle", label: "셔플 아이템", icon: "shuffle", count: 2 }
] as const satisfies ReadonlyArray<{
  kind: BoosterKind;
  label: string;
  icon: string;
  count: number;
}>;

type PlayerCount = (typeof PLAYER_OPTIONS)[number];
type PlayerId = `p${number}`;
type BoosterInventory = Record<BoosterKind, number>;

type HudDetail = {
  playerId: PlayerId;
  score: number;
  moves: number;
  combo: number;
  timeLeft: number;
};

type QuizShowDetail = {
  playerId: PlayerId;
  id: string;
  question: string;
  answer: number;
  choices: [number, number];
  anchor: {
    x: number;
    y: number;
  };
  gameSize: {
    width: number;
    height: number;
  };
};

const startScreen = document.querySelector<HTMLElement>("#start-screen");
const arena = document.querySelector<HTMLElement>("#arena");
const bgm = document.querySelector<HTMLAudioElement>("#bgm");
const muteToggle = document.querySelector<HTMLButtonElement>("#mute-toggle");
const games = new Map<PlayerId, Phaser.Game>();
const activeQuizzes = new Map<PlayerId, QuizShowDetail>();
const activeBoosters = new Map<PlayerId, BoosterKind | null>();
const boosterInventories = new Map<PlayerId, BoosterInventory>();
const mobileViewportQuery = window.matchMedia("(max-width: 760px), (pointer: coarse) and (max-height: 760px)");
let bgmMuted = window.localStorage.getItem("99crush:bgm-muted") === "true";
let currentPlayerCount: PlayerCount | null = null;
let currentLayoutMode: GameLayoutMode | null = null;
let viewportRefreshTimer: number | null = null;

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const playerLabel = (playerId: PlayerId) => `P${Number(playerId.slice(1))}`;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getPlayerCard = (playerId: PlayerId) =>
  arena?.querySelector<HTMLElement>(`.game-card[data-player-id="${playerId}"]`) ?? null;

const isMobileViewport = () => mobileViewportQuery.matches;

const normalizePlayerCount = (playerCount: PlayerCount): PlayerCount =>
  isMobileViewport() ? 1 : playerCount;

const getLayoutMode = (playerCount: PlayerCount): GameLayoutMode => {
  if (isMobileViewport()) return "mobile";
  return playerCount === 1 ? "wide" : "portrait";
};

const refreshActiveGames = () => {
  requestAnimationFrame(() => {
    games.forEach((game) => game.scale.refresh());
  });
};

const updatePlayerModeButtons = () => {
  const mobile = isMobileViewport();
  document.documentElement.dataset.mobile = mobile ? "true" : "false";
  if (startScreen) startScreen.dataset.mobile = mobile ? "true" : "false";

  document.querySelectorAll<HTMLButtonElement>("[data-player-count]").forEach((button) => {
    const playerCount = Number(button.dataset.playerCount);
    const mobileBlocked = mobile && playerCount !== 1;
    button.disabled = mobileBlocked;
    button.hidden = mobileBlocked;
    button.setAttribute("aria-hidden", mobileBlocked ? "true" : "false");
  });
};

const syncBgmState = () => {
  if (!bgm || !muteToggle) return;
  bgm.muted = bgmMuted;
  muteToggle.classList.toggle("muted", bgmMuted);
  muteToggle.setAttribute("aria-pressed", bgmMuted ? "true" : "false");
  muteToggle.setAttribute("aria-label", bgmMuted ? "배경음 켜기" : "배경음 음소거");
};

const playBgm = () => {
  if (!bgm || !muteToggle) return;
  bgm.volume = 0.42;
  bgm.muted = bgmMuted;
  muteToggle.hidden = false;

  const playPromise = bgm.play();
  if (playPromise) {
    playPromise.catch(() => {
      muteToggle.classList.add("needs-start");
    });
  }
};

syncBgmState();
updatePlayerModeButtons();

const createBoosterInventory = (): BoosterInventory =>
  BOOSTERS.reduce(
    (inventory, booster) => ({
      ...inventory,
      [booster.kind]: booster.count
    }),
    {} as BoosterInventory
  );

const getBoosterInventory = (playerId: PlayerId) => {
  const existing = boosterInventories.get(playerId);
  if (existing) return existing;
  const inventory = createBoosterInventory();
  boosterInventories.set(playerId, inventory);
  return inventory;
};

const setArmedBooster = (playerId: PlayerId, kind: BoosterKind | null) => {
  activeBoosters.set(playerId, kind);
  updateBoosterButtons(playerId);
};

const updateBoosterButtons = (playerId: PlayerId) => {
  const card = getPlayerCard(playerId);
  if (!card) return;
  const inventory = getBoosterInventory(playerId);
  const activeKind = activeBoosters.get(playerId) ?? null;

  card.querySelectorAll<HTMLButtonElement>(".booster").forEach((button) => {
    const kind = button.dataset.booster as BoosterKind | undefined;
    if (!kind) return;
    const count = inventory[kind];
    const countBadge = button.querySelector<HTMLElement>("b");
    const isArmed = activeKind === kind;

    if (countBadge) countBadge.textContent = String(count);
    button.disabled = count <= 0;
    button.classList.toggle("armed", isArmed);
    button.classList.toggle("depleted", count <= 0);
    button.setAttribute("aria-pressed", isArmed ? "true" : "false");
  });
};

const createPlayerCard = (playerId: PlayerId) => {
  const titleId = `quiz-title-${playerId}`;
  const card = document.createElement("article");
  card.className = "game-card";
  card.dataset.playerId = playerId;
  card.innerHTML = `
    <div class="player-stats" aria-live="polite">
      <div class="player-badge">${playerLabel(playerId)}</div>
      <div class="stat-card score-card">
        <img src="/assets/sprites/items/star.png" alt="" />
        <span class="hud-label">Score</span>
        <strong data-stat="score">0</strong>
      </div>
      <div class="stat-card">
        <img src="/assets/sprites/items/clock.png" alt="" />
        <span class="hud-label">Time</span>
        <strong data-stat="time">1:30</strong>
      </div>
      <div class="stat-card">
        <img src="/assets/sprites/items/lightning.png" alt="" />
        <span class="hud-label">Moves</span>
        <strong data-stat="moves">30</strong>
      </div>
      <button class="reset-button" type="button" aria-label="${playerLabel(playerId)} 새 게임">
        <span></span>
      </button>
    </div>
    <div class="game-root"></div>
    <section class="math-quiz" aria-live="assertive" hidden>
      <div class="math-bubble" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <span id="${titleId}" class="quiz-kicker">구구단 찬스</span>
        <strong class="quiz-question">2 x 3 = ?</strong>
        <div class="quiz-choices" aria-label="정답 선택">
          <button type="button" data-choice-index="0">6</button>
          <button type="button" data-choice-index="1">7</button>
        </div>
      </div>
    </section>
    <div class="player-tools">
      <div class="booster-row" aria-label="${playerLabel(playerId)} 아이템">
        ${BOOSTERS.map(
          (booster) => `
            <button class="booster" type="button" data-booster="${booster.kind}" aria-label="${booster.label}" aria-pressed="false">
              <img src="/assets/sprites/items/${booster.icon}.png" alt="" />
              <b>${booster.count}</b>
            </button>
          `
        ).join("")}
      </div>
      <div class="combo-track" aria-hidden="true">
        <span data-stat="combo"></span>
      </div>
      <div class="mascot" aria-hidden="true">
        <img src="/assets/sprites/mascot/mouse.png" alt="" />
      </div>
    </div>
  `;

  return card;
};

const createGame = (playerId: PlayerId, parent: HTMLElement, index: number, layoutMode: GameLayoutMode) => {
  const layout = GAME_SCENE_LAYOUTS[layoutMode];
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    backgroundColor: "#17112d",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: layout.width,
      height: layout.height
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false
    },
    scene: [new GameScene(playerId, 20260512 + index * 101, layoutMode)]
  });
};

const destroyGames = () => {
  window.dispatchEvent(new CustomEvent("game:teardown"));
  for (const game of games.values()) game.destroy(true);
  games.clear();
  activeQuizzes.clear();
  activeBoosters.clear();
  boosterInventories.clear();
};

const startGame = (playerCount: PlayerCount) => {
  if (!arena || !startScreen) return;
  const actualPlayerCount = normalizePlayerCount(playerCount);
  const layoutMode = getLayoutMode(actualPlayerCount);
  destroyGames();
  arena.replaceChildren();
  currentPlayerCount = actualPlayerCount;
  currentLayoutMode = layoutMode;
  arena.dataset.players = String(actualPlayerCount);
  arena.dataset.layout = layoutMode;
  startScreen.hidden = true;
  arena.hidden = false;
  playBgm();

  for (let index = 0; index < actualPlayerCount; index++) {
    const playerId = `p${index + 1}` as PlayerId;
    const card = createPlayerCard(playerId);
    boosterInventories.set(playerId, createBoosterInventory());
    activeBoosters.set(playerId, null);
    arena.append(card);
    updateBoosterButtons(playerId);
    const root = card.querySelector<HTMLElement>(".game-root");
    if (root) games.set(playerId, createGame(playerId, root, index, layoutMode));
  }

  refreshActiveGames();
};

document.querySelectorAll<HTMLButtonElement>("[data-player-count]").forEach((button) => {
  button.addEventListener("click", () => {
    const playerCount = Number(button.dataset.playerCount);
    if (PLAYER_OPTIONS.includes(playerCount as PlayerCount)) startGame(playerCount as PlayerCount);
  });
});

const scheduleViewportRefresh = () => {
  if (viewportRefreshTimer) window.clearTimeout(viewportRefreshTimer);
  viewportRefreshTimer = window.setTimeout(() => {
    viewportRefreshTimer = null;
    updatePlayerModeButtons();

    if (!currentPlayerCount || arena?.hidden) {
      refreshActiveGames();
      return;
    }

    const nextPlayerCount = normalizePlayerCount(currentPlayerCount);
    const nextLayoutMode = getLayoutMode(nextPlayerCount);
    if (nextPlayerCount !== currentPlayerCount || nextLayoutMode !== currentLayoutMode) {
      startGame(nextPlayerCount);
      return;
    }

    refreshActiveGames();
  }, 160);
};

window.addEventListener("resize", scheduleViewportRefresh);
mobileViewportQuery.addEventListener("change", scheduleViewportRefresh);

muteToggle?.addEventListener("click", () => {
  bgmMuted = !bgmMuted;
  window.localStorage.setItem("99crush:bgm-muted", String(bgmMuted));
  muteToggle.classList.remove("needs-start");
  syncBgmState();
  if (!bgmMuted) playBgm();
});

window.addEventListener("hud:update", (event) => {
  const detail = (event as CustomEvent<HudDetail>).detail;
  if (!detail) return;
  const card = getPlayerCard(detail.playerId);
  if (!card) return;

  const score = card.querySelector<HTMLElement>('[data-stat="score"]');
  const moves = card.querySelector<HTMLElement>('[data-stat="moves"]');
  const timeLeft = card.querySelector<HTMLElement>('[data-stat="time"]');
  const comboFill = card.querySelector<HTMLElement>('[data-stat="combo"]');

  if (score) score.textContent = detail.score.toLocaleString("en-US");
  if (moves) moves.textContent = String(detail.moves);
  if (timeLeft) {
    timeLeft.textContent = formatTime(detail.timeLeft);
    timeLeft.closest(".stat-card")?.classList.toggle("warning", detail.timeLeft <= 10);
  }
  if (comboFill) comboFill.style.width = `${Math.min(100, detail.combo * 22)}%`;
});

const positionQuizBubble = (detail: QuizShowDetail, card: HTMLElement) => {
  const quiz = card.querySelector<HTMLElement>(".math-quiz");
  const canvas = card.querySelector<HTMLCanvasElement>("canvas");
  const cardRect = card.getBoundingClientRect();
  const canvasRect = canvas?.getBoundingClientRect();
  if (!quiz || !canvasRect) return;

  const playerCount = Number(arena?.dataset.players ?? 1);
  const bubbleMaxWidth = playerCount >= 3 ? 244 : 310;
  const bubbleMinWidth = playerCount >= 3 ? 190 : 210;
  const bubbleWidth = Math.min(bubbleMaxWidth, Math.max(bubbleMinWidth, cardRect.width - 18));
  const bubbleHeight = bubbleWidth * (228 / 320);
  const anchorX = canvasRect.left + (detail.anchor.x / detail.gameSize.width) * canvasRect.width - cardRect.left;
  const anchorY = canvasRect.top + (detail.anchor.y / detail.gameSize.height) * canvasRect.height - cardRect.top;
  const left = clamp(anchorX, bubbleWidth / 2 + 8, cardRect.width - bubbleWidth / 2 - 8);
  const topHudReserve = Math.min(68, cardRect.height * 0.14);
  const bottomReserve = Math.min(108, cardRect.height * 0.2);
  const hasRoomAbove = anchorY - bubbleHeight - 18 > topHudReserve;
  const top = hasRoomAbove
    ? anchorY - 10
    : clamp(anchorY + 16, topHudReserve, cardRect.height - bubbleHeight - bottomReserve);

  quiz.style.setProperty("--quiz-left", `${left}px`);
  quiz.style.setProperty("--quiz-top", `${top}px`);
  quiz.style.setProperty("--quiz-width", `${bubbleWidth}px`);
  quiz.dataset.placement = hasRoomAbove ? "above" : "below";
};

window.addEventListener("quiz:show", (event) => {
  const detail = (event as CustomEvent<QuizShowDetail>).detail;
  if (!detail) return;
  const card = getPlayerCard(detail.playerId);
  const mathQuiz = card?.querySelector<HTMLElement>(".math-quiz");
  const quizQuestion = card?.querySelector<HTMLElement>(".quiz-question");
  const quizChoiceButtons = [...(card?.querySelectorAll<HTMLButtonElement>(".quiz-choices button") ?? [])];
  if (!card || !mathQuiz || !quizQuestion) return;

  activeQuizzes.set(detail.playerId, detail);
  positionQuizBubble(detail, card);
  quizQuestion.textContent = `${detail.question} = ?`;
  quizChoiceButtons.forEach((button, index) => {
    const choice = detail.choices[index];
    button.textContent = String(choice);
    button.disabled = false;
    button.dataset.value = String(choice);
    button.classList.remove("correct", "wrong");
  });

  mathQuiz.hidden = false;
  requestAnimationFrame(() => mathQuiz.classList.add("active"));
});

window.addEventListener("quiz:hide", (event) => {
  const detail = (event as CustomEvent<{ playerId: PlayerId }>).detail;
  if (!detail) return;
  const card = getPlayerCard(detail.playerId);
  const mathQuiz = card?.querySelector<HTMLElement>(".math-quiz");
  const quizChoiceButtons = [...(card?.querySelectorAll<HTMLButtonElement>(".quiz-choices button") ?? [])];
  if (!mathQuiz) return;

  mathQuiz.classList.remove("active");
  window.setTimeout(() => {
    mathQuiz.hidden = true;
    activeQuizzes.delete(detail.playerId);
    quizChoiceButtons.forEach((button) => {
      button.disabled = false;
      button.classList.remove("correct", "wrong");
    });
  }, 180);
});

window.addEventListener("booster:used", (event) => {
  const detail = (event as CustomEvent<{ playerId: PlayerId; kind: BoosterKind; success: boolean }>).detail;
  if (!detail) return;
  const inventory = getBoosterInventory(detail.playerId);
  if (detail.success) inventory[detail.kind] = Math.max(0, inventory[detail.kind] - 1);
  setArmedBooster(detail.playerId, null);
  updateBoosterButtons(detail.playerId);
});

arena?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const resetButton = target.closest<HTMLButtonElement>(".reset-button");
  if (resetButton) {
    const playerId = resetButton.closest<HTMLElement>(".game-card")?.dataset.playerId as PlayerId | undefined;
    if (playerId) {
      boosterInventories.set(playerId, createBoosterInventory());
      setArmedBooster(playerId, null);
      window.dispatchEvent(new CustomEvent("game:reset", { detail: { playerId } }));
    }
    return;
  }

  const boosterButton = target.closest<HTMLButtonElement>(".booster");
  if (boosterButton) {
    const playerId = boosterButton.closest<HTMLElement>(".game-card")?.dataset.playerId as PlayerId | undefined;
    const kind = boosterButton.dataset.booster as BoosterKind | undefined;
    if (!playerId || !kind || boosterButton.disabled) return;

    const inventory = getBoosterInventory(playerId);
    if (inventory[kind] <= 0) return;

    if (activeBoosters.get(playerId) === kind && kind !== "shuffle") {
      setArmedBooster(playerId, null);
      window.dispatchEvent(new CustomEvent("booster:cancel", { detail: { playerId } }));
      return;
    }

    setArmedBooster(playerId, kind === "shuffle" ? null : kind);
    window.dispatchEvent(new CustomEvent("booster:select", { detail: { playerId, kind } }));
    return;
  }

  const choiceButton = target.closest<HTMLButtonElement>(".quiz-choices button");
  if (!choiceButton) return;
  const playerId = choiceButton.closest<HTMLElement>(".game-card")?.dataset.playerId as PlayerId | undefined;
  if (!playerId) return;
  const activeQuiz = activeQuizzes.get(playerId);
  if (!activeQuiz) return;

  const value = Number(choiceButton.dataset.value);
  const isCorrect = value === activeQuiz.answer;
  const card = getPlayerCard(playerId);
  const quizChoiceButtons = [...(card?.querySelectorAll<HTMLButtonElement>(".quiz-choices button") ?? [])];
  quizChoiceButtons.forEach((button) => {
    button.disabled = true;
    const choiceValue = Number(button.dataset.value);
    if (choiceValue === activeQuiz.answer) button.classList.add("correct");
  });
  if (!isCorrect) choiceButton.classList.add("wrong");

  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent("quiz:answer", {
        detail: {
          playerId,
          id: activeQuiz.id,
          value
        }
      })
    );
  }, 360);
});

window.addEventListener("beforeunload", () => {
  bgm?.pause();
  destroyGames();
});
