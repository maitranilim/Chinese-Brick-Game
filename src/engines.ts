import {
  GRID_COLS,
  GRID_ROWS,
  type Control,
  type EngineKind,
  type GameEngine,
  type PixelCell,
  type SoundCue,
  type Variant,
} from "./types";

type Point = { x: number; y: number };

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }
}

abstract class BaseEngine implements GameEngine {
  abstract readonly kind: EngineKind;
  score = 0;
  gameOver = false;
  protected readonly rng: Rng;
  protected readonly variant: Variant;
  private sounds: SoundCue[] = [];

  constructor(variant: Variant, runNumber: number) {
    this.variant = variant;
    this.rng = new Rng(variant.seed ^ Math.imul(runNumber + 1, 0x45d9f3b));
  }

  abstract tick(): void;
  abstract control(control: Control): void;
  abstract cells(): PixelCell[];
  abstract preview(): PixelCell[];

  drainSounds(): SoundCue[] {
    const pending = this.sounds;
    this.sounds = [];
    return pending;
  }

  protected cue(sound: SoundCue): void {
    this.sounds.push(sound);
  }
}

type CatalogEntry = {
  engine: EngineKind;
  name: string;
  baseSpeed: number;
  prefill: number;
  wrap: boolean;
  pieceSet: number;
  lanes: number;
};

const CATALOG: readonly CatalogEntry[] = [
  { engine: "blocks", name: "BLOCK STACK", baseSpeed: 7, prefill: 0, wrap: false, pieceSet: 0, lanes: 4 },
  { engine: "blocks", name: "BLOCK RUSH", baseSpeed: 5, prefill: 0, wrap: false, pieceSet: 1, lanes: 4 },
  { engine: "blocks", name: "BLOCK DIG", baseSpeed: 6, prefill: 2, wrap: false, pieceSet: 2, lanes: 4 },
  { engine: "snake", name: "SNAKE WRAP", baseSpeed: 6, prefill: 0, wrap: true, pieceSet: 0, lanes: 4 },
  { engine: "snake", name: "SNAKE MAZE", baseSpeed: 5, prefill: 0, wrap: false, pieceSet: 0, lanes: 4 },
  { engine: "breakout", name: "BREAKOUT", baseSpeed: 5, prefill: 0, wrap: false, pieceSet: 0, lanes: 4 },
  { engine: "tank", name: "TANK ATTACK", baseSpeed: 5, prefill: 0, wrap: false, pieceSet: 0, lanes: 4 },
  { engine: "dodge", name: "CAR DODGE", baseSpeed: 4, prefill: 0, wrap: false, pieceSet: 0, lanes: 4 },
  { engine: "racing", name: "STREET RACE", baseSpeed: 4, prefill: 0, wrap: false, pieceSet: 0, lanes: 3 },
  { engine: "racing", name: "TURBO RALLY", baseSpeed: 3, prefill: 0, wrap: false, pieceSet: 0, lanes: 4 },
];

const ENGINE_NAMES: Record<EngineKind, string> = {
  blocks: "BLOCK MODE",
  snake: "SNAKE MODE",
  breakout: "BREAKOUT",
  tank: "TANK MODE",
  dodge: "CAR DODGE",
  racing: "RACE MODE",
};

