export const GRID_COLS = 10;
export const GRID_ROWS = 20;

export type EngineKind = "blocks" | "snake" | "breakout" | "tank" | "dodge" | "racing";
export type Control = "left" | "right" | "up" | "down" | "rotate";
export type SoundCue = "move" | "clear" | "start" | "gameover" | "hit";

export interface PixelCell {
  x: number;
  y: number;
  strength?: number;
}

export interface Variant {
  index: number;
  difficulty: number;
  engine: EngineKind;
  name: string;
  startSpeed: number;
  gravityStep: number;
  prefillRows: number;
  wallWrap: boolean;
  pieceSet: number;
  lanes: number;
  seed: number;
}

export interface LcdView {
  power: boolean;
  paused: boolean;
  gameOver: boolean;
  playing: boolean;
  score: number;
  hiScore: number;
  difficulty: number;
  index: number;
  title: string;
  cells: PixelCell[];
  preview: PixelCell[];
  runnerFrame: number;
}

export interface GameEngine {
  readonly kind: EngineKind;
  score: number;
  gameOver: boolean;
  tick(): void;
  control(control: Control): void;
  cells(): PixelCell[];
  preview(): PixelCell[];
  drainSounds(): SoundCue[];
}
