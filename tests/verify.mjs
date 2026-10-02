// End-to-end self-test for The Giggle Music Garden.
//
// Starts the Vite dev server (unless GARDEN_URL is set), opens the game in
// headless Chromium with a real touch screen and the strict "user gesture
// required" autoplay policy, and checks:
//   1. sound unlocking  - no AudioContext before Play, running after Play,
//                         real signal at the output, silent (but still animated) when muted
//   2. touch            - tapping each instrument's on-screen position plays that instrument
//   3. pattern playback - the firefly demonstrates the pattern in order, slowly
//   4. matching         - wrong tap => normal sound + gentle re-demo (no failure screen),
//                         right taps => dancing flower; three-note patterns appear;
//                         easy mode stays at two; three patterns => band celebration => Replay
//
// Usage:  npm run verify            (screenshots land in ./screenshots)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

let server = null;
let url = process.env.GARDEN_URL;
if (!url) {
  const port = 5199;
  url = `http://localhost:${port}/`;
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('Local')) { clearTimeout(timer); resolve(); } });
    server.on('exit', (c) => reject(new Error('vite exited ' + c)));
  });
}

let failures = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launchArgs = ['--autoplay-policy=user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ args: launchArgs, executablePath });

async function openGame(viewport, { mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__garden);
  return { ctx, page, errors };
}
const G = (page, fn, arg) => page.evaluate(fn, arg);
async function tapInstrument(page, id, part = null) {
  const p = await G(page, ([i, pt]) => window.__garden.screenPos(i, pt), [id, part]);
  await page.touchscreen.tap(p.x, p.y);
}
async function waitPhase(page, phases, timeout = 20000) {
  const list = [].concat(phases);
  await page.waitForFunction((l) => l.includes(window.__garden.phase), list, { timeout, polling: 50 });
}
async function peakAfter(page, fn, ms = 500) {
  await G(page, () => window.__garden.resetPeak());
  await fn();
  await sleep(ms);
  return G(page, () => window.__garden.peak);
}

try {
  /* ------------------------------------------------------------------ */
  console.log('\n== 1. Sound unlocking (tablet landscape) ==');
  const { ctx, page, errors } = await openGame({ width: 1180, height: 820 });
  await sleep(800);
  ok((await G(page, () => window.__garden.audioState())) === 'none', 'no AudioContext exists before Play');
  // tapping the scene before Play must not start audio either
  await page.touchscreen.tap(600, 700);
  await sleep(200);
  ok((await G(page, () => window.__garden.audioState())) === 'none', 'touching the start screen does not create audio');
  await page.screenshot({ path: `${SHOTS}/01-start.png` });

  await page.locator('#btnPlay').tap({ force: true });
  await page.waitForFunction(() => window.__garden.audioState() === 'running', null, { timeout: 5000 });
  ok(true, 'AudioContext is running right after Play');
  ok(await page.locator('#menu').evaluate((el) => !el.classList.contains('hidden')), 'mode pictures appear after Play');
  await sleep(900);
  await page.screenshot({ path: `${SHOTS}/02-menu.png` });

  /* ------------------------------------------------------------------ */
  console.log('\n== 2. Free Play + touch ==');
  await page.locator('#btnFree').tap({ force: true });
  await sleep(600);
  const ids = await G(page, () => window.__garden.ids());
  for (const id of ids) {
    const before = await G(page, () => window.__garden.playLog.length);
    const peak = await peakAfter(page, () => tapInstrument(page, id), 450);
    const entry = await G(page, (n) => window.__garden.playLog[n], before);
    ok(entry && entry.id === id && entry.source === 'tap', `touch on ${id} plays ${id}`, `peak=${peak.toFixed(3)}`);
    ok(peak > 0.01 && peak < 0.9, `  ${id} is audible but gentle`);
  }
  // xylophone bars are individually playable
  for (const bar of [0, 4]) {
    const before = await G(page, () => window.__garden.playLog.length);
    await tapInstrument(page, 'xylo', bar);
    await sleep(120);
    const e = await G(page, (n) => window.__garden.playLog[n], before);
    ok(e && e.id === 'xylo' && e.part === bar, `xylophone bar ${bar} plays its own note`);
  }
  // multi-touch: two fingers at once both play
  {
    const a = await G(page, () => window.__garden.screenPos('drumRed'));
    const b = await G(page, () => window.__garden.screenPos('bellBlue'));
    const before = await G(page, () => window.__garden.playLog.length);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
    const got = (await G(page, (n) => window.__garden.playLog.slice(n).map((e) => e.id), before)).sort().join(',');
    ok(got === 'bellBlue,drumRed', 'two-finger tap plays both instruments', got);
  }
  // a near-miss still counts (oversized / forgiving hit areas)
  {
    const p = await G(page, () => window.__garden.screenPos('drumPurple'));
    const before = await G(page, () => window.__garden.playLog.length);
    await page.touchscreen.tap(p.x + 95, p.y + 40);
    await sleep(120);
    const e = await G(page, (n) => window.__garden.playLog[n], before);
    ok(e && e.id === 'drumPurple', 'a tap beside the purple mushroom still plays it');
  }
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/03-free-play.png` });

  // mute: silent output, but animation/particles still happen
  await page.locator('#btnMute').tap({ force: true });
  await sleep(300);
  const glowBefore = await G(page, () => window.__garden.glow.bellYellow);
  // (Chrome's analyser keeps its last buffer once its input goes silent, so check the master gain itself.)
  const mutedLog = await G(page, () => window.__garden.playLog.length);
  await tapInstrument(page, 'bellYellow');
  await sleep(300);
  const glowAfter = await G(page, () => window.__garden.glow.bellYellow);
  const parts = await G(page, () => window.__garden.particles);
  const gain = await G(page, () => window.__garden.outputGain);
  const mutedEntry = await G(page, (n) => window.__garden.playLog[n], mutedLog);
  ok(gain < 0.001 && mutedEntry && mutedEntry.muted, 'muted: master output gain is silent', `gain=${gain.toFixed(5)}`);
  ok(glowAfter > glowBefore && glowAfter > 0.3 && parts > 3, 'muted: the bell still glows and makes petals/bubbles', `glow=${glowAfter} particles=${parts}`);
  await page.screenshot({ path: `${SHOTS}/04-muted-visuals.png` });
  await page.locator('#btnMute').tap({ force: true });
  await sleep(200);
  const unmutedPeak = await peakAfter(page, () => tapInstrument(page, 'bellYellow'), 400);
  ok(unmutedPeak > 0.01, 'unmuted: sound is back', `peak=${unmutedPeak.toFixed(3)}`);

  /* ------------------------------------------------------------------ */
  console.log('\n== 3. Copy the Firefly: pattern playback ==');
  await page.locator('#btnHome').tap({ force: true });
  await sleep(500);
  await page.locator('#btnCopy').tap({ force: true });
  await waitPhase(page, 'demo', 8000);
  const pattern1 = await G(page, () => window.__garden.pattern);
  ok(pattern1.length === 2, 'first pattern has two notes', pattern1.join(' → '));
  const demoStart = await G(page, () => window.__garden.time);
  await sleep(2600);
  await page.screenshot({ path: `${SHOTS}/05-firefly-demo.png` });
  await waitPhase(page, 'listen', 15000);
  const demoPlays = await G(page, (t0) => window.__garden.playLog.filter((e) => e.source === 'demo' && e.t >= t0), demoStart);
  ok(JSON.stringify(demoPlays.map((e) => e.id)) === JSON.stringify(pattern1), 'firefly plays the pattern in order', demoPlays.map((e) => e.id).join(' → '));
  const gap = demoPlays.length > 1 ? demoPlays[1].t - demoPlays[0].t : 0;
  ok(gap >= 2.0, 'demonstration is slow (≥2 s between notes)', `gap=${gap.toFixed(2)}s`);
  ok(await page.locator('#hand').evaluate((el) => el.classList.contains('show')), 'tap-hand picture invites the child');
  await page.screenshot({ path: `${SHOTS}/06-your-turn.png` });

  console.log('\n== 4. Matching ==');
  // unexpected tap
  const wrong = ids.find((i) => i !== pattern1[0]);
  const demosBefore = await G(page, () => window.__garden.demoCount);
  const nBefore = await G(page, () => window.__garden.playLog.length);
  const wrongPeak = await peakAfter(page, () => tapInstrument(page, wrong), 300);
  const wrongEntry = await G(page, (n) => window.__garden.playLog[n], nBefore);
  ok(wrongEntry && wrongEntry.id === wrong && wrongPeak > 0.01, `unexpected tap (${wrong}) still makes its friendly sound`);
  ok(['oops', 'demo'].includes(await G(page, () => window.__garden.phase)), 'no failure state: firefly is getting ready to show again');
  await page.waitForFunction((d) => window.__garden.demoCount > d, demosBefore, { timeout: 5000 });
  ok(true, 'firefly gently demonstrates the same pattern again');
  ok(JSON.stringify(await G(page, () => window.__garden.pattern)) === JSON.stringify(pattern1), '  …with the same pattern');
  await waitPhase(page, 'listen', 15000);

  // correct taps
  for (const id of pattern1) { await tapInstrument(page, id); await sleep(350); }
  await page.waitForFunction(() => window.__garden.bandCount >= 1, null, { timeout: 5000 });
  ok(true, 'completing a pattern adds a dancing flower to the band');
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/07-first-flower.png` });

  // pattern 2: after a pattern with a mistake it stays at 2; play it cleanly
  await waitPhase(page, 'listen', 20000);
  const pattern2 = await G(page, () => window.__garden.pattern);
  ok(pattern2.length === 2, 'after a bumpy pattern the next one stays at two notes', pattern2.join(' → '));
  for (const id of pattern2) { await tapInstrument(page, id); await sleep(350); }
  await page.waitForFunction(() => window.__garden.bandCount >= 2, null, { timeout: 5000 });

  // pattern 3: after a clean pattern it grows to 3
  await waitPhase(page, 'listen', 25000);
  const pattern3 = await G(page, () => window.__garden.pattern);
  ok(pattern3.length === 3, 'after a smooth pattern a three-note pattern appears', pattern3.join(' → '));
  for (const id of pattern3) { await tapInstrument(page, id); await sleep(350); }
  await page.waitForFunction(() => window.__garden.bandCount >= 3, null, { timeout: 5000 });
  ok(true, 'third pattern adds the third band flower');

  // celebration: the band plays and the child can join in
  await waitPhase(page, 'celebrate', 6000);
  const celebStart = await G(page, () => window.__garden.time);
  await sleep(2500);
  const joinBefore = await G(page, () => window.__garden.playLog.length);
  await tapInstrument(page, 'drumRed');
  await sleep(150);
  const joined = await G(page, (n) => window.__garden.playLog.slice(n).some((e) => e.id === 'drumRed' && e.source === 'tap'), joinBefore);
  ok(joined, 'child can join the celebration by tapping');
  await page.screenshot({ path: `${SHOTS}/08-celebration.png` });
  await waitPhase(page, 'replay', 15000);
  const songNotes = await G(page, (t0) => window.__garden.playLog.filter((e) => e.source === 'song' && e.t >= t0).length, celebStart);
  ok(songNotes >= 30, 'garden band plays a short celebration song', `${songNotes} notes`);
  ok(await page.locator('#btnReplay').evaluate((el) => !el.classList.contains('hidden')), 'Replay button appears');
  await page.screenshot({ path: `${SHOTS}/09-replay.png` });
  await page.locator('#btnReplay').tap({ force: true });
  await waitPhase(page, 'demo', 6000);
  const fresh = await G(page, () => window.__garden.pattern);
  ok(fresh.length === 2, 'Replay starts again with a new easy two-note pattern', fresh.join(' → '));
  await page.waitForFunction(() => window.__garden.bandCount === 0, null, { timeout: 4000 });
  ok(true, 'band resets for the new round');

  ok(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();

  /* ------------------------------------------------------------------ */
  console.log('\n== 5. Easy mode + reduced motion (phone portrait) ==');
  {
    const { ctx, page, errors } = await openGame({ width: 390, height: 844 });
    await page.locator('#btnPlay').tap({ force: true });
    await page.waitForFunction(() => window.__garden.audioState() === 'running', null, { timeout: 5000 });
    await page.locator('#btnEasy').tap({ force: true });
    await page.locator('#btnMotion').tap({ force: true });
    const s = await G(page, () => window.__garden.settings);
    ok(s.easy && s.reduced, 'easy mode and calm motion toggle on');
    await page.locator('#btnCopy').tap({ force: true });
    const lengths = [];
    for (let round = 0; round < 3; round++) {
      await waitPhase(page, 'listen', 25000);
      const p = await G(page, () => window.__garden.pattern);
      lengths.push(p.length);
      if (round === 0) await page.screenshot({ path: `${SHOTS}/10-phone-your-turn.png` });
      for (const id of p) { await tapInstrument(page, id); await sleep(300); }
      await page.waitForFunction((n) => window.__garden.bandCount >= n, round + 1, { timeout: 5000 });
    }
    ok(lengths.every((l) => l === 2), 'easy mode keeps every pattern at two notes', lengths.join(','));
    await waitPhase(page, 'celebrate', 6000);
    await sleep(1500);
    await page.screenshot({ path: `${SHOTS}/11-phone-celebration.png` });
    // settings persist across reloads
    await page.reload();
    await page.waitForFunction(() => !!window.__garden);
    const s2 = await G(page, () => window.__garden.settings);
    ok(s2.easy && s2.reduced, 'settings are remembered after reload');
    ok(errors.length === 0, 'no page errors (phone)', errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error('FAIL  test crashed:', e);
} finally {
  await browser.close();
  if (server) server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