function seededHash(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * The first ten numbers are intentionally named game modes. From 11 to 9999,
 * this maps a large menu number to one of the six core routines plus settings.
 * That is an honest simulation of real "9999 in 1" hardware: a few engines
 * repeated behind many deterministic speed, layout, and rules variations.
 */
export function buildVariant(index: number, difficulty: number): Variant {
  const safeIndex = Math.min(9999, Math.max(1, Math.floor(index)));
  const safeDifficulty = Math.min(3, Math.max(1, Math.floor(difficulty)));
  const hash = seededHash(safeIndex * 1009 + safeDifficulty * 7919);
  const entry = safeIndex <= CATALOG.length
    ? CATALOG[safeIndex - 1]
    : (() => {
        const engine = (["blocks", "snake", "breakout", "tank", "dodge", "racing"] as const)[hash % 6];
        return {
          engine,
          name: ENGINE_NAMES[engine],
          baseSpeed: 4 + ((hash >>> 3) % 4),
          prefill: engine === "blocks" ? (hash >>> 7) % 4 : 0,
          wrap: engine === "snake" ? Boolean((hash >>> 11) & 1) : false,
          pieceSet: (hash >>> 13) % 3,
          lanes: engine === "racing" ? 3 + ((hash >>> 17) % 2) : 4,
        } satisfies CatalogEntry;
      })();
  const speedNoise = (hash >>> 21) & 1;

  return {
    index: safeIndex,
    difficulty: safeDifficulty,
    engine: entry.engine,
    name: entry.name,
    startSpeed: Math.max(1, entry.baseSpeed - (safeDifficulty - 1) * 2 - speedNoise),
    gravityStep: 1 + Math.floor((safeDifficulty - 1) / 2),
    prefillRows: Math.min(5, entry.prefill + (safeDifficulty === 3 && entry.engine === "blocks" ? 1 : 0)),
    wallWrap: entry.wrap,
    pieceSet: entry.pieceSet,
    lanes: entry.lanes,
    seed: hash,
  };
}

const TETROMINOES: readonly number[][][] = [
  [[1, 1, 1, 1]],
  [[1, 0], [1, 0], [1, 1]],
  [[0, 1], [0, 1], [1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 1], [1, 1, 0]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
];

const PIECE_SETS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6],
  [0, 1, 2, 3, 5],
  [1, 2, 4, 5, 6],
];

function rotateClockwise(matrix: readonly number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0].length;
  return Array.from({ length: cols }, (_, x) => Array.from({ length: rows }, (_, y) => matrix[rows - 1 - y][x]));
}

type FallingPiece = { type: number; shape: number[][]; x: number; y: number };

class FallingBlocksEngine extends BaseEngine {
  readonly kind = "blocks" as const;
  private board: number[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
  private current: FallingPiece | null = null;
  private nextType = 0;
  private ticks = 0;
  private lines = 0;

  constructor(variant: Variant, runNumber: number) {
    super(variant, runNumber);
    this.seedFloor();
    this.nextType = this.randomType();
    this.spawn();
  }

  tick(): void {
    if (this.gameOver || !this.current) return;
    this.ticks += 1;
    const gravity = Math.max(1, this.variant.startSpeed - Math.floor(this.lines / 5) * this.variant.gravityStep);
    if (this.ticks < gravity) return;
    this.ticks = 0;
    if (!this.tryMove(0, 1)) this.lockPiece();
  }

  control(control: Control): void {
    if (this.gameOver || !this.current) return;
    if (control === "left" && this.tryMove(-1, 0)) this.cue("move");
    if (control === "right" && this.tryMove(1, 0)) this.cue("move");
    if (control === "down") {
      if (this.tryMove(0, 1)) {
        this.score += 1;
        this.cue("move");
      } else {
        this.lockPiece();
      }
    }
    if ((control === "up" || control === "rotate") && this.rotate()) this.cue("move");
  }

  cells(): PixelCell[] {
    const output: PixelCell[] = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLS; x += 1) {
        if (this.board[y][x]) output.push({ x, y, strength: 0.78 });
      }
    }
    if (this.current) {
      this.forEachPieceCell(this.current.shape, this.current.x, this.current.y, (x, y) => output.push({ x, y, strength: 0.97 }));
    }
    return output;
  }

  preview(): PixelCell[] {
    const shape = TETROMINOES[this.nextType];
    const offsetX = Math.floor((4 - shape[0].length) / 2);
    const offsetY = Math.floor((4 - shape.length) / 2);
    const output: PixelCell[] = [];
    this.forEachPieceCell(shape, offsetX, offsetY, (x, y) => output.push({ x, y }));
    return output;
  }

  private seedFloor(): void {
    for (let row = 0; row < this.variant.prefillRows; row += 1) {
      const y = GRID_ROWS - 1 - row;
      for (let x = 0; x < GRID_COLS; x += 1) {
        this.board[y][x] = this.rng.next() > 0.31 ? 1 : 0;
      }
      // A seeded row must never start complete: the first lock would wipe it and
      // hand out a line bonus the player never earned.
      if (this.board[y].every(Boolean)) this.board[y][this.rng.int(GRID_COLS)] = 0;
    }
  }

  private randomType(): number {
    const set = PIECE_SETS[this.variant.pieceSet % PIECE_SETS.length];
    return set[this.rng.int(set.length)];
  }

  private spawn(): void {
    const type = this.nextType;
    const shape = TETROMINOES[type].map((row) => [...row]);
    this.current = { type, shape, x: Math.floor((GRID_COLS - shape[0].length) / 2), y: 0 };
    this.nextType = this.randomType();
    if (!this.canPlace(this.current.shape, this.current.x, this.current.y)) {
      this.current = null;
      this.gameOver = true;
    }
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.current || !this.canPlace(this.current.shape, this.current.x + dx, this.current.y + dy)) return false;
    this.current.x += dx;
    this.current.y += dy;
    return true;
  }

  private rotate(): boolean {
    if (!this.current) return false;
    const rotated = rotateClockwise(this.current.shape);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (this.canPlace(rotated, this.current.x + kick, this.current.y)) {
        this.current.shape = rotated;
        this.current.x += kick;
        return true;
      }
    }
    return false;
  }

  private lockPiece(): void {
    if (!this.current) return;
    this.forEachPieceCell(this.current.shape, this.current.x, this.current.y, (x, y) => {
      if (y >= 0 && y < GRID_ROWS && x >= 0 && x < GRID_COLS) this.board[y][x] = 1;
    });
    let cleared = 0;
    this.board = this.board.filter((row) => {
      const full = row.every(Boolean);
      if (full) cleared += 1;
      return !full;
    });
    while (this.board.length < GRID_ROWS) this.board.unshift(Array(GRID_COLS).fill(0));
    if (cleared) {
      this.lines += cleared;
      this.score += [0, 100, 300, 700, 1400][cleared] * this.variant.difficulty;
      this.cue("clear");
    }
    this.spawn();
  }

  private canPlace(shape: readonly number[][], atX: number, atY: number): boolean {
    let permitted = true;
    this.forEachPieceCell(shape, atX, atY, (x, y) => {
      if (x < 0 || x >= GRID_COLS || y >= GRID_ROWS || (y >= 0 && this.board[y][x])) permitted = false;
    });
    return permitted;
  }

  private forEachPieceCell(shape: readonly number[][], x0: number, y0: number, callback: (x: number, y: number) => void): void {
    for (let y = 0; y < shape.length; y += 1) {
      for (let x = 0; x < shape[y].length; x += 1) {
        if (shape[y][x]) callback(x0 + x, y0 + y);
      }
    }
  }
}

