// CELL CUBE: the geometry behind "the contribution graph folds into a Rubik's cube".
//
// Pure functions, no DOM: the README builder bakes them into CSS keyframes and the live
// site calls them every frame, so both draw the very same cube.
//
// Under an orthographic camera every sticker is an affine image of a unit square, so a
// sticker is just a six-number matrix [a b c d e f] (the SVG/canvas convention) in
// "cube units" where one sticker edge is 1 and the cube is centred on the origin, y down.

import { stickerTangents, mulMV, rotAxisAngle, letterOf } from './cube.mjs';
import { easeInOutCubic } from './rng.mjs';

// Six shades of the contribution graph's green, one per face. No other hue is allowed on the
// cube: the graph's own ramp (#0e4f3a #12805a #26c281 #6dffb4) plus one in-between and one
// hot shade, brightest on top where the light lands, darkest underneath.
export const FACE_COLORS = { U: '#d2ffe8', L: '#6dffb4', F: '#26c281', B: '#1b9a6a', R: '#12805a', D: '#0e4f3a' };
export const VIEW = { yaw: 36, pitch: 27 }; // degrees: the pose the cube forms in
export const FACING_MIN = 0.06; // a sticker this edge-on is not drawn
export const INNER = 0.81; // coloured part of a sticker, as a fraction of its plastic square

// The game and the cube share the graph's green: nothing on the stage is another hue.
export const GAME = { past: '#26c281', future: '#6dffb4', hot: '#d2ffe8', ball: '#f2fff8' };

// How the cube's story is timed, in seconds. The README bakes it into keyframes and the live
// site plays it frame by frame, so both tell the same story.
export const STORY = {
  moves: 9, // scramble length
  faces: 'URF', // only the corner nearest the camera ever turns
  wave: 1.2, // the fold sweeps left to right across the whole graph in this long
  flight: 1.5, // a cell becoming a sticker (or back)
  absorb: 1.25, // a far-away cell being drawn into the cube
  lead: 0.5, // pause between the cube forming and the first scramble move
  scrambleMove: 0.22,
  hold: 1.2, // scrambled, before the solve begins
  solveMove: 0.62,
  gap: 0.12,
  halfTurnScale: 1.4,
  solvedHold: 5, // live site only: how long a solved cube is admired before it scrambles again
};

/** When the fold reaches a cell: later columns and lower rows follow. */
export const cellDelay = (col, row, cols) => (col / Math.max(1, cols - 1)) * STORY.wave + row * 0.018;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

const LIGHT = unit([-0.45, 0.8, 0.55]);

/** Orthographic camera: `d` points toward the viewer, `right` and `up` span the screen. */
export function camera(yawDeg = VIEW.yaw, pitchDeg = VIEW.pitch) {
  const th = (yawDeg * Math.PI) / 180;
  const ph = (pitchDeg * Math.PI) / 180;
  const d = [Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)];
  const back = [-d[0], -d[1], -d[2]];
  const right = unit(cross(back, [0, 1, 0]));
  const up = cross(right, back);
  return { d, right, up };
}

/** World point -> screen units (y down). */
export const project = (v, cam) => [dot(v, cam.right), -dot(v, cam.up)];

/** How dark a sticker with this world normal is painted (0 = fully lit). */
export const shadeOf = (normal) => Math.max(0.04, 0.34 - 0.3 * Math.max(0, dot(normal, LIGHT)));

