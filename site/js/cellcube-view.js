// The live half of "the contribution graph folds into a Rubik's cube that solves itself".
//
// The README bakes this story into CSS keyframes. Here the very same cube model, camera, cell
// matching and timings (site/lib/cellcube + cubeseq) are played frame by frame, so the cube can
// be dragged around, keeps scrambling and solving for as long as the clock is showing, and
// unfolds back into the graph from wherever it happens to be.
//
// Every sticker is an affine image of a unit square, so a sticker is one `setTransform` and a
// few rounded rects. Stickers are depth-sorted; only the corner nearest the camera ever turns.

import { createCube, formatMove } from '../lib/cube.mjs';
import { mulberry32, hash32 } from '../lib/rng.mjs';
import { planSolve, Track } from '../lib/cubeseq.mjs';
import { pad2 } from '../lib/timeutil.mjs';
import {
  camera,
  stickerPoses,
  cubeHull,
  cubeExtent,
  cellMat,
  flightMat,
  placeMat,
  matchPoints,
  FACE_COLORS,
  FACING_MIN,
  INNER,
  VIEW,
  STORY,
  GAME,
} from '../lib/cellcube.mjs';
import { clamp, hex, mixRGB, rgb, roundRectPath, glowSprite } from './util.js';

const FACE_RGB = Object.fromEntries(Object.entries(FACE_COLORS).map(([k, v]) => [k, hex(v)]));
const PLASTIC = '#070a11';
const EDGE = '#1d2740';
const SHADE = '#03140c';
const ORBIT = { yaw: [-24, 36], pitch: [-12, 22] }; // degrees away from VIEW; keeps the turning corner nearest