class SnakeEngine extends BaseEngine {
  readonly kind = "snake" as const;
  private body: Point[] = [];
  private direction: Point = { x: 0, y: -1 };
  private nextDirection: Point = { x: 0, y: -1 };
  private food: Point = { x: 0, y: 0 };
  private ticks = 0;

  constructor(variant: Variant, runNumber: number) {
    super(variant, runNumber);
    this.body = [{ x: 5, y: 12 }, { x: 5, y: 13 }, { x: 5, y: 14 }];
    this.placeFood();
  }

  tick(): void {
    if (this.gameOver) return;
    this.ticks += 1;
    if (this.ticks < this.variant.startSpeed) return;
    this.ticks = 0;
    this.direction = this.nextDirection;
    let next = { x: this.body[0].x + this.direction.x, y: this.body[0].y + this.direction.y };
    if (this.variant.wallWrap) {
      next = { x: (next.x + GRID_COLS) % GRID_COLS, y: (next.y + GRID_ROWS) % GRID_ROWS };
    }
    const eats = next.x === this.food.x && next.y === this.food.y;
    const collision = next.x < 0 || next.x >= GRID_COLS || next.y < 0 || next.y >= GRID_ROWS
      || this.body.slice(0, eats ? this.body.length : -1).some((part) => part.x === next.x && part.y === next.y);
    if (collision) {
      this.gameOver = true;
      return;
    }
    this.body.unshift(next);
    if (eats) {
      this.score += 10 * this.variant.difficulty;
      this.cue("clear");
      this.placeFood();
    } else {
      this.body.pop();
    }
  }

  control(control: Control): void {
    const directions: Partial<Record<Control, Point>> = {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
    };
    const requested = directions[control];
    if (!requested || requested.x === -this.direction.x && requested.y === -this.direction.y) return;
    if (requested.x !== this.nextDirection.x || requested.y !== this.nextDirection.y) {
      this.nextDirection = requested;
      this.cue("move");
    }
  }

