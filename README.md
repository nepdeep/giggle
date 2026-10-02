# The Giggle Music Garden

A gentle, colorful 3D musical playground for a five-year-old, built with Three.js, the Web Audio API and Vite.
The whole game (markup, styles, 3D scene, sounds, game logic) is in **one file: `index.html`**. Every model, texture and sound is generated in code; there are no image or audio assets.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also shown on your network, so you can open it on a tablet)
```

Make a single self-contained file (Three.js inlined, works offline, even opened by double-click):

```bash
npm run build      # -> dist/index.html  (~620 KB, ~160 KB gzipped)
npm run preview    # optional: serve the build
```

`index.html` also includes an import map, so with internet access you can serve it from any static server (for example `npx serve .`) without Vite. Three.js then loads from unpkg.

## Self-test

```bash
npm run verify                                               # tests the dev build
GARDEN_URL="file://$PWD/dist/index.html" npm run verify     # tests the single-file build
```

The test opens headless Chromium with a touch screen and the strict "user gesture required" autoplay policy. It runs 47 checks and saves screenshots to `screenshots/`. If you have never used Playwright on your machine, run `npx playwright install chromium` once first.

| Area | What is checked |
| --- | --- |
| Sound unlocking | No AudioContext exists before Play (touching the start screen doesn't create one); it is running right after Play; every instrument produces real output that stays gentle (peak about 0.1–0.26); muting sets the master gain to 0 while the glow, petals and bubbles still play. |
| Touch | A tap on each instrument plays that instrument. Single xylophone bars play their own notes. A two-finger tap plays both instruments. A tap *beside* a mushroom still counts. |
| Pattern playback | The firefly plays the pattern in order and slowly (about 2.5 s per note), then the tapping hand appears. |
| Matching | A wrong tap still makes its normal sound, and then the firefly shows the *same* pattern again (no failure state). Correct taps add a band flower. A pattern finished after a mistake keeps the next one at 2 notes, and a smooth one moves it up to 3. After 3 patterns there is a celebration song (39 notes) that the child can tap along with. Replay starts a fresh 2-note round. Easy mode keeps every pattern at 2. Settings survive a reload. |

## How to play

1. **Play** (the big green button) starts the sound. Audio is only created here.
2. Pick a picture:
   - **Free Play** (flower and mushroom): tap anything. Every tap plays a note or a soft drum and a funny animation.
   - **Copy the Firefly** (firefly with a dotted path): the firefly slowly lights up instruments, then a tapping hand asks the child to copy them. Dots at the bottom show how many notes there are and fill in as the child matches them.
3. Each finished pattern adds a dancing flower to the band on the hill. After three, the band plays a short song (the child can join in), then a big **Replay** arrow appears.

There is no reading, no timer and no "wrong" screen. If the child taps a different instrument, they hear its normal sound and the firefly simply shows the pattern again. If nobody taps for a while, or the child taps the firefly, it shows the pattern again too.

### The garden

| Instrument | Sound | Funny animation |
| --- | --- | --- |
| 3 giant flower bells (pink, yellow, blue) | bell tones G4, C5, E5 | swing, squish, stretch; sing with an "O" mouth; drop petals |
| Red and purple mushroom drums | soft tuned drums (C3, G3) | cap squashes and hops, dots pop, ring ripples on the grass |
| Frog xylophone (5 bars) | C5 D5 E5 G5 A5 | frog swings a mallet and puffs its throat; tap the frog for a ribbit, a tongue flick and a little run of notes |
| 3 dancing seeds | soft shaker and a tiny giggle | dance all the time; the tapped seed jumps and spins and the others hop |

Every melodic note is in **C-major pentatonic**, so random tapping always sounds pleasant. Notes and petals float up as bubbles in every mode.

### Grown-up buttons (top right)

- **Dots (●●● / ●●)**: easy mode, which keeps patterns at two notes.
- **Snail**: calm motion. Movement is smaller and slower, there are fewer particles, nothing spins and the clouds stop drifting. This starts on automatically if the device asks for reduced motion.
- **Speaker**: mute. All visual feedback still happens.

These settings are remembered on the device. The house button (top left) goes back to the pictures.

## Design notes

- **Fixed camera.** There are two hand-tuned arrangements, one for wide screens (tablets in landscape, desktops) and one for tall screens (phones), and the field of view widens so the garden always fits.
- **Oversized hit areas.** Each instrument has invisible hit shapes larger than it looks. A tap that misses them still plays the nearest instrument within about 13% of the screen, and taps on empty grass make sparkles. Multi-touch works.
- **Gentle audio.** Sound goes through a soft low-pass filter, a compressor and a low master volume. Voices are capped. Audio suspends when the tab is hidden and resumes on return or on the next tap (this covers iOS).
- **Performance.** Toon-shaded low-poly models, shadows only on larger shapes, and adaptive resolution: slow devices lower the pixel ratio instead of the frame rate.
- `window.__garden` exposes read-only state for the self-test.
