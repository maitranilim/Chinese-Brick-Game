import "./style.css";
import { buildVariant, createEngine } from "./engines";
import { LcdRenderer } from "./lcd";
import type { Control, EngineKind, GameEngine, PixelCell, SoundCue, Variant } from "./types";

type Command = Control | "power" | "sound" | "pause" | "reset";
type ConsoleState = "off" | "select" | "playing";

class SquareAudio {
  private context: AudioContext | null = null;
  private enabled = true;

  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.unlock();
      this.play("start");
    }
    return this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  play(cue: SoundCue): void {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    if (cue === "move") this.tone(500, 0.035, now, 0.045);
    if (cue === "hit") this.tone(260, 0.045, now, 0.05);
    if (cue === "start") {
      this.tone(420, 0.06, now, 0.045);
      this.tone(640, 0.08, now + 0.07, 0.045);
    }
    if (cue === "clear") {
      this.tone(620, 0.12, now, 0.06);
      this.tone(830, 0.16, now + 0.12, 0.065);
    }
    if (cue === "gameover") {
      this.tone(280, 0.11, now, 0.06);
      this.tone(200, 0.11, now + 0.12, 0.06);
      this.tone(125, 0.18, now + 0.24, 0.07);
    }
  }

  private tone(frequency: number, duration: number, start: number, volume: number): void {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  }
}

class BrickGame {
  private readonly renderer: LcdRenderer;
  private readonly audio: SquareAudio;
  private readonly status: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private state: ConsoleState = "select";
  private powered = true;
  private paused = false;
  private selectedIndex = 1;
  private difficulty = 1;
  private engine: GameEngine | null = null;
  private runningVariant: Variant | null = null;
  private runNumber = 0;
  private tickNumber = 0;
  private readonly bestScores = new Map<number, number>();
  private unsavedBest: number | null = null;

  constructor(renderer: LcdRenderer, audio: SquareAudio, status: HTMLElement, soundButton: HTMLButtonElement) {
    this.renderer = renderer;
    this.audio = audio;
    this.status = status;
    this.soundButton = soundButton;
    this.render();
    window.setInterval(() => this.onTick(), 100);
  }

  command(command: Command): void {
    this.audio.unlock();
    if (command === "power") {
      this.togglePower();
      return;
    }
    if (command === "sound") {
      this.soundButton.setAttribute("aria-pressed", String(this.audio.toggle()));
      this.render();
      return;
    }
    if (command === "pause") {
      if (this.powered && this.state === "playing" && this.engine && !this.engine.gameOver) {
        this.paused = !this.paused;
        this.audio.play("move");
        if (this.paused) this.flushBest();
      }
      this.render();
      return;
    }
    if (command === "reset") {
      this.powered = true;
      this.startGame();
      return;
    }
    this.handleGameControl(command);
  }

  autoPause(): void {
    if (!document.hidden) return;
    this.flushBest();
    if (this.state === "playing" && !this.paused && this.engine && !this.engine.gameOver) {
      this.paused = true;
      this.render();
    }
  }

  /** Last chance to persist a best score before the page or app goes away. */
  persist(): void {
    this.flushBest();
  }

  private onTick(): void {
    this.tickNumber += 1;
    if (this.powered && this.state === "playing" && this.engine && !this.paused && !this.engine.gameOver) {
      this.engine.tick();
      this.playEngineSounds();
      this.saveBestIfNeeded();
      if (this.engine.gameOver) {
        this.audio.play("gameover");
        this.flushBest();
      }
    }
    this.render();
  }

  private togglePower(): void {
    this.flushBest();
    this.powered = !this.powered;
    if (this.powered) {
      this.state = "select";
      this.engine = null;
      this.runningVariant = null;
      this.paused = false;
      this.audio.play("start");
    } else {
      this.state = "off";
      this.engine = null;
      this.runningVariant = null;
      this.paused = false;
    }
    this.render();
  }

  private handleGameControl(control: Control): void {
    if (!this.powered) return;
    if (this.state === "select") {
      if (control === "left") this.selectedIndex = this.selectedIndex === 1 ? 9999 : this.selectedIndex - 1;
      if (control === "right") this.selectedIndex = this.selectedIndex === 9999 ? 1 : this.selectedIndex + 1;
      if (control === "up") this.difficulty = this.difficulty === 3 ? 1 : this.difficulty + 1;
      if (control === "down") this.difficulty = this.difficulty === 1 ? 3 : this.difficulty - 1;
      if (control === "rotate") {
        this.startGame();
        return;
      }
      this.audio.play("move");
      this.render();
      return;
    }
    if (!this.engine) return;
    if (this.engine.gameOver) {
      if (control === "rotate") this.startGame();
      return;
    }
    if (this.paused) return;
    this.engine.control(control);
    this.playEngineSounds();
    this.saveBestIfNeeded();
    if (this.engine.gameOver) {
      this.audio.play("gameover");
      this.flushBest();
    }
    this.render();
  }