  cells(): PixelCell[] {
    return [
      ...this.body.map((part, index) => ({ ...part, strength: index === 0 ? 0.98 : 0.84 })),
      { ...this.food, strength: 0.62 },
    ];
  }

  preview(): PixelCell[] {
    return [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
  }

  private placeFood(): void {
    const open: Point[] = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLS; x += 1) {
        if (!this.body.some((part) => part.x === x && part.y === y)) open.push({ x, y });
      }
    }
    if (!open.length) {
      this.gameOver = true;
      return;
    }
    this.food = open[this.rng.int(open.length)];
  }
}

class BreakoutEngine extends BaseEngine {
  readonly kind = "breakout" as const;
  private bricks: boolean[][] = [];
  private paddleX = 3;
  private readonly paddleY = 18;
  private ball: Point = { x: 5, y: 16 };
  private velocity: Point = { x: 1, y: -1 };
  private ticks = 0;

  constructor(variant: Variant, runNumber: number) {
    super(variant, runNumber);
    this.buildBricks();
  }

  tick(): void {
    if (this.gameOver) return;
    this.ticks += 1;
    if (this.ticks < this.variant.startSpeed) return;
    this.ticks = 0;

    let nextX = this.ball.x + this.velocity.x;
    if (nextX < 0 || nextX >= GRID_COLS) {
      this.velocity.x *= -1;
      nextX = this.ball.x + this.velocity.x;
    }
    let nextY = this.stepY();

    if (this.isBrick(nextX, nextY)) {
      this.bricks[nextY][nextX] = false;
      this.velocity.y *= -1;
      this.score += 10 * this.variant.difficulty;
      this.cue("hit");
      // Bounce away from the brick instead of drifting into the cell that was
      // just cleared, which used to leave the ball travelling against its own
      // velocity for a tick.
      nextY = this.stepY();
      if (this.isBrick(nextX, nextY)) nextY = this.ball.y;
    }

    if (this.velocity.y > 0 && nextY === this.paddleY) {
      if (nextX >= this.paddleX && nextX <= this.paddleX + 2) {
        this.velocity.y = -1;
        this.velocity.x = nextX === this.paddleX ? -1 : nextX === this.paddleX + 2 ? 1 : this.velocity.x;
        nextY = this.paddleY - 1;
        this.cue("hit");
      }
    }

    if (nextY >= GRID_ROWS) {
      this.gameOver = true;
      return;
    }
    this.ball = { x: nextX, y: nextY };

    if (!this.bricks.some((row) => row.some(Boolean))) {
      this.score += 100 * this.variant.difficulty;
      this.cue("clear");
      this.buildBricks();
    }
  }

  control(control: Control): void {
    if (control === "left" && this.paddleX > 0) {
      this.paddleX -= 1;
      this.cue("move");
    }
    if (control === "right" && this.paddleX < GRID_COLS - 3) {
      this.paddleX += 1;
      this.cue("move");
    }
  }

  cells(): PixelCell[] {
    const output: PixelCell[] = [];
    for (let y = 0; y < this.bricks.length; y += 1) {
      for (let x = 0; x < GRID_COLS; x += 1) {
        if (this.bricks[y][x]) output.push({ x, y, strength: 0.72 });
      }
    }
    for (let x = 0; x < 3; x += 1) output.push({ x: this.paddleX + x, y: this.paddleY, strength: 0.95 });
    output.push({ ...this.ball, strength: 1 });
    return output;
  }

  preview(): PixelCell[] {
    return [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }];
  }

  private stepY(): number {
    const candidate = this.ball.y + this.velocity.y;
    if (candidate >= 0) return candidate;
    this.velocity.y = 1;
    return this.ball.y + this.velocity.y;
  }

  private isBrick(x: number, y: number): boolean {
    return y >= 0 && y < this.bricks.length && x >= 0 && x < GRID_COLS && this.bricks[y][x];
  }

  private buildBricks(): void {
    const rows = Math.min(6, 3 + this.variant.difficulty);
    this.bricks = Array.from({ length: rows + 1 }, (_, y) => Array.from({ length: GRID_COLS }, () => y > 0 && this.rng.next() > 0.12));
    this.ball = { x: 5, y: 16 };
    this.velocity = { x: this.rng.next() > 0.5 ? 1 : -1, y: -1 };
    this.paddleX = 3;
  }
}

