import { GRID_COLS, GRID_ROWS, type LcdView, type PixelCell } from "./types";

const LCD_W = 400;
const LCD_H = 452;
const LCD_BG = "#9ca88b";
const PIXEL = "#2b2f27";
const GRID_X = 18;
const GRID_Y = 68;
const CELL = 15;
const GAP = 1;
const PANEL_X = 202;

type Glyph = readonly string[];

const PIXEL_FONT: Record<string, Glyph> = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "011", "001"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  "-": ["000", "000", "111", "000", "000"],
  "/": ["001", "001", "010", "100", "100"],
  ":": ["000", "010", "000", "010", "000"],
  " ": ["000", "000", "000", "000", "000"],
};

const DIGIT_SEGMENTS: Record<number, readonly number[]> = {
  0: [0, 1, 2, 4, 5, 6],
  1: [2, 5],
  2: [0, 2, 3, 4, 6],
  3: [0, 2, 3, 5, 6],
  4: [1, 2, 3, 5],
  5: [0, 1, 3, 5, 6],
  6: [0, 1, 3, 4, 5, 6],
  7: [0, 2, 5],
  8: [0, 1, 2, 3, 4, 5, 6],
  9: [0, 1, 2, 3, 5, 6],
};

const RUNNER: readonly Glyph[] = [
  ["00100", "01100", "00110", "01100", "10100", "00101", "01000"],
  ["00100", "01100", "00110", "01100", "00101", "10100", "00010"],
];

/**
 * The LCD is deliberately rendered before any game logic: it draws all 200
 * inactive cells on every frame. The faint 8% ghost grid is the key visual
 * cue from the original segmented displays.
 */
