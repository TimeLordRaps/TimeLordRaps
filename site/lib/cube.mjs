// A 3x3x3 Rubik's cube as 26 cubies with integer position + integer rotation matrix.
// Pure data, no rendering: the SVG generator and the WebGL site both consume it.
//
// Axes: +X = R, +Y = U, +Z = F (right-handed). Face turns are clockwise as seen from
// outside the face, i.e. a negative quarter turn about the face's outward normal.

import { clamp } from './rng.mjs';

export const FACE = {
  R: { axis: 0, sign: 1 },
  L: { axis: 0, sign: -1 },
  U: { axis: 1, sign: 1 },
  D: { axis: 1, sign: -1 },
  F: { axis: 2, sign: 1 },
  B: { axis: 2, sign: -1 },
};
export const FACE_LETTERS = 'RLUDFB';

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function letterOf(n) {
  if (n[0] === 1) return 'R';
  if (n[0] === -1) return 'L';
  if (n[1] === 1) return 'U';
  if (n[1] === -1) return 'D';
  if (n[2] === 1) return 'F';
  return 'B';
}

export const mulMV = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export function mulMM(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return o;
}

/** Integer rotation by q quarter turns (right-handed) about axis 0|1|2. */
export function rotMat(axis, q) {
  const k = ((q % 4) + 4) % 4;
  const c = [1, 0, -1, 0][k];
  const s = [0, 1, 0, -1][k];
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Float rotation by `angle` radians (right-handed) about axis 0|1|2, for animation. */
export function rotAxisAngle(axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function createCube() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        cubies.push({ home: [x, y, z], pos: [x, y, z], rot: I3.slice() });
      }
    }
  }
  return cubies;
}

export function cloneCube(cubies) {
  return cubies.map((c) => ({ home: c.home, pos: c.pos.slice(), rot: c.rot.slice() }));
}

export function parseMove(s) {
  const f = s[0];
  if (!FACE[f]) throw new Error(`bad move: ${s}`);
  return { f, n: s[1] === '2' ? 2 : s[1] === "'" ? 3 : 1 };
}

export const formatMove = (m) => m.f + (m.n === 2 ? '2' : m.n === 3 ? "'" : '');
export const parseMoves = (s) => s.trim().split(/\s+/).filter(Boolean).map(parseMove);
export const formatMoves = (ms) => ms.map(formatMove).join(' ');

/** Signed quarter turns about the +axis direction: -1, 1 or 2. */
export function signedTurns(m) {
  const { sign } = FACE[m.f];
  const k = (((-sign * m.n) % 4) + 4) % 4;
  return k === 3 ? -1 : k;
}

export function applyMove(cubies, m) {
  const { axis, sign } = FACE[m.f];
  const R = rotMat(axis, signedTurns(m));
  for (const c of cubies) {
    if (c.pos[axis] === sign) {
      c.pos = mulMV(R, c.pos).map((v) => v + 0);
      c.rot = mulMM(R, c.rot).map((v) => v + 0);
    }
  }
  return cubies;
}

export function applyMoves(cubies, moves) {
  for (const m of moves) applyMove(cubies, m);
  return cubies;
}

export const invertMoves = (moves) => moves.slice().reverse().map((m) => ({ f: m.f, n: 4 - m.n }));

/** Random scramble without redundant sequences (R R, R L R, ...). */
export function scramble(rng, len, faces = FACE_LETTERS) {
  const out = [];
  while (out.length < len) {
    const f = faces[(rng() * faces.length) | 0];
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    if (last && last.f === f) continue;
    if (last && prev && FACE[last.f].axis === FACE[f].axis && FACE[prev.f].axis === FACE[f].axis) continue;
    out.push({ f, n: 1 + ((rng() * 3) | 0) });
  }
  return out;
}

/** All 54 stickers in a stable order. `color` is the face letter the sticker started on. */
export function stickers(cubies) {
  const out = [];
  cubies.forEach((c, ci) => {
    for (let i = 0; i < 3; i++) {
      if (!c.home[i]) continue;
      const local = [0, 0, 0];
      local[i] = Math.sign(c.home[i]);
      out.push({ cubie: ci, color: letterOf(local), local, normal: mulMV(c.rot, local), pos: c.pos });
    }
  });
  return out;
}

export function isSolved(cubies) {
  return stickers(cubies).every((s) => letterOf(s.normal) === s.color);
}

/** Two in-plane tangents (t1 x t2 = normal) for a sticker with the given local normal. */
export function stickerTangents(local) {
  const i = local[0] ? 0 : local[1] ? 1 : 2;
  const t1 = [0, 0, 0];
  t1[(i + 1) % 3] = 1;
  const t2 = [
    local[1] * t1[2] - local[2] * t1[1],
    local[2] * t1[0] - local[0] * t1[2],
    local[0] * t1[1] - local[1] * t1[0],
  ];
  return [t1, t2];
}

/** How far through a move (0..1) -> rotation angle in radians about its +axis. */
export function moveAngle(m, progress) {
  return signedTurns(m) * (Math.PI / 2) * clamp(progress, 0, 1);
}