type Tank = Point;

class TankShooterEngine extends BaseEngine {
  readonly kind = "tank" as const;
  private player: Tank = { x: 4, y: 17 };
  private enemies: Tank[] = [];
  private playerShots: Point[] = [];
  private enemyShots: Point[] = [];
  private readonly obstacles: Point[];
  private ticks = 0;
  private spawnTicks = 0;
  private shotCooldown = 0;

  constructor(variant: Variant, runNumber: number) {
    super(variant, runNumber);
    this.obstacles = this.makeObstacles();
  }

  tick(): void {
    if (this.gameOver) return;
    this.ticks += 1;
    if (this.ticks < this.variant.startSpeed) return;
    this.ticks = 0;
    this.score += 1;
    this.shotCooldown = Math.max(0, this.shotCooldown - 1);
    this.spawnTicks += 1;

    this.playerShots = this.playerShots
      .map((shot) => ({ x: shot.x, y: shot.y - 1 }))
      .filter((shot) => shot.y >= 0 && !this.isObstacle(shot));
    this.enemyShots = this.enemyShots
      .map((shot) => ({ x: shot.x, y: shot.y + 1 }))
      .filter((shot) => shot.y < GRID_ROWS && !this.isObstacle(shot));

    const destroyed = new Set<number>();
    this.playerShots = this.playerShots.filter((shot) => {
      const index = this.enemies.findIndex((enemy) => this.tankCells(enemy).some((cell) => cell.x === shot.x && cell.y === shot.y));
      if (index < 0) return true;
      destroyed.add(index);
      this.score += 40 * this.variant.difficulty;
      this.cue("hit");
      return false;
    });
    if (destroyed.size) this.enemies = this.enemies.filter((_, index) => !destroyed.has(index));

    this.enemies = this.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y + (this.rng.next() > 0.55 ? 1 : 0) }));
    for (const enemy of this.enemies) {
      if (this.rng.next() < 0.16 + this.variant.difficulty * 0.035) this.enemyShots.push({ x: enemy.x + 1, y: enemy.y + 2 });
    }
    this.enemies = this.enemies.filter((enemy) => enemy.y < GRID_ROWS);
    if (this.spawnTicks >= Math.max(3, 9 - this.variant.difficulty * 2)) {
      this.spawnTicks = 0;
      const x = this.rng.int(GRID_COLS - 1);
      if (!this.enemies.some((enemy) => enemy.x === x && enemy.y < 3)) this.enemies.push({ x, y: 0 });
    }

    if (this.playerIsHit()) this.gameOver = true;
  }

  control(control: Control): void {
    if (control === "rotate") {
      // ROTATE fires; the D-pad is left free to drive the tank in all four
      // directions, so UP is no longer a one-way trip to the bottom row.
      if (this.shotCooldown === 0 && this.player.y > 0) {
        this.playerShots.push({ x: this.player.x + 1, y: this.player.y - 1 });
        this.shotCooldown = 2;
        this.cue("move");
      }
      return;
    }
    const deltas: Partial<Record<Control, Point>> = {
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
    };
    const delta = deltas[control];
    if (!delta) return;
    const next = { x: this.player.x + delta.x, y: this.player.y + delta.y };
    if (next.x < 0 || next.x > GRID_COLS - 2 || next.y < 0 || next.y > GRID_ROWS - 2 || this.tankCells(next).some((cell) => this.isObstacle(cell))) return;
    this.player = next;
    this.cue("move");
    // Driving into an enemy or a live shell has to count, otherwise the tank
    // can share a cell with one until it moves away again.
    if (this.playerIsHit()) this.gameOver = true;
  }

  private playerIsHit(): boolean {
    const playerCells = this.tankCells(this.player);
    const overlaps = (cell: Point) => playerCells.some((part) => part.x === cell.x && part.y === cell.y);
    return this.enemyShots.some(overlaps)
      || this.enemies.some((enemy) => this.tankCells(enemy).some(overlaps));
  }

  cells(): PixelCell[] {
    return [
      ...this.obstacles.map((cell) => ({ ...cell, strength: 0.46 })),
      ...this.enemies.flatMap((enemy) => this.tankCells(enemy).map((cell) => ({ ...cell, strength: 0.78 }))),
      ...this.tankCells(this.player).map((cell) => ({ ...cell, strength: 0.98 })),
      ...this.playerShots.map((cell) => ({ ...cell, strength: 0.94 })),
      ...this.enemyShots.map((cell) => ({ ...cell, strength: 0.64 })),
    ];
  }

  preview(): PixelCell[] {
    return [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }];
  }

  private makeObstacles(): Point[] {
    const bases = [
      { x: 1 + this.rng.int(2), y: 8 },
      { x: 5 + this.rng.int(2), y: 11 },
      { x: 2 + this.rng.int(3), y: 14 },
    ];
    return bases.flatMap((base) => [{ ...base }, { x: base.x + 1, y: base.y }]);
  }

  private tankCells(tank: Tank): Point[] {
    return [{ ...tank }, { x: tank.x + 1, y: tank.y }, { x: tank.x, y: tank.y + 1 }, { x: tank.x + 1, y: tank.y + 1 }];
  }

  private isObstacle(cell: Point): boolean {
    return this.obstacles.some((obstacle) => obstacle.x === cell.x && obstacle.y === cell.y);
  }
}