export class LcdRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.width = LCD_W;
    this.canvas.height = LCD_H;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
  }

  render(view: LcdView): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, LCD_W, LCD_H);
    ctx.fillStyle = LCD_BG;
    ctx.fillRect(0, 0, LCD_W, LCD_H);

    // Flat translucent strips create the reflective, slightly uneven LCD face.
    ctx.fillStyle = "#d5ddc6";
    ctx.globalAlpha = 0.16;
    ctx.fillRect(5, 5, LCD_W - 10, 6);
    ctx.globalAlpha = 0.045;
    ctx.fillRect(8, 16, LCD_W - 16, 24);
    ctx.fillRect(10, 416, LCD_W - 20, 3);
    ctx.globalAlpha = 1;

    ctx.fillStyle = PIXEL;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(8, 10, LCD_W - 16, 1);
    ctx.fillRect(PANEL_X - 9, 16, 1, LCD_H - 32);
    ctx.fillRect(10, 422, LCD_W - 20, 1);
    ctx.globalAlpha = 1;

    this.drawText(view.title, GRID_X, 22, 2, view.power ? 0.74 : 0.1);
    this.drawGrid(view.cells, view.power);
    this.drawSidePanel(view);
  }

  private drawGrid(cells: PixelCell[], powered: boolean): void {
    const { ctx } = this;
    const active = new Map<string, number>();
    for (const cell of cells) {
      if (cell.x < 0 || cell.x >= GRID_COLS || cell.y < 0 || cell.y >= GRID_ROWS) continue;
      const key = `${cell.x}:${cell.y}`;
      active.set(key, Math.max(active.get(key) ?? 0, cell.strength ?? 0.94));
    }

    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLS; x += 1) {
        const alpha = active.get(`${x}:${y}`) ?? 0.08;
        this.drawCell(GRID_X + x * (CELL + GAP), GRID_Y + y * (CELL + GAP), CELL, powered ? alpha : 0.08);
      }
    }

    ctx.fillStyle = PIXEL;
    ctx.globalAlpha = powered ? 0.42 : 0.11;
    ctx.fillRect(GRID_X - 2, GRID_Y - 2, GRID_COLS * (CELL + GAP) + 3, 1);
    ctx.fillRect(GRID_X - 2, GRID_Y - 2, 1, GRID_ROWS * (CELL + GAP) + 3);
    ctx.fillRect(GRID_X - 2, GRID_Y + GRID_ROWS * (CELL + GAP) + 1, GRID_COLS * (CELL + GAP) + 3, 1);
    ctx.fillRect(GRID_X + GRID_COLS * (CELL + GAP) + 1, GRID_Y - 2, 1, GRID_ROWS * (CELL + GAP) + 3);
    ctx.globalAlpha = 1;
  }

  private drawSidePanel(view: LcdView): void {
    const powerAlpha = view.power ? 1 : 0.16;
    this.drawText("SCORE", PANEL_X + 9, 21, 2, 0.62 * powerAlpha);
    this.drawNumber(view.score, PANEL_X + 9, 35, 2, 6, 0.92 * powerAlpha);
    this.drawText("HI-SCORE", PANEL_X + 9, 65, 2, 0.58 * powerAlpha);
    this.drawNumber(view.hiScore, PANEL_X + 9, 79, 1, 6, 0.76 * powerAlpha);

    this.drawText("NEXT", PANEL_X + 9, 101, 2, 0.58 * powerAlpha);
    this.drawPreview(view.preview, powerAlpha);

    this.drawText("SPEED LEVEL", PANEL_X + 9, 177, 2, 0.64 * powerAlpha);
    this.drawNumber(view.difficulty, PANEL_X + 45, 193, 3, 1, 0.9 * powerAlpha);
    this.drawRunner(PANEL_X + 55, 244, view.runnerFrame, view.playing && !view.paused && !view.gameOver ? 0.84 : 0.16 * powerAlpha);

    this.drawText("PAUSE", PANEL_X + 35, 303, 2, (view.paused ? 0.92 : 0.13) * powerAlpha);
    this.drawText("GAME OVER", PANEL_X + 12, 325, 2, (view.gameOver ? 0.92 : 0.13) * powerAlpha);
    this.drawText("GAME", PANEL_X + 9, 373, 2, 0.58 * powerAlpha);
    this.drawNumber(view.index, PANEL_X + 9, 388, 1, 4, 0.82 * powerAlpha);
  }

  private drawPreview(preview: PixelCell[], powerAlpha: number): void {
    const active = new Set(preview.map((cell) => `${cell.x}:${cell.y}`));
    const x0 = PANEL_X + 46;
    const y0 = 116;
    const size = 9;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        this.drawCell(x0 + x * size, y0 + y * size, size - 1, (active.has(`${x}:${y}`) ? 0.9 : 0.08) * powerAlpha);
      }
    }
  }

  private drawRunner(x0: number, y0: number, frame: number, alpha: number): void {
    const glyph = RUNNER[frame % RUNNER.length];
    const scale = 3;
    for (let y = 0; y < glyph.length; y += 1) {
      for (let x = 0; x < glyph[y].length; x += 1) {
        if (glyph[y][x] === "1") this.drawCell(x0 + x * scale, y0 + y * scale, scale - 1, alpha);
      }
    }
  }

  private drawText(text: string, x0: number, y0: number, scale: number, alpha: number): void {
    let x = x0;
    for (const rawChar of text.toUpperCase()) {
      const glyph = PIXEL_FONT[rawChar] ?? PIXEL_FONT[" "];
      for (let row = 0; row < glyph.length; row += 1) {
        for (let col = 0; col < glyph[row].length; col += 1) {
          if (glyph[row][col] === "1") this.drawCell(x + col * scale, y0 + row * scale, scale, alpha);
        }
      }
      x += 4 * scale;
    }
  }

  private drawNumber(value: number, x0: number, y0: number, unit: number, digits: number, alpha: number): void {
    const normalized = Math.max(0, Math.floor(value)).toString().slice(-digits).padStart(digits, "0");
    const width = unit * 5;
    for (let i = 0; i < normalized.length; i += 1) {
      this.drawDigit(Number(normalized[i]), x0 + i * (width + unit), y0, unit, alpha);
    }
  }

  private drawDigit(value: number, x: number, y: number, unit: number, alpha: number): void {
    const segments = [
      [x + unit, y, unit * 3, unit],
      [x, y + unit, unit, unit * 3],
      [x + unit * 4, y + unit, unit, unit * 3],
      [x + unit, y + unit * 4, unit * 3, unit],
      [x, y + unit * 5, unit, unit * 3],
      [x + unit * 4, y + unit * 5, unit, unit * 3],
      [x + unit, y + unit * 8, unit * 3, unit],
    ] as const;
    const lit = new Set(DIGIT_SEGMENTS[value] ?? []);
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      this.drawRect(segment[0], segment[1], segment[2], segment[3], lit.has(i) ? alpha : 0.08 * alpha);
    }
  }

  private drawCell(x: number, y: number, size: number, alpha: number): void {
    this.drawRect(x, y, size, size, alpha);
  }

  private drawRect(x: number, y: number, width: number, height: number, alpha: number): void {
    this.ctx.fillStyle = PIXEL;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillRect(x, y, width, height);
    this.ctx.globalAlpha = 1;
  }
}
