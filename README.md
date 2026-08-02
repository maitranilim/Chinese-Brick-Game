# Chinese Brick Game 9999

> A small Android game project by [maitranilim](https://github.com/maitranilim).

This is my code version of the old **9999-in-1 Brick Game** handheld. I wanted it to feel like the one we all saw as kids: green LCD screen, tiny dark blocks, ghost pixels, simple buttons, and instant gameplay.

There are no image files and no game engine here. The whole screen is drawn with code, one LCD cell at a time.

## What is inside

- 10 named games with 3 difficulty levels each
- Falling blocks, Snake, Breakout, Tank Attack, Car Dodge, and Racing
- 1 to 9999 game selector, just like the real handheld
- Current score and best score for every game number
- Old LCD look with faint inactive cells always visible
- On-screen buttons plus keyboard controls
- Simple square-wave sounds, no samples
- Portrait-ready Capacitor setup for Android

The real 9999-in-1 handhelds did **not** have 9,999 separate games. They had a few game types with many speed and layout changes. This project follows that idea honestly.

## Play

- On the game selector, use **LEFT/RIGHT** to change the game number and **UP/DOWN** to choose level 1, 2, or 3.
- Press **ROTATE** to start.
- During a game, use the D-pad to move.
- **ROTATE** rotates blocks, fires in Tank Attack, or starts a game.
- **ON/OFF** powers the handheld, **SOUND** toggles audio, **S/P** pauses, and **RESET** starts the selected game again.

Keyboard controls: arrow keys, Space or Z, Enter, P, R, and M.

## Run it

```bash
npm install
npm run build
```

For Android:

```bash
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

The Android app is locked to portrait mode.

## Creator

Created by [maitranilim](https://github.com/maitranilim).

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for the contributor list.
