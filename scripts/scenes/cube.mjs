// A self-solving 3D Rubik's cube as pure CSS-animated SVG.
//
// Under an orthographic camera every cube sticker projects to a parallelogram, i.e. an
// affine image of a unit rounded square. So each of the 54 stickers is one <g> whose CSS
// `transform: matrix()` is keyframed through the scramble -> solve sequence, computed from
// the same cube model the live site uses. No scripts, no SMIL.
//
// Moves are restricted to U, R and F so the turning slab is always nearer the camera than
// the rest of the cube. Every sticker has two DOM copies (static / in-slab) whose opacity
// is stepped per move, so the slab paints above the static stickers without a depth sort.

import { createCube, applyMove, applyMoves, invertMoves, scramble, stickerTangents, rotAxisAngle, signedTurns, mulMV, FACE, formatMove } from '../../site/lib/cube.mjs';
import { mulberry32, easeInOutCubic } from '../../site/lib/rng.mjs';
import { num } from './common.mjs';

export const STICKER_COLORS = { U: '#f4f8ff', D: '#ffd23f', F: '#2fe38a', B: '#3d8bff', R: '#ff4f64', L: '#ff9a3c' };

const STEPS_PER_QUARTER = 6;
const FACING_MIN = 0.06;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

/** Orthographic camera: `d` points toward the viewer. */
function camera(yawDeg, pitchDeg) {
  const th = (yawDeg * Math.PI) / 180;
  const ph = (pitchDeg * Math.PI) / 180;
  const d = [Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)];
  const right = unit(cross([-d[0], -d[1], -d[2]], [0, 1, 0]));
  const up = cross(right, [-d[0], -d[1], -d[2]]);
  return { d, right, up };
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (const q of p.slice().reverse()) {
    while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * @returns {{css:string, body:string, meta:object}}  `body` is a <g> that fits a viewBox
 * where the cube is centred on (cx, cy).
 */
export function buildCube({ cx, cy, scale, seed, moves = 14, hold0 = 1.7, hold1 = 4.6, yaw = 36, pitch = 27, prefix = 'k' }) {
  const cam = camera(yaw, pitch);
  const proj = (v) => [scale * dot(v, cam.right), -scale * dot(v, cam.up)];
  const L = unit([-0.45, 0.8, 0.55]);

  const scr = scramble(mulberry32(seed), moves, 'URF');
  const sol = invertMoves(scr);

  const sched = [];
  let t = hold0;
  for (const m of sol) {
    const d = m.n === 2 ? 0.86 : 0.62;
    sched.push({ m, t0: t, t1: t + d });
    t += d + 0.14;
  }
  const solvedAt = sched.at(-1).t1;
  const loop = Math.ceil((solvedAt + hold1) * 10) / 10;
  const pct = (time) => num((time / loop) * 100, 3);

  // ---- sample the geometry at every keyframe time -----------------------------------
  const state = applyMoves(createCube(), scr);
  const tracks = Array.from({ length: 54 }, () => []);
  const colorOf = [];

  /** rotFlag(cubie) -> that cubie is rotated by `rot`; slabFlag(cubie) -> its next interval is in the slab. */
  const record = (time, rot = null, rotFlag = null, slabFlag = null) => {
    let id = 0;
    for (const c of state) {
      for (let i = 0; i < 3; i++) {
        if (!c.home[i]) continue;
        const local = [0, 0, 0];
        local[i] = Math.sign(c.home[i]);
        const [tg1, tg2] = stickerTangents(local);
        let normal = mulMV(c.rot, local);
        let pos = c.pos;
        let t1 = mulMV(c.rot, tg1);
        let t2 = mulMV(c.rot, tg2);
        if (rot && rotFlag(c)) {
          normal = mulMV(rot, normal);
          pos = mulMV(rot, pos);
          t1 = mulMV(rot, t1);
          t2 = mulMV(rot, t2);
        }
        const center = [pos[0] + normal[0] * 0.5, pos[1] + normal[1] * 0.5, pos[2] + normal[2] * 0.5];
        const [e, f] = proj(center);
        const [a, b] = proj(t1);
        const [c2, d2] = proj(t2);
        tracks[id].push({
          t: time,
          mat: [a, b, c2, d2, cx + e, cy + f].map((v) => num(v, 2)).join(','),
          facing: dot(normal, cam.d),
          shade: Math.max(0.04, 0.34 - 0.3 * Math.max(0, dot(normal, L))),
          slab: slabFlag ? slabFlag(c) : false,
        });
        if (!colorOf[id]) colorOf[id] = c.home.map((v, k) => (k === i ? Math.sign(v) : 0));
        id++;
      }
    }
  };

  record(0);
  for (const { m, t0, t1 } of sched) {
    const { axis, sign } = FACE[m.f];
    const inLayer = (c) => c.pos[axis] === sign;
    const q = signedTurns(m);
    const K = STEPS_PER_QUARTER * Math.abs(q);
    record(t0, null, null, inLayer);
    for (let k = 1; k < K; k++) {
      record(t0 + ((t1 - t0) * k) / K, rotAxisAngle(axis, q * (Math.PI / 2) * easeInOutCubic(k / K)), inLayer, inLayer);
    }
    applyMove(state, m);
    record(t1);
  }
  record(loop);

  // ---- emit CSS + elements ------------------------------------------------------------
  const letter = (n) => (n[0] === 1 ? 'R' : n[0] === -1 ? 'L' : n[1] === 1 ? 'U' : n[1] === -1 ? 'D' : n[2] === 1 ? 'F' : 'B');
  let css = '';
  let groupsA = '';
  let groupsB = '';

  tracks.forEach((tr, id) => {
    // transform: keep a keyframe unless it is an interior member of a constant run
    const tf = [];
    for (let i = 0; i < tr.length; i++) {
      const same = (j) => j >= 0 && j < tr.length && tr[j].mat === tr[i].mat;
      if (same(i - 1) && same(i + 1)) continue;
      tf.push(`${pct(tr[i].t)}%{transform:matrix(${tr[i].mat})}`);
    }
    const sh = [];
    for (let i = 0; i < tr.length; i++) {
      const same = (j) => j >= 0 && j < tr.length && Math.abs(tr[j].shade - tr[i].shade) < 0.004;
      if (same(i - 1) && same(i + 1)) continue;
      sh.push(`${pct(tr[i].t)}%{opacity:${num(tr[i].shade, 2)}}`);
    }
    // visibility of the static (a) and in-slab (b) copies; step-end holds each value until the next keyframe
    const va = [];
    const vb = [];
    let la = -1;
    let lb = -1;
    for (let i = 0; i < tr.length; i++) {
      const next = tr[Math.min(i + 1, tr.length - 1)];
      const seen = tr[i].facing > FACING_MIN && next.facing > FACING_MIN;
      const a = seen && !tr[i].slab ? 1 : 0;
      const b = seen && tr[i].slab ? 1 : 0;
      if (a !== la) { va.push(`${pct(tr[i].t)}%{opacity:${a}}`); la = a; }
      if (b !== lb) { vb.push(`${pct(tr[i].t)}%{opacity:${b}}`); lb = b; }
    }
    css += `@keyframes ${prefix}t${id}{${tf.join('')}}@keyframes ${prefix}s${id}{${sh.join('')}}@keyframes ${prefix}a${id}{${va.join('')}}@keyframes ${prefix}b${id}{${vb.join('')}}`;

    const color = STICKER_COLORS[letter(colorOf[id])];
    const last = tr.at(-1);
    const baseA = last.facing > FACING_MIN ? 1 : 0;
    const art =
      `<rect x="-.5" y="-.5" width="1" height="1" rx=".17" fill="#070a11" stroke="#1d2740" stroke-width=".04"/>` +
      `<rect x="-.405" y="-.405" width=".81" height=".81" rx=".13" fill="${color}"/>` +
      `<rect class="${prefix}sh" x="-.405" y="-.405" width=".81" height=".81" rx=".13" fill="#02040a" style="opacity:${num(last.shade, 2)};animation:${prefix}s${id} ${loop}s linear infinite"/>` +
      `<path d="M-.33 -.08V-.27Q-.33 -.33 -.27 -.33H-.04" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".05" stroke-linecap="round"/>`;
    // inline style = the solved cube, which is what reduced-motion viewers get
    const g = (v) =>
      `<g class="${prefix}g" style="transform:matrix(${last.mat});opacity:${v === 'a' ? baseA : 0};animation:${prefix}t${id} ${loop}s linear infinite,${prefix}${v}${id} ${loop}s step-end infinite">${art}</g>`;
    groupsA += g('a');
    groupsB += g('b');
  });

  // silhouette of the whole cube = dark core behind every sticker
  const corners = [];
  for (const x of [-1.5, 1.5]) for (const y of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) corners.push(proj([x, y, z]).map((v, k) => v + (k ? cy : cx)));
  const core = hull(corners)
    .map((p) => `${num(p[0], 1)},${num(p[1], 1)}`)
    .join(' ');

  // fade the whole cube across the loop seam (solved -> scrambled is a hard cut)
  css += `.${prefix}w{animation:${prefix}fade ${loop}s linear infinite}@keyframes ${prefix}fade{0%{opacity:0}${pct(0.35)}%{opacity:1}${pct(loop - 0.45)}%{opacity:1}100%{opacity:0}}`;
  css += `@media (prefers-reduced-motion: reduce){.${prefix}g{animation:none!important}.${prefix}w{animation:none!important;opacity:1}}`;

  const body =
    `<g class="${prefix}w"><polygon points="${core}" fill="#070a11" stroke="#1d2740" stroke-width="1" stroke-linejoin="round"/>${groupsA}${groupsB}</g>`;

  return {
    css,
    body,
    meta: {
      loop,
      solvedAt,
      hold0,
      scramble: scr.map(formatMove).join(' '),
      solution: sol.map(formatMove).join(' '),
      schedule: sched.map(({ m, t0, t1 }) => ({ move: formatMove(m), t0, t1 })),
    },
  };
}