const ramp = (u, a, b) => {
  const t = clamp((u - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class CellCube {
  constructor({ reduced = false } = {}) {
    this.reduced = reduced;
    this.want = 0;
    this.cycling = true; // scramble again after solving; the grid turns this off while it runs on a timer
    this.cells = [];
    this.fold = new Float32Array(0);
    this.startAt = new Float32Array(0);
    this.formed = 0; // 0..1: how much of the cube exists
    this.active = false; // true while any bay cell has left the page
    this.inT = 0; // story time, seconds since the fold began (frozen while unfolding)
    this.cycle = 0;
    this.seedKey = 'chronos';
    this.plan = null;
    this.track = null;
    this.glow = 0;
    this.burstAt = -99;
    this.solvedSeen = false;
    this.hud = '';
    this.total = 0;
    this.orbit = { yaw: 0, pitch: 0, idle: 99, drag: false };
    this.glowSprite = glowSprite(hex(GAME.future));
    this.shadowSprite = (() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 16;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 8, 0, 32, 8, 32);
      grd.addColorStop(0, 'rgba(0,0,0,.62)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.setTransform(1, 0, 0, 0.25, 0, 6);
      g.fillStyle = grd;
      g.fillRect(0, -24, 64, 64);
      return c;
    })();
  }

  /**
   * Fixes where the bay is on the page and which cell becomes which sticker.
   * @param cells {{ci:number,x:number,y:number,rgb:number[],delay:number,count:number}[]}
   *        the bay's cells: centre (CSS px), activity colour, fold delay, contributions
   * @param o {{cx:number,cy:number,height:number,size:number,pitch:number}}
   *        cube centre and silhouette height, cell square size and pitch, all CSS px
   */
  layout(cells, { cx, cy, height, size, pitch }) {
    const keep = cells.length === this.cells.length;
    const old = this.fold;
    this.cells = cells;
    if (!cells.length) {
      this.fold = new Float32Array(0);
      this.startAt = new Float32Array(0);
      this.cellRole = new Int16Array(0);
      this.stickerAt = new Int16Array(54).fill(-1);
      this.formed = 0;
      this.active = false;
      this.hud = '';
      return;
    }
    this.cx = cx;
    this.cy = cy;
    this.size = size;
    this.pitch = pitch;
    this.total = cells.reduce((n, c) => n + c.count, 0);

    const cam = camera();
    this.scale = height / (2 * cubeExtent(cam).hy);
    const hull = cubeHull(cam);
    this.hullHalfW = Math.max(...hull.map((p) => Math.abs(p[0]))) * this.scale;
    this.hullBottom = cy + Math.max(...hull.map((p) => p[1])) * this.scale;
    const rest = stickerPoses(createCube(), null, cam);
    const restMat = rest.map((p) => placeMat(p.mat, this.scale, cx, cy));
    const primary = rest.filter((p) => p.facing > FACING_MIN);
    const centre = (p) => [restMat[p.id][4], restMat[p.id][5]];
    const pick = matchPoints(primary.map(centre), cells.map((c) => [c.x, c.y]));

    this.stickerAt = new Int16Array(54).fill(-1); // sticker id -> bay cell
    this.cellRole = new Int16Array(cells.length).fill(-1); // bay cell -> sticker id (-1: drawn in)
    primary.forEach((p, k) => {
      this.stickerAt[p.id] = pick[k];
      this.cellRole[pick[k]] = p.id;
    });
    const centres = primary.map(centre);
    this.target = cells.map((c, k) => {
      if (this.cellRole[k] >= 0) return null;
      let best = centres[0];
      let bd = Infinity;
      for (const q of centres) {
        const d = (q[0] - c.x) ** 2 + (q[1] - c.y) ** 2;
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      return best;
    });
    this.formedAt = Math.max(...pick.map((k) => cells[k].delay)) + STORY.flight;
    this.fold = keep ? old : new Float32Array(cells.length).fill(this.want ? 1 : 0);
    this.startAt = new Float32Array(cells.length).fill(-1);
    if (!this.plan) this.newPlan(this.formedAt + STORY.lead);
  }

  newPlan(t0) {
    const { moves, faces, scrambleMove, hold, solveMove, gap, halfTurnScale } = STORY;
    this.plan = planSolve(mulberry32(hash32(`${this.seedKey}#${this.cycle++}`)), { moves, faces, t0, scrambleMove, hold, solveMove, gap, halfTurnScale });
    this.track = new Track(this.plan.seq);
    this.solvedSeen = false;
  }

  /** Fold into the cube (want = 1) or unfold into the graph (0), starting at time `t`. */
  setWant(want, t, seedKey = this.seedKey) {
    this.want = want;
    for (let k = 0; k < this.cells.length; k++) this.startAt[k] = this.reduced ? -1 : t + this.cells[k].delay;
    if (!want || !this.cells.length) return;
    this.seedKey = seedKey;
    this.cycle = 0;
    this.burstAt = -99;
    this.newPlan(this.formedAt + STORY.lead);
    this.inT = this.reduced ? this.plan.solvedAt + 0.01 : 0; // reduced motion: a finished, solved cube
    this.solvedSeen = this.reduced;
  }

  update(dt, t) {
    if (!this.cells.length) return;
    const want = this.want;
    let sum = 0;
    let n = 0;
    let any = false;
    for (let k = 0; k < this.cells.length; k++) {
      const matched = this.cellRole[k] >= 0;
      if (t >= this.startAt[k]) {
        const step = this.reduced ? 1 : dt / (matched ? STORY.flight : STORY.absorb);
        this.fold[k] = clamp(this.fold[k] + (want ? step : -step), 0, 1);
      }
      if (this.fold[k] > 0) any = true;
      if (matched) {
        sum += this.fold[k];
        n++;
      }
    }
    this.formed = n ? sum / n : 0;
    this.active = any;

    if (want && !this.reduced) {
      this.inT += dt;
      // a solved cube is admired for a while, then scrambles again (unless the page is on a timer)
      if (this.cycling && this.inT >= this.plan.solvedAt + STORY.solvedHold) this.newPlan(this.inT + 0.05);
    }
    const solved = want && this.inT >= this.plan.solvedAt && this.formed > 0.9;
    if (solved && !this.solvedSeen) {
      this.solvedSeen = true;
      this.burstAt = this.inT;
    }
    this.glow += ((solved ? 0.85 : 0) - this.glow) * Math.min(1, dt * (solved ? 5 : 3));

    const o = this.orbit;
    if (!o.drag) {
      o.idle += dt;
      if (o.idle > 2.2) {
        const k = Math.exp(-dt * 1.8);
        o.yaw *= k;
        o.pitch *= k;
      }
    }
    this.hud = this.status();
  }

  status() {
    if (this.formed < 0.02) return '';
    const p = this.plan;
    const t = this.inT;
    if (!this.want) return 'BACK TO THE GRAPH';
    if (t < p.seq[0].t0) return this.formed < 0.97 ? 'FOLDING THE GRAPH INTO A CUBE' : `BUILT FROM ${this.total} CONTRIBUTIONS`;
    if (t < p.scrambleEnd) return `SCRAMBLING · ${p.n} MOVES`;
    if (t < p.solveStart) return `SCRAMBLED · ${p.n} MOVES TO GO`;
    if (t < p.solvedAt) {
      const solve = p.seq.filter((s) => s.kind === 'solve');
      let i = 0;
      while (i + 1 < solve.length && solve[i + 1].t0 - 0.02 <= t) i++;
      return `SOLVING ${pad2(i + 1)}/${pad2(p.n)}  ${formatMove(solve[i].m)}`;
    }
    return `SOLVED · ${p.n} MOVES · REVERSED SCRAMBLE`;
  }

  // ---------------------------------------------------------------- orbit
  /** Is the page point over the formed cube? */
  hit(x, y) {
    return this.want === 1 && this.formed > 0.9 && Math.hypot((x - this.cx) / 0.9, y - this.cy) < this.hullHalfW * 1.1;
  }

  beginDrag() {
    this.orbit.drag = true;
    this.orbit.idle = 0;
  }

  dragBy(dx, dy) {
    const o = this.orbit;
    o.yaw = clamp(o.yaw - dx * 0.4, ORBIT.yaw[0], ORBIT.yaw[1]);
    o.pitch = clamp(o.pitch + dy * 0.3, ORBIT.pitch[0], ORBIT.pitch[1]);
    o.idle = 0;
  }

  endDrag() {
    this.orbit.drag = false;
    this.orbit.idle = 0;
  }

  // ---------------------------------------------------------------- drawing
  /** One sticker (or a cell on its way to being one) as an affine image of a unit square. */
  sticker(g, dpr, m, plast, fill, shade, hi) {
    g.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
    if (plast > 0.01) {
      g.globalAlpha = plast;
      g.fillStyle = PLASTIC;
      g.strokeStyle = EDGE;
      g.lineWidth = 0.04;
      roundRectPath(g, -0.5, -0.5, 1, 1, 0.17);
      g.fill();
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = rgb(fill);
    roundRectPath(g, -INNER / 2, -INNER / 2, INNER, INNER, 0.16);
    g.fill();
    if (shade > 0.01) {
      g.globalAlpha = shade;
      g.fillStyle = SHADE;
      g.fill();
      g.globalAlpha = 1;
    }
    if (hi > 0.01) {
      g.globalAlpha = 0.45 * hi;
      g.strokeStyle = '#fff';
      g.lineWidth = 0.05;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-0.33, -0.08);
      g.lineTo(-0.33, -0.27);
      g.quadraticCurveTo(-0.33, -0.33, -0.27, -0.33);
      g.lineTo(-0.04, -0.33);
      g.stroke();
      g.lineCap = 'butt';
      g.globalAlpha = 1;
    }
  }

  viewCamera(t, core) {
    const o = this.orbit;
    return camera(VIEW.yaw + o.yaw + 2.2 * Math.sin(t * 0.45) * core, VIEW.pitch + o.pitch + 1.2 * Math.sin(t * 0.37 + 1) * core);
  }

  /** Draws the bay: cells not yet folded, cells being drawn in, and the cube itself. */
  draw(g, dpr, t) {
    const { cells, size, pitch, cx, cy } = this;
    const core = ramp(this.formed, 0.5, 0.98);
    const cam = this.viewCamera(t, core);
    const { model, anim } = this.track.at(this.inT);
    const poses = stickerPoses(model, anim, cam);
    for (const p of poses) p.live = placeMat(p.mat, this.scale, cx, cy);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // cells that are drawn into the cube instead of becoming a sticker
    const R = size * 0.2;
    for (let k = 0; k < cells.length; k++) {
      if (this.cellRole[k] >= 0) continue;
      const c = cells[k];
      const u = this.fold[k];
      const e = u * u * u;
      const s = 1 - 0.82 * e;
      const tx = c.x + (this.target[k][0] - c.x) * e;
      const ty = c.y + (this.target[k][1] - c.y) * e;
      g.globalAlpha = 1 - e;
      g.fillStyle = rgb(c.rgb);
      roundRectPath(g, tx - (size * s) / 2, ty - (size * s) / 2, size * s, size * s, R * s);
      g.fill();
    }
    g.globalAlpha = 1;

    if (core > 0.01) {
      // light under the cube, then its dark body
      const rad = this.hullHalfW * 1.55;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = core * (0.2 + 0.5 * this.glow);
      g.drawImage(this.glowSprite, cx - rad, cy - rad, rad * 2, rad * 2);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = core * 0.9;
      g.drawImage(this.shadowSprite, cx - this.hullHalfW * 0.95, this.hullBottom - 4, this.hullHalfW * 1.9, this.hullHalfW * 0.5);
      g.globalAlpha = core;
      g.beginPath();
      cubeHull(cam).forEach(([x, y], i) => (i ? g.lineTo(cx + x * this.scale, cy + y * this.scale) : g.moveTo(cx + x * this.scale, cy + y * this.scale)));
      g.closePath();
      g.fillStyle = PLASTIC;
      g.strokeStyle = EDGE;
      g.lineWidth = 1;
      g.lineJoin = 'round';
      g.fill();
      g.stroke();
      g.globalAlpha = 1;
    }

    const formed = [];
    const flying = [];
    for (const p of poses) {
      const k = this.stickerAt[p.id];
      if (k >= 0) {
        const f = this.fold[k];
        if (f >= 1) {
          if (p.facing > FACING_MIN) formed.push(p);
        } else flying.push([p, k, f]);
      } else if (p.facing > FACING_MIN && core > 0.5) formed.push(p);
    }
    formed.sort((a, b) => a.depth - b.depth);
    for (const p of formed) this.sticker(g, dpr, p.live, 1, FACE_RGB[p.color], p.shade, 1);

    const arcCap = 16 * (pitch / 15);
    for (const [p, k, f] of flying) {
      const c = cells[k];
      const from = cellMat(c.x, c.y, size);
      const arc = Math.min(arcCap, Math.hypot(p.live[4] - c.x, p.live[5] - c.y) * 0.12);
      const m = flightMat(from, p.live, f, 0.3, arc);
      const plast = ramp(f, 0.35, 0.8);
      this.sticker(g, dpr, m, plast, mixRGB(c.rgb, FACE_RGB[p.color], ramp(f, 0.25, 0.85)), p.shade * ramp(f, 0.4, 1), plast);
    }

    // the flash when the cube comes out solved
    const age = (this.inT - this.burstAt) / 0.9;
    if (this.want && age >= 0 && age <= 1) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.strokeStyle = GAME.hot;
      g.globalAlpha = (1 - age) * 0.8;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, this.hullHalfW * (0.3 + 1.1 * age), 0, Math.PI * 2);
      g.stroke();
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
  }
}
