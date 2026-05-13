import Phaser from "phaser";
import { type SpecialKind, type TileKind, TILE_KINDS } from "../game/types";

const CHARACTER_ASSET_VERSION = "raster-clean-20260513-red-refresh";

export const TILE_FRAMES = ["idle", "blink", "closed", "happy", "surprise", "bounce"] as const;
export type TileFrame = (typeof TILE_FRAMES)[number];

export const textureKey = (kind: TileKind, frame: TileFrame = "idle") =>
  `tile:${kind}:${frame}`;

export const specialTextureKey = (special: SpecialKind) => {
  if (special === "rocketH" || special === "rocketV") return "item:rocket";
  if (special === "bomb") return "item:bomb";
  return "item:rainbow";
};

const itemAssets = [
  "bomb",
  "rocket",
  "rainbow",
  "lightning",
  "shuffle",
  "confetti",
  "starburst",
  "shockwave",
  "splash",
  "sparkle",
  "fragments",
  "refresh"
];

export const loadGeneratedAssets = (scene: Phaser.Scene) => {
  scene.load.image("ui:background", "/assets/ui/background.png");
  scene.load.image("ui:board-frame", "/assets/ui/board-frame.png");
  scene.load.image("mascot:mouse", "/assets/sprites/mascot/mouse.png");

  for (const kind of TILE_KINDS) {
    for (const frame of TILE_FRAMES) {
      scene.load.image(
        textureKey(kind, frame),
        `/assets/sprites/characters/${kind}-${frame}.png?v=${CHARACTER_ASSET_VERSION}`
      );
    }
  }

  for (const name of itemAssets) {
    scene.load.image(`item:${name}`, `/assets/sprites/items/${name}.png`);
  }
};