  private startGame(): void {
    this.flushBest();
    const variant = this.selectedVariant();
    this.runningVariant = variant;
    this.engine = createEngine(variant, this.runNumber);
    this.runNumber += 1;
    this.state = "playing";
    this.paused = false;
    this.audio.play("start");
    this.render();
  }

  private playEngineSounds(): void {
    if (!this.engine) return;
    for (const cue of this.engine.drainSounds()) this.audio.play(cue);
  }

  private selectedVariant(): Variant {
    return buildVariant(this.selectedIndex, this.difficulty);
  }

  private bestScore(index: number): number {
    const cached = this.bestScores.get(index);
    if (cached !== undefined) return cached;
    let stored = 0;
    try {
      const parsed = Number(window.localStorage.getItem(`brickgame.hi.${index}`));
      if (Number.isFinite(parsed) && parsed > 0) stored = Math.floor(parsed);
    } catch {
      stored = 0;
    }
    this.bestScores.set(index, stored);
    return stored;
  }

  /**
   * Scoring engines add points on every step, so writing straight through to
   * localStorage meant ten synchronous writes a second for the whole run. The
   * best score is tracked in memory and flushed only when a run pauses or ends.
   */
  private saveBestIfNeeded(): void {
    if (!this.engine || !this.runningVariant) return;
    const index = this.runningVariant.index;
    if (this.engine.score <= this.bestScore(index)) return;
    this.bestScores.set(index, this.engine.score);
    this.unsavedBest = index;
  }

  private flushBest(): void {
    const index = this.unsavedBest;
    if (index === null) return;
    this.unsavedBest = null;
    try {
      window.localStorage.setItem(`brickgame.hi.${index}`, String(this.bestScores.get(index) ?? 0));
    } catch {
      // Private browsing can disable storage. Play remains fully functional.
    }
  }

  private render(): void {
    const variant = this.runningVariant ?? this.selectedVariant();
    const engine = this.engine;
    const playing = this.powered && this.state === "playing";
    const score = engine?.score ?? 0;
    const cells = engine ? engine.cells() : this.menuCells(variant.engine);
    const preview = engine ? engine.preview() : this.menuPreview(variant.engine);
    this.renderer.render({
      power: this.powered,
      paused: this.paused,
      gameOver: Boolean(engine?.gameOver),
      playing,
      score,
      hiScore: this.bestScore(variant.index),
      difficulty: this.difficulty,
      index: variant.index,
      title: this.powered ? variant.name : "OFF",
      cells: this.powered ? cells : [],
      preview: this.powered ? preview : [],
      runnerFrame: Math.floor(this.tickNumber / 3),
    });
    const statusMode = !this.powered ? "off" : engine?.gameOver ? "game over" : this.paused ? "paused" : playing ? "playing" : "selecting";
    this.status.textContent = `Game ${String(variant.index).padStart(4, "0")}, ${variant.name}, level ${this.difficulty}, ${statusMode}.`;
  }

  private menuCells(engine: EngineKind): PixelCell[] {
    if (engine === "blocks") return [{ x: 4, y: 8 }, { x: 5, y: 8 }, { x: 5, y: 9 }, { x: 6, y: 9 }];
    if (engine === "snake") return [{ x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 5, y: 9 }, { x: 5, y: 10 }, { x: 7, y: 11, strength: 0.62 }];
    if (engine === "breakout") {
      return [
        ...Array.from({ length: 8 }, (_, x) => ({ x: x + 1, y: 4, strength: 0.7 })),
        { x: 5, y: 14 }, { x: 3, y: 17 }, { x: 4, y: 17 }, { x: 5, y: 17 },
      ];
    }
    if (engine === "tank") return [{ x: 4, y: 12 }, { x: 5, y: 12 }, { x: 4, y: 13 }, { x: 5, y: 13 }, { x: 5, y: 10 }];
    if (engine === "dodge") return [{ x: 0, y: 6, strength: 0.42 }, { x: 9, y: 6, strength: 0.42 }, { x: 4, y: 10 }, { x: 4, y: 11 }, { x: 6, y: 15 }, { x: 6, y: 16 }];
    return [{ x: 1, y: 4, strength: 0.4 }, { x: 8, y: 4, strength: 0.4 }, { x: 3, y: 8 }, { x: 3, y: 9 }, { x: 5, y: 14 }, { x: 5, y: 15 }];
  }