type TrafficCar = { lane: number; y: number };

const PLAYER_TOP = GRID_ROWS - 2;
const PLAYER_BOTTOM = GRID_ROWS - 1;

class CarDodgeEngine extends BaseEngine {
  readonly kind = "dodge" as const;
  private readonly laneXs = [1, 3, 5, 7];
  private lane = 1;
  private cars: TrafficCar[] = [];
  private ticks = 0;
  private spawnTicks = 0;

  tick(): void {
    if (this.gameOver) return;
    this.ticks += 1;
    if (this.ticks < this.variant.startSpeed) return;
    this.ticks = 0;
    this.score += 1;
    this.spawnTicks += 1;
    this.cars = this.cars.map((car) => ({ ...car, y: car.y + 1 }));
    if (this.crashed()) {
      this.gameOver = true;
      return;
    }
    const passed = this.cars.filter((car) => car.y >= GRID_ROWS).length;
    if (passed) this.score += passed * 10 * this.variant.difficulty;
    this.cars = this.cars.filter((car) => car.y < GRID_ROWS);
    if (this.spawnTicks >= Math.max(2, 7 - this.variant.difficulty)) {
      this.spawnTicks = 0;
      const lane = this.rng.int(this.laneXs.length);
      if (!this.cars.some((car) => car.lane === lane && car.y < 4)) this.cars.push({ lane, y: 0 });
    }
  }

  control(control: Control): void {
    if (control === "left" && this.lane > 0) {
      this.lane -= 1;
      this.cue("move");
    } else if (control === "right" && this.lane < this.laneXs.length - 1) {
      this.lane += 1;
      this.cue("move");
    } else {
      return;
    }
    // Swerving into an occupied lane is a crash. Without this the car simply
    // overlapped the traffic until the offending car scrolled off the bottom.
    if (this.crashed()) this.gameOver = true;
  }

  /** The player fills rows 18-19, traffic fills car.y and car.y + 1. */
  private crashed(): boolean {
    return this.cars.some((car) => car.lane === this.lane && car.y <= PLAYER_BOTTOM && car.y + 1 >= PLAYER_TOP);
  }

  cells(): PixelCell[] {
    const output: PixelCell[] = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      if (y % 3 !== 1) {
        output.push({ x: 0, y, strength: 0.42 }, { x: 9, y, strength: 0.42 });
      }
    }
    for (const car of this.cars) {
      const x = this.laneXs[car.lane];
      output.push({ x, y: car.y, strength: 0.82 }, { x, y: car.y + 1, strength: 0.82 });
    }
    const playerX = this.laneXs[this.lane];
    output.push({ x: playerX, y: PLAYER_TOP, strength: 0.98 }, { x: playerX, y: PLAYER_BOTTOM, strength: 0.98 });
    return output;
  }

  preview(): PixelCell[] {
    return [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }];
  }
}