/** Convex hull (monotone chain), counter-clockwise in screen space. */
export function hullOf(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop();
    lo.push(q);
  }
  const hi = [];
  for (const q of p.slice().reverse()) {
    while (hi.length >= 2 && cr(hi.at(-2), hi.at(-1), q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Silhouette of the whole 3x3x3 block, in screen units. */
export function cubeHull(cam) {
  const corners = [];
  for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) corners.push(project([x, y, z], cam));
  return hullOf(corners);
}

/** Half width and half height of that silhouette. */
export function cubeExtent(cam) {
  let hx = 0;
  let hy = 0;
  for (const [x, y] of cubeHull(cam)) {
    hx = Math.max(hx, Math.abs(x));
    hy = Math.max(hy, Math.abs(y));
  }
  return { hx, hy };
}

/**
 * All 54 stickers in a stable order (cubie order, then axis), posed for the camera.
 * `anim` ({axis, sign, angle}) is a layer part-way through a turn, or null.
 * @returns {{id, color, mat, facing, depth, shade, slab}[]}
 */
export function stickerPoses(cubies, anim, cam) {
  const R = anim ? rotAxisAngle(anim.axis, anim.angle) : null;
  const out = [];
  for (const c of cubies) {
    const slab = !!anim && c.pos[anim.axis] === anim.sign;
    for (let i = 0; i < 3; i++) {
      if (!c.home[i]) continue;
      const local = [0, 0, 0];
      local[i] = Math.sign(c.home[i]);
      const [tg1, tg2] = stickerTangents(local);
      let normal = mulMV(c.rot, local);
      let pos = c.pos;
      let t1 = mulMV(c.rot, tg1);
      let t2 = mulMV(c.rot, tg2);
      if (slab) {
        normal = mulMV(R, normal);
        pos = mulMV(R, pos);
        t1 = mulMV(R, t1);
        t2 = mulMV(R, t2);
      }
      const center = [pos[0] + normal[0] * 0.5, pos[1] + normal[1] * 0.5, pos[2] + normal[2] * 0.5];
      const [e, f] = project(center, cam);
      const [a, b] = project(t1, cam);
      const [c2, d2] = project(t2, cam);
      out.push({
        id: out.length,
        color: letterOf(local),
        mat: [a, b, c2, d2, e, f],
        facing: dot(normal, cam.d),
        depth: dot(center, cam.d),
        shade: shadeOf(normal),
        slab,
      });
    }
  }
  return out;
}

/** Place a sticker pose (cube units) on the page: scale, then move the cube's centre to (cx, cy). */
export const placeMat = (m, scale, cx, cy) => [m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, cx + m[4] * scale, cy + m[5] * scale];

/** A flat cell as a sticker pose: its coloured square covers `size` px, centred on (cx, cy). */
export const cellMat = (cx, cy, size) => {
  const s = size / INNER;
  return [s, 0, 0, s, cx, cy];
};

/**
 * Where a cell is part-way to being a sticker: the affine maps blend, the square swells as it
 * lifts off the page (`lift`) and arcs a little on the way (`arc` px).
 */
export function flightMat(from, to, u, lift = 0.3, arc = 0) {
  const e = easeInOutCubic(u);
  const bump = Math.sin(Math.PI * u);
  const k = 1 + lift * bump;
  const m = from.map((v, i) => v + (to[i] - v) * e);
  m[0] *= k;
  m[1] *= k;
  m[2] *= k;
  m[3] *= k;
  m[5] -= arc * bump;
  return m;
}

/**
 * Minimum-cost assignment of every row to a distinct column (rows <= columns), Hungarian
 * method with potentials. `cost[i][j]` is the price of giving column j to row i.
 * @returns {number[]} the column chosen for each row
 */
export function hungarian(cost) {
  const n = cost.length;
  const m = cost[0].length;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const col = new Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) col[p[j] - 1] = j - 1;
  return col;
}

/** For each target point, the index of a distinct source point, minimising total squared travel. */
export function matchPoints(targets, sources) {
  const cost = targets.map((t) => sources.map((s) => (t[0] - s[0]) ** 2 + (t[1] - s[1]) ** 2));
  return hungarian(cost);
}

// ------------------------------------------------------------------------ layout
export const COURT_PAD = 3; // free columns between a paddle and the first digit
const BAY_MIN = 15; // columns the cube and the cells that feed it need
const MARGIN = 2;
const GAP = 1;

/**
 * Splits a contribution grid into [margin][court around the clock][gap][bay for the cube].
 * Every number is in grid cells. Returns null when the grid is too narrow for a cube.
 */
export function bayLayout({ cols, rows = 7, clockWidth }) {
  const court = clockWidth + 2 * COURT_PAD;
  const c0 = MARGIN + court + GAP;
  if (cols - c0 < BAY_MIN) return null;
  return {
    court: { x: MARGIN, w: court, paddleX: [1.5, court - 1.5] },
    clockOff: MARGIN + COURT_PAD,
    bay: { c0, c1: cols },
    center: { x: (c0 + cols) / 2, y: rows / 2 },
  };
}