  private menuPreview(engine: EngineKind): PixelCell[] {
    if (engine === "blocks") return [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }];
    if (engine === "snake") return [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }];
    if (engine === "breakout") return [{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 3 }];
    if (engine === "tank") return [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }];
    return [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }];
  }
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("App container is missing.");

app.innerHTML = `
  <section class="handheld-stage">
    <section class="handheld" aria-label="Brick Game 9999 console">
      <div class="brand-rail">SUPER</div>
      <div class="lcd-bezel"><canvas id="lcd" aria-label="Game LCD display" role="img"></canvas></div>
      <div class="console-name">BRICK GAME</div>
      <div class="model-line"><span>9999 IN 1</span><span>LCD ARCADE</span></div>
      <div class="utility-controls" aria-label="Utility controls">
        <button class="utility-control" data-command="power" type="button">ON/OFF</button>
        <button class="utility-control" data-command="sound" type="button" aria-pressed="true">SOUND</button>
        <button class="utility-control" data-command="pause" type="button">S/P</button>
        <button class="utility-control" data-command="reset" type="button">RESET</button>
      </div>
      <div class="play-controls" aria-label="Game controls">
        <div class="dpad" aria-label="Direction pad">
          <button class="dpad-control up" data-command="up" type="button" aria-label="Up">▲</button>
          <button class="dpad-control left" data-command="left" type="button" aria-label="Left">◀</button>
          <div class="dpad-core" aria-hidden="true">9999<br>IN 1</div>
          <button class="dpad-control right" data-command="right" type="button" aria-label="Right">▶</button>
          <button class="dpad-control down" data-command="down" type="button" aria-label="Down">▼</button>
        </div>
        <div class="rotate-wrap">
          <button class="action-control" data-command="rotate" type="button">ROTATE</button>
          <div class="rotate-label">START / ROTATE</div>
        </div>
      </div>
      <p class="help-line">ARROWS: MOVE / SELECT · Z OR SPACE: ROTATE · P: PAUSE · R: RESET</p>
      <p id="status" class="sr-only" aria-live="polite"></p>
    </section>
  </section>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#lcd");
const status = document.querySelector<HTMLElement>("#status");
const soundButton = document.querySelector<HTMLButtonElement>('[data-command="sound"]');
if (!canvas || !status || !soundButton) throw new Error("Required console controls are missing.");

const game = new BrickGame(new LcdRenderer(canvas), new SquareAudio(), status, soundButton);
const directional = new Set<Command>(["left", "right", "up", "down"]);

/**
 * Auto-repeat timers are tracked per button. A single shared pair of handles
 * meant a second finger overwrote the first button's handles, orphaning its
 * interval so the console kept receiving that direction forever.
 */
type Hold = { delay?: number; repeat?: number };
const holds = new Map<HTMLButtonElement, Hold>();

function clearHold(button: HTMLButtonElement): void {
  const hold = holds.get(button);
  if (hold) {
    if (hold.delay !== undefined) window.clearTimeout(hold.delay);
    if (hold.repeat !== undefined) window.clearInterval(hold.repeat);
    holds.delete(button);
  }
  button.classList.remove("is-held");
}

function clearAllHolds(): void {
  for (const button of [...holds.keys()]) clearHold(button);
}

function isCommand(value: string | undefined): value is Command {
  return value === "left" || value === "right" || value === "up" || value === "down" || value === "rotate"
    || value === "power" || value === "sound" || value === "pause" || value === "reset";
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
  button.addEventListener("pointerdown", (event) => {
    const command = button.dataset.command;
    if (!isCommand(command)) return;
    event.preventDefault();
    clearHold(button);
    button.classList.add("is-held");
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // A pointer can be gone before capture is requested; the game still runs.
    }
    game.command(command);
    if (!directional.has(command)) return;
    const hold: Hold = {};
    holds.set(button, hold);
    hold.delay = window.setTimeout(() => {
      hold.repeat = window.setInterval(() => game.command(command), 115);
    }, 260);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    button.addEventListener(eventName, () => clearHold(button));
  }
}

const keyCommands: Record<string, Command> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  " ": "rotate",
  z: "rotate",
  x: "rotate",
  Enter: "power",
  p: "pause",
  r: "reset",
  m: "sound",
};

document.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const command = keyCommands[key];
  if (!command) return;
  event.preventDefault();
  if (event.repeat && !directional.has(command)) return;
  game.command(command);
});

// Losing focus mid-press never delivers a pointerup, so a held direction would
// otherwise keep repeating after the app is backgrounded.
window.addEventListener("blur", clearAllHolds);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearAllHolds();
  game.autoPause();
});
window.addEventListener("pagehide", () => {
  clearAllHolds();
  game.persist();
});