class RacingLanesEngine extends BaseEngine {
  readonly kind = "racing" as const;
  private lane = 1;
  private traffic: TrafficCar[] = [];
  private ticks = 0;
  private spawnTicks = 0;
  private scroll = 0;
  private readonly laneCount: number;

  constructor(variant: Variant, runNumber: number) {
    super(variant, runNumber);
    this.laneCount = variant.lanes;
    this.lane = Math.floor(this.laneCount / 2);
  }

  tick(): void {
    if (this.gameOver) return;
    this.ticks += 1;
    if (this.ticks < this.variant.startSpeed) return;
    this.ticks = 0;
    this.advance();
  }

  control(control: Control): void {
    if (control === "up") {
      // Accelerating now scrolls the road for real. It used to hand out four
      // points per press with no risk, which let a held UP button farm an
      // unbeatable high score without the car ever moving.
      this.ticks = 0;
      this.advance();
      this.cue("move");
      return;
    }
    if (control === "left" && this.lane > 0) {
      this.lane -= 1;
      this.cue("move");
    } else if (control === "right" && this.lane < this.laneCount - 1) {
      this.lane += 1;
      this.cue("move");
    } else {
      return;
    }
    if (this.crashed()) this.gameOver = true;
  }

  private advance(): void {
    if (this.gameOver) return;
    this.scroll += 1;
    this.score += 2 * this.variant.difficulty;
    this.spawnTicks += 1;
    this.traffic = this.traffic.map((car) => ({ ...car, y: car.y + 1 }));
    if (this.crashed()) {
      this.gameOver = true;
      return;
    }
    this.traffic = this.traffic.filter((car) => car.y < GRID_ROWS);
    if (this.spawnTicks >= Math.max(2, 6 - this.variant.difficulty)) {
      this.spawnTicks = 0;
      const lane = this.rng.int(this.laneCount);
      if (!this.traffic.some((car) => car.lane === lane && car.y < 5)) this.traffic.push({ lane, y: 0 });
    }
  }

  private crashed(): boolean {
    return this.traffic.some((car) => car.lane === this.lane && car.y <= PLAYER_BOTTOM && car.y + 1 >= PLAYER_TOP);
  }

  cells(): PixelCell[] {
    const output: PixelCell[] = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      const left = this.roadLeft(y);
      const right = left + this.laneCount * 2;
      output.push({ x: left - 1, y, strength: 0.46 }, { x: right, y, strength: 0.46 });
      if ((y + this.scroll) % 3 !== 1) {
        for (let lane = 1; lane < this.laneCount; lane += 1) output.push({ x: left + lane * 2 - 1, y, strength: 0.3 });
      }
    }
    for (const car of this.traffic) {
      const x = this.roadLeft(car.y) + car.lane * 2;
      output.push({ x, y: car.y, strength: 0.8 }, { x, y: car.y + 1, strength: 0.8 });
    }
    const playerX = this.roadLeft(PLAYER_TOP) + this.lane * 2;
    output.push({ x: playerX, y: PLAYER_TOP, strength: 0.98 }, { x: playerX, y: PLAYER_BOTTOM, strength: 0.98 });
    return output;
  }

  preview(): PixelCell[] {
    const output: PixelCell[] = [];
    for (let y = 0; y < 4; y += 1) {
      output.push({ x: 0, y }, { x: 3, y });
      if (y % 2 === 0) output.push({ x: 1, y });
    }
    return output;
  }

  private roadLeft(row: number): number {
    const shifts = [0, 0, 1, 1, 0, -1, -1, 0];
    const shift = shifts[Math.floor((row + this.scroll) / 5) % shifts.length];
    const width = this.laneCount * 2;
    const base = Math.floor((GRID_COLS - width) / 2);
    return Math.max(1, Math.min(GRID_COLS - width - 1, base + shift));
  }
}

export function createEngine(variant: Variant, runNumber: number): GameEngine {
  switch (variant.engine) {
    case "blocks": return new FallingBlocksEngine(variant, runNumber);
    case "snake": return new SnakeEngine(variant, runNumber);
    case "breakout": return new BreakoutEngine(variant, runNumber);
    case "tank": return new TankShooterEngine(variant, runNumber);
    case "dodge": return new CarDodgeEngine(variant, runNumber);
    case "racing": return new RacingLanesEngine(variant, runNumber);
  }
}
