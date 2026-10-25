// CHRONO-GRID: the contribution graph reforms into a clock, Pong is played inside the
// digits, every lit pixel keeps the brightness of the real day it was, and the block of
// contributions on the right folds into a Rubik's cube that scrambles and solves itself.
//
// One canvas, 53 x 7 cells (26 x 7 on narrow screens). The same Pong simulation and the same
// cube story that are baked into the README animation run here live, and the visitor can take
// a paddle or drag the cube around.

import { layoutText } from '../lib/font5x7.mjs';
import { Pong } from '../lib/pong.mjs';
import { zoneParts, pad2, monthName, dateLabel } from '../lib/timeutil.mjs';
import { bayLayout, cellDelay, GAME, STORY } from '../lib/cellcube.mjs';
import { clamp, hex, roundRectPath, fitCanvas, glowSprite } from './util.js';
import { CellCube } from './cellcube-view.js';

const ROWS = 7;
const ACT = ['#15223b', '#0e4f3a', '#12805a', '#26c281', '#6dffb4'].map(hex);
const CLK = ['#3596c0', '#45bde3', '#72dff0', '#bdfbf2', '#fff3c2'].map(hex);
const GLOW = [0.34, 0.46, 0.62, 0.82, 1];
const BG = hex('#070b14');
const DEAD = hex('#0b1220');
const BALL = hex(GAME.ball);
const MORPH = 0.9; // seconds one cell takes to change
const WAVE = STORY.wave; // seconds for the change to sweep across the graph
const LOOP = 32; // auto-play loop
const CLOCK_IN = 6.5;
const CLOCK_OUT = 26;
const CUBE_FILL = 1.25; // the cube is this many rows tall
const FONT = '600 9px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class ChronoGrid {
  constructor({ canvas, tip, app }) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.tipEl = tip;
    this.app = app;
    this.mode = app.reduced ? 'activity' : 'auto'; // 'auto' | 'activity' | 'clock'
    this.zone = app.zones.you;
    this.shown = null;
    this.t = 0;
    this.autoT = 0;
    this.want = 0;
    this.clockSince = 0;
    this.playAlpha = 0;
    this.compact = null;
    this.story = null; // 'both' (clock + cube) | 'clock' | 'cube'
    this.hover = -1;
    this.rings = [];
    this.trail = [];
    this.playerY = [3.5, 3.5];
    this.playerUntil = [0, 0];
    this.keys = new Set();
    this.dragFrom = null;
    this.sprites = CLK.map((c) => glowSprite(c));
    this.ballSprite = glowSprite(hex(GAME.hot));
    this.cube = new CellCube({ reduced: app.reduced });
    this.scoreKey = '';
    this.lastStr = '';
    this.wave = null;
    this.weeksAll = app.data.contrib.weeks;
    this.total = app.data.contrib.total;
    this.bind();
    this.resize();
  }

  // ---------------------------------------------------------------- public
  setMode(mode) {
    this.mode = mode;
    this.app.emit('gridmode', this);
  }

  setZone(zone) {
    this.zone = zone;
    this.lastStr = '';
  }

  /** What the grid is currently showing, for labels and tests. */
  get view() {
    const clock = this.want === 1;
    return { clock, zone: clock ? this.shown : null, mode: this.mode, morph: this.mMean, cube: this.cube.want === 1 && this.cube.formed > 0.9, story: this.story };
  }

  // ---------------------------------------------------------------- layout
  build() {
    const weeks = this.compact ? this.weeksAll.slice(-26) : this.weeksAll;
    this.cols = weeks.length;
    const n = this.cols * ROWS;
    this.cells = new Array(n).fill(null);
    weeks.forEach((week, i) => {
      for (const d of week) this.cells[i * ROWS + new Date(d.d + 'T00:00:00Z').getUTCDay()] = d;
    });
    this.act = new Array(n);
    this.off = new Array(n);
    this.on = new Array(n);
    this.lvl = new Uint8Array(n);
    this.visibleTotal = 0;
    for (let ci = 0; ci < n; ci++) {
      const d = this.cells[ci];
      const l = d ? d.l : 0;
      this.lvl[ci] = l;
      this.visibleTotal += d ? d.c : 0;
      this.act[ci] = ACT[l];
      this.off[ci] = l === 0 ? DEAD : mixc(ACT[l], BG, 0.74);
      this.on[ci] = CLK[l];
    }
    this.m = new Float32Array(n).fill(this.want);
    this.lit = new Float32Array(n);
    this.litT = new Float32Array(n);
    this.startAt = new Float32Array(n);
    this.colon = new Uint8Array(n);
    this.bayIndex = new Int16Array(n).fill(-1); // cell -> index in the cube's bay, or -1
    this.months = [];
    let prev = -1;
    let last = -9;
    weeks.forEach((week, i) => {
      const m = +week[0].d.slice(5, 7);
      if (m !== prev && i - last >= 3) {
        this.months.push([i, monthName(m)]);
        last = i;
      }
      prev = m;
    });
    this.story = null;
    this.useStory(this.compact ? 'clock' : 'both');
  }

  /**
   * Splits the graph for a story: the clock and its court on the left, the cube's bay on the
   * right ('both'); the clock alone, on narrow screens ('clock'); or the whole graph as the
   * bay ('cube', narrow screens on every other auto loop).
   */
  useStory(story) {
    this.story = story;
    const cols = this.cols;
    const colonGap = this.compact ? 1 : 2;
    const width = layoutText('00:00', { gap: 1, colonGap }).width;
    let lay = null;
    if (story === 'cube') {
      lay = { clock: false, colonGap, court: null, clockOff: 0, bay: { c0: 0, c1: cols }, center: { x: cols / 2, y: ROWS / 2 } };
    } else {
      const plan = story === 'both' ? bayLayout({ cols, rows: ROWS, clockWidth: width }) : null;
      lay = plan
        ? { clock: true, colonGap, court: plan.court, clockOff: plan.clockOff, bay: plan.bay, center: plan.center }
        : { clock: true, colonGap, court: { x: 0, w: cols, paddleX: [1, cols - 1] }, clockOff: Math.floor((cols - width) / 2), bay: null, center: null };
    }
    this.lay = lay;
    this.lastStr = '';
    this.pong = lay.court ? this.newPong() : null;
    this.placeCube();
  }

  /** Tells the cube which cells are its bay, and where on the page it stands. */
  placeCube() {
    if (!this.pitch) return;
    const { bay, center } = this.lay;
    const { x0, y0, pitch } = this;
    this.bayIndex.fill(-1);
    const cells = [];
    if (bay) {
      for (let col = bay.c0; col < bay.c1; col++) {
        for (let row = 0; row < ROWS; row++) {
          const ci = col * ROWS + row;
          const d = this.cells[ci];
          if (!d) continue;
          this.bayIndex[ci] = cells.length;
          cells.push({ ci, x: x0 + (col + 0.5) * pitch, y: y0 + (row + 0.5) * pitch, rgb: this.act[ci], delay: cellDelay(col, row, this.cols), count: d.c });
        }
      }
    }
    this.cube.layout(cells, {
      cx: center ? x0 + center.x * pitch : 0,
      cy: center ? y0 + center.y * pitch : 0,
      height: ROWS * pitch * CUBE_FILL,
      size: this.cell,
      pitch,
    });
  }

  newPong() {
    const court = this.lay.court;
    const k = Math.sqrt(court.w / 53);
    return new Pong({
      w: court.w,
      h: ROWS,
      seed: (Math.random() * 1e6) | 0,
      speed: 24 * k,
      maxSpeed: 38 * k,
      missRate: 0.18,
      paddleX: court.paddleX,
    });
  }

  resize() {
    const W = this.canvas.clientWidth || 640;
    const compact = W < 560;
    if (compact !== this.compact) {
      this.compact = compact;
      this.build();
    }
    const pad = clamp(W * 0.018, 8, 22);
    this.pitch = Math.min(26, (W - 2 * pad) / this.cols);
    this.cell = this.pitch * 0.8;
    this.x0 = (W - this.cols * this.pitch) / 2;
    this.y0 = 26;
    const H = Math.ceil(this.y0 + ROWS * this.pitch + 24);
    this.canvas.style.height = `${H}px`;
    const { dpr } = fitCanvas(this.canvas);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.placeCube();
  }

  // ---------------------------------------------------------------- input
  bind() {
    const c = this.canvas;
    const endDrag = () => {
      if (!this.dragFrom) return;
      this.dragFrom = null;
      this.cube.endDrag();
    };
    c.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
      const r = c.getBoundingClientRect();
      if (this.cube.hit(e.clientX - r.left, e.clientY - r.top)) {
        this.dragFrom = { x: e.clientX, y: e.clientY };
        this.cube.beginDrag();
        try {
          c.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is already gone */
        }
      }
    });
    c.addEventListener('pointerup', (e) => {
      endDrag();
      const d = this.down;
      this.down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && performance.now() - d.t < 700) this.app.onGridClick();
    });
    c.addEventListener('pointercancel', () => {
      this.down = null;
      endDrag();
    });
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerleave', () => {
      this.hover = -1;
      this.tipEl.hidden = true;
      c.classList.remove('over-cube');
    });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.app.onGridClick();
      } else if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
      }
    });
    c.addEventListener('keyup', (e) => this.keys.delete(e.code));
    c.addEventListener('blur', () => this.keys.clear());
  }

  onMove(e) {
    if (this.dragFrom) {
      this.cube.dragBy(e.clientX - this.dragFrom.x, e.clientY - this.dragFrom.y);
      this.dragFrom = { x: e.clientX, y: e.clientY };
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const overCube = this.cube.hit(x, y);
    this.canvas.classList.toggle('over-cube', overCube);
    const court = this.lay.court;
    if (this.playAlpha > 0.3 && court && !overCube) {
      const mid = this.x0 + (court.x + court.w / 2) * this.pitch;
      const edge = this.x0 + (court.x + court.w) * this.pitch + this.pitch;
      if (x < edge) {
        const side = x < mid ? 0 : 1;
        this.playerY[side] = clamp((y - this.y0) / this.pitch, 0, ROWS);
        this.playerUntil[side] = this.t + 2.4;
      }
    }
    const col = Math.floor((x - this.x0) / this.pitch);
    const row = Math.floor((y - this.y0) / this.pitch);
    if (!overCube && col >= 0 && col < this.cols && row >= 0 && row < ROWS && this.cells[col * ROWS + row]) {
      this.hover = col * ROWS + row;
    } else {
      this.hover = -1;
      this.tipEl.hidden = true;
    }
  }

  // ---------------------------------------------------------------- simulation
  setWant(want) {
    this.want = want;
    const reduced = this.app.reduced;
    for (let i = 0; i < this.cols; i++) {
      for (let j = 0; j < ROWS; j++) {
        this.startAt[i * ROWS + j] = reduced ? -1 : this.t + cellDelay(i, j, this.cols);
      }
    }
    this.wave = { t0: this.t, dir: want };
    if (want) {
      this.clockSince = this.t;
      if (this.lay.court) this.pong = this.newPong();
      this.trail.length = 0;
      this.rings.length = 0;
    }
    this.cube.setWant(want, this.t, `live-${Math.floor(this.app.clock.now().getTime() / 60000)}`);
  }

  /** Narrow screens: the clock, then (on the next auto loop) the cube; wide screens: both at once. */
  pickStory() {
    const wanted = this.compact ? (this.mode === 'auto' && Math.floor(this.autoT / LOOP) % 2 === 1 ? 'cube' : 'clock') : 'both';
    if (wanted !== this.story) this.useStory(wanted);
  }

  layoutClock(parts) {
    const str = this.lay.clock ? `${pad2(parts.hour)}:${pad2(parts.minute)}` : '';
    if (str === this.lastStr) return;
    this.lastStr = str;
    this.litT.fill(0);
    this.colon.fill(0);
    if (!str) return;
    const lay = layoutText(str, { gap: 1, colonGap: this.lay.colonGap });
    const off = this.lay.clockOff;
    const colons = new Set(lay.glyphs.filter((g) => g.ch === ':').map((g) => g.x));
    for (const [x, y] of lay.cells) {
      const c = off + x;
      if (c < 0 || c >= this.cols) continue;
      this.litT[c * ROWS + y] = 1;
      if (colons.has(x)) this.colon[c * ROWS + y] = 1;
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const reduced = this.app.reduced;

    let want;
    let zone;
    if (this.mode === 'auto') {
      this.autoT += dt;
      const a = this.autoT % LOOP;
      want = a >= CLOCK_IN && a < CLOCK_OUT ? 1 : 0;
      zone = this.app.zones.home;
    } else {
      want = this.mode === 'clock' ? 1 : 0;
      zone = this.zone;
    }
    if (zone !== this.shown) {
      this.shown = zone;
      this.lastStr = '';
    }
    if (want !== this.want) {
      if (want) this.pickStory();
      this.setWant(want);
    }

    const parts = zoneParts(this.app.clock.now(), this.shown.tz);
    this.parts = parts;
    this.layoutClock(parts);

    const n = this.cols * ROWS;
    const md = reduced ? 1 : dt / MORPH;
    const lk = Math.min(1, dt * 11);
    let sum = 0;
    for (let ci = 0; ci < n; ci++) {
      if (this.t >= this.startAt[ci]) {
        this.m[ci] = this.want ? Math.min(1, this.m[ci] + md) : Math.max(0, this.m[ci] - md);
      }
      this.lit[ci] += (this.litT[ci] - this.lit[ci]) * lk;
      sum += this.m[ci];
    }
    this.mMean = sum / n;

    // on a timer the cube solves once per showing; otherwise it keeps scrambling while the clock is up
    this.cube.cycling = this.mode !== 'auto';
    this.cube.update(dt, this.t);

    const playing = this.want === 1 && !!this.pong && this.t - this.clockSince > WAVE + MORPH + 0.4;
    this.playAlpha = clamp(this.playAlpha + (playing ? dt * 2.5 : -dt * 3), 0, 1);
    if (this.playAlpha > 0.01 && this.pong) this.stepPong(dt);
    this.canvas.classList.toggle('playing', this.playAlpha > 0.5);
  }

  stepPong(dt) {
    const p = this.pong;
    for (let side = 0; side < 2; side++) {
      const up = side === 0 ? 'KeyW' : 'ArrowUp';
      const dn = side === 0 ? 'KeyS' : 'ArrowDown';
      if (this.keys.has(up) || this.keys.has(dn)) {
        this.playerY[side] = clamp(this.playerY[side] + ((this.keys.has(dn) ? 1 : 0) - (this.keys.has(up) ? 1 : 0)) * 22 * dt, 0, ROWS);
        this.playerUntil[side] = this.t + 2.4;
      }
      p.player[side] = this.t < this.playerUntil[side] ? this.playerY[side] : null;
    }
    p.step(dt);
    const sideColor = (side) => (side === 0 ? GAME.past : GAME.future);
    for (const e of p.events) {
      if (e.type === 'hit') this.rings.push({ x: e.x, y: e.y, t0: this.t, r: 1, color: sideColor(e.side) });
      else if (e.type === 'wall') this.rings.push({ x: e.x, y: e.y, t0: this.t, r: 0.6, color: GAME.hot });
      else if (e.type === 'score') this.rings.push({ x: e.x, y: e.y, t0: this.t, r: 2.2, color: sideColor(e.side) });
    }
    p.events.length = 0;
    if (Math.max(...p.score) >= 9) {
      const who = p.score[0] > p.score[1] ? 'PAST' : 'FUTURE';
      this.app.toast(`${who} WINS ${Math.max(...p.score)}–${Math.min(...p.score)}. THE NEXT SERVE IS ALREADY IN THE AIR.`);
      p.score[0] = p.score[1] = 0;
    }
    const b = p.snapshot().ball;
    this.trail.unshift([b.x, b.y]);
    if (this.trail.length > 12) this.trail.pop();
    this.rings = this.rings.filter((r) => this.t - r.t0 < 0.7);
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    const g = this.g;
    const { W, H, dpr, pitch, cell, x0, y0, cols } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const mm = this.mMean;
    const court = this.lay.court;
    const bayAt = (ci) => this.bayIndex[ci];

    // month ticks (activity view)
    if (mm < 0.97) {
      g.globalAlpha = 1 - mm;
      g.fillStyle = '#51648c';
      g.font = FONT;
      g.textBaseline = 'alphabetic';
      for (const [i, name] of this.months) g.fillText(name, x0 + i * pitch + 1, y0 - 9);
      g.globalAlpha = 1;
    }

    const ball = this.playAlpha > 0.01 && this.pong ? this.pong.snapshot().ball : null;
    const bx = ball ? court.x + ball.x : 0;
    const by = ball ? ball.y : 0;
    const R = cell * 0.2;

    // cells (the bay's are drawn by the cube)
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < ROWS; j++) {
        const ci = i * ROWS + j;
        if (bayAt(ci) >= 0) continue;
        const m = this.m[ci];
        const a = this.act[ci];
        const o = this.off[ci];
        const nn = this.on[ci];
        const L = this.lit[ci];
        let r = a[0] + (o[0] + (nn[0] - o[0]) * L - a[0]) * m;
        let gg = a[1] + (o[1] + (nn[1] - o[1]) * L - a[1]) * m;
        let b = a[2] + (o[2] + (nn[2] - o[2]) * L - a[2]) * m;
        if (ball && L > 0.05) {
          const d2 = (i + 0.5 - bx) ** 2 + (j + 0.5 - by) ** 2;
          const boost = Math.exp(-d2 / 7) * this.playAlpha * L;
          r += (BALL[0] - r) * boost * 0.7;
          gg += (BALL[1] - gg) * boost * 0.7;
          b += (BALL[2] - b) * boost * 0.7;
        }
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        roundRectPath(g, x0 + i * pitch + (pitch - cell) / 2, y0 + j * pitch + (pitch - cell) / 2, cell, cell, R);
        g.fill();
      }
    }

    // the bay: contributions, or the cube they fold into
    if (this.cube.cells.length) this.cube.draw(g, dpr, this.t);

    // glow of the lit digit pixels: the busier the day, the brighter it burns
    g.globalCompositeOperation = 'lighter';
    const t = this.t;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < ROWS; j++) {
        const ci = i * ROWS + j;
        const L = this.lit[ci];
        const m = this.m[ci];
        const lvl = this.lvl[ci];
        const bi = bayAt(ci);
        let ga = m * L * GLOW[lvl];
        if (bi < 0 && ga > 0.02) {
          if (this.colon[ci]) ga *= 0.65 + 0.35 * Math.sin(t * 6.2);
          let rad = pitch * (1.05 + lvl * 0.2);
          if (ball) {
            const boost = Math.exp(-((i + 0.5 - bx) ** 2 + (j + 0.5 - by) ** 2) / 7) * this.playAlpha;
            ga *= 1 + 0.9 * boost;
            rad *= 1 + 0.4 * boost;
          }
          g.globalAlpha = Math.min(1, ga * 0.9);
          g.drawImage(this.sprites[lvl], x0 + (i + 0.5) * pitch - rad, y0 + (j + 0.5) * pitch - rad, rad * 2, rad * 2);
        } else if (m < 0.5 && lvl >= 3 && (bi < 0 || this.cube.fold[bi] < 0.01)) {
          // quiet shimmer on the busiest days of the real graph
          g.globalAlpha = 0.16 * (1 - m * 2) * (0.7 + 0.3 * Math.sin(t * 1.3 + i * 0.7 + j));
          const rad = pitch * 0.95;
          g.drawImage(this.sprites[lvl], x0 + (i + 0.5) * pitch - rad, y0 + (j + 0.5) * pitch - rad, rad * 2, rad * 2);
        }
      }
    }
    g.globalAlpha = 1;

    // scan band while the graph changes shape
    if (this.wave) {
      const u = (this.t - this.wave.t0) / (WAVE + 0.3);
      if (u >= 0 && u <= 1) {
        const bw = pitch * 3.2;
        const x = x0 - bw + u * (cols * pitch + bw * 1.6);
        const grd = g.createLinearGradient(x, 0, x + bw, 0);
        grd.addColorStop(0, 'rgba(70,224,255,0)');
        grd.addColorStop(0.85, 'rgba(70,224,255,.28)');
        grd.addColorStop(1, 'rgba(255,255,255,.55)');
        g.fillStyle = grd;
        g.fillRect(x, y0 - 4, bw, ROWS * pitch + 8);
      } else if (u > 1) this.wave = null;
    }
    g.globalCompositeOperation = 'source-over';

    if (this.playAlpha > 0.01 && this.pong) this.drawPong(g);

    // hover
    const hoverBay = this.hover >= 0 ? bayAt(this.hover) : -1;
    if (this.hover >= 0 && mm < 0.5 && !(hoverBay >= 0 && this.cube.fold[hoverBay] > 0.05)) {
      const i = Math.floor(this.hover / ROWS);
      const j = this.hover % ROWS;
      g.strokeStyle = 'rgba(70,224,255,.95)';
      g.lineWidth = 1.5;
      roundRectPath(g, x0 + i * pitch + (pitch - cell) / 2 - 1, y0 + j * pitch + (pitch - cell) / 2 - 1, cell + 2, cell + 2, R + 1);
      g.stroke();
      const d = this.cells[this.hover];
      const n = d.c;
      this.tipEl.innerHTML = `<b>${n}</b> contribution${n === 1 ? '' : 's'} · ${d.d}`;
      this.tipEl.style.left = `${this.canvas.offsetLeft + x0 + (i + 0.5) * pitch}px`;
      this.tipEl.style.top = `${this.canvas.offsetTop + y0 + j * pitch - 4}px`;
      this.tipEl.hidden = false;
    } else if (!this.tipEl.hidden && this.hover < 0) this.tipEl.hidden = true;
  }

  drawPong(g) {
    const { pitch, x0, y0 } = this;
    const court = this.lay.court;
    const a = this.playAlpha;
    const px = (x) => x0 + (court.x + x) * pitch;
    const py = (y) => y0 + y * pitch;
    const pong = this.pong;
    const snap = pong.snapshot();

    g.save();
    g.globalAlpha = a;

    // court line
    g.strokeStyle = 'rgba(109,255,180,.16)';
    g.setLineDash([3, 6]);
    g.beginPath();
    g.moveTo(px(court.w / 2), y0 - 2);
    g.lineTo(px(court.w / 2), y0 + ROWS * pitch + 2);
    g.stroke();
    g.setLineDash([]);

    // paddles
    const pw = pong.paddleT * pitch;
    const ph = pong.paddleH * pitch;
    for (let side = 0; side < 2; side++) {
      const color = side === 0 ? GAME.past : GAME.future;
      const cx = px(pong.px[side]);
      const top = py(snap.paddles[side]) - ph / 2;
      const human = pong.player[side] != null;
      g.shadowColor = color;
      g.shadowBlur = human ? 22 : 12;
      g.fillStyle = color;
      roundRectPath(g, cx - pw / 2, top, pw, ph, pw / 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.55)';
      roundRectPath(g, cx - pw / 2 + pw * 0.22, top + 3, pw * 0.2, ph - 6, pw * 0.1);
      g.fill();
      g.globalAlpha = a * 0.7;
      g.fillStyle = color;
      g.font = FONT;
      g.textAlign = 'center';
      g.fillText(side === 0 ? (human ? 'PAST · YOU' : 'PAST') : human ? 'FUTURE · YOU' : 'FUTURE', cx, y0 + ROWS * pitch + 16);
      g.globalAlpha = a;
    }

    // rings
    for (const r of this.rings) {
      const u = (this.t - r.t0) / 0.6;
      g.strokeStyle = r.color;
      g.globalAlpha = a * (1 - u) * 0.9;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px(r.x), py(r.y), pitch * (0.3 + r.r * 0.5 * (0.3 + u * 1.6)), 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = a;

    // ball + trail
    g.globalCompositeOperation = 'lighter';
    const live = snap.ball.live;
    this.trail.forEach(([x, y], k) => {
      g.globalAlpha = a * (live ? 0.5 : 0.1) * (1 - k / this.trail.length);
      const rad = pitch * (1.0 - k * 0.05);
      g.drawImage(this.ballSprite, px(x) - rad, py(y) - rad, rad * 2, rad * 2);
    });
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a;
    const bxp = px(snap.ball.x);
    const byp = py(snap.ball.y);
    const br = Math.max(3.2, pitch * 0.4);
    g.shadowColor = GAME.hot;
    g.shadowBlur = 16;
    g.fillStyle = GAME.ball;
    g.beginPath();
    g.arc(bxp, byp, br, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = GAME.hot;
    g.lineWidth = 1.6;
    g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- DOM text
  /** Returns strings for the labels around the canvas. */
  labels() {
    const p = this.parts;
    const z = this.shown;
    const clock = this.want === 1;
    const range = this.compact ? 'LAST 6 MONTHS' : 'LAST 12 MONTHS';
    const total = this.compact ? this.visibleTotal : this.total;
    const where = z.id === 'you' ? 'YOUR TIME' : z.label;
    const cube = this.cube.formed > 0.02 ? this.cube.hud : '';
    return {
      info: cube || (clock ? `${where} · ${z.tz.replace(/_/g, ' ')}` : `${total} CONTRIBUTIONS · ${range}`),
      clock: `${dateLabel(p)} · ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} ${p.tzName}`,
      score: this.playAlpha > 0.3 && this.pong ? this.pong.score.slice() : null,
    };
  }
}
