// The self-solving cube that the contribution graph folds into, as pure CSS-animated SVG.
//
// Cells from the right-hand block of the graph (the "bay") fly together, the 27 stickers
// facing the camera each grow out of one cell, the other cells are drawn in, and the cube
// scrambles and solves itself. At the end every sticker shrinks back into its cell.
//
// Under an orthographic camera every sticker is an affine image of a unit square, so each
// one is a single <g> whose CSS `transform: matrix()` is keyframed through the whole story,
// computed from the same cube model and camera maths the live site uses (site/lib/cellcube).
//
// Moves are restricted to U, R and F so the turning layer is always nearer the camera than
// the rest of the cube. Each sticker that ever turns has two DOM copies (static / in-layer)
// whose opacity is stepped per move, so the layer paints above the static stickers without a
// depth sort. Stickers that never face the camera are not drawn at all.

import { createCube, applyMove, signedTurns, FACE, formatMove } from '../../site/lib/cube.mjs';
import { mulberry32, easeInOutCubic } from '../../site/lib/rng.mjs';
import { planSolve } from '../../site/lib/cubeseq.mjs';
import { camera, stickerPoses, cubeHull, cellMat, flightMat, placeMat, matchPoints, FACE_COLORS, FACING_MIN, VIEW, STORY } from '../../site/lib/cellcube.mjs';
import { PAL, GAME, num, mix, label } from './common.mjs';

export const STICKER_COLORS = FACE_COLORS;

const FLIGHT = STORY.flight; // seconds for a cell to become a sticker (or the reverse)
const ABSORB = STORY.absorb; // seconds for a far-away cell to be drawn into the cube
const FLIGHT_STEPS = 7;
const ramp = (u, a, b) => {
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Inverse of easeInOutCubic: the time fraction at which the eased progress reaches y. */
const easeInverse = (y) => (y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2);
const fmtMat = (m) => m.map((v) => num(v, 1)).join(',');
const quant = (v, step) => Math.round(v / step) * step;

/**
 * @param {object} o
 * @param {number} o.L            loop length in seconds
 * @param {number} o.cx,o.cy      centre of the cube on the page
 * @param {number} o.scale        pixels per sticker edge
 * @param {number} o.seed         scramble seed
 * @param {{x:number,y:number,a:string,delay:number,count:number}[]} o.cells
 *        every cell of the bay: centre, its activity colour, its wave delay, its contributions
 * @param {number} o.size         edge of a cell's coloured square, px
 * @param {number} o.inAt,o.outAt when the graph starts folding in / unfolding, seconds
 * @param {number} [o.hudY]       baseline of the status line under the cube
 */
export function buildCellCube(o) {
  const { L, cx, cy, scale, seed, cells, size, inAt, outAt, hudY, moves = 9, yaw = VIEW.yaw, pitch = VIEW.pitch, prefix = 'k' } = o;
  const cam = camera(yaw, pitch);
  const pct = (t) => num((t / L) * 100, 2);
  const place = (m) => placeMat(m, scale, cx, cy);

  // ---- who becomes what ---------------------------------------------------------------
  const rest = stickerPoses(createCube(), null, cam);
  const primary = rest.filter((p) => p.facing > FACING_MIN);
  const center = (p) => [cx + p.mat[4] * scale, cy + p.mat[5] * scale];
  const pick = matchPoints(primary.map(center), cells.map((c) => [c.x, c.y]));
  const srcOf = new Map(primary.map((p, k) => [p.id, cells[pick[k]]]));
  const taken = new Set(pick);

  const formedAt = inAt + Math.max(...[...srcOf.values()].map((c) => c.delay)) + FLIGHT;
  const { faces, scrambleMove, hold, solveMove, gap, halfTurnScale } = STORY;
  const plan = planSolve(mulberry32(seed), { moves, faces, t0: formedAt + STORY.lead, scrambleMove, hold, solveMove, gap, halfTurnScale });
  if (plan.solvedAt + 1.4 > outAt) throw new Error(`cube story runs to ${plan.solvedAt.toFixed(1)}s but unfolds at ${outAt}s`);

  // ---- sample the geometry --------------------------------------------------------------
  const tracks = Array.from({ length: 54 }, () => []);
  const state = createCube();
  const record = (t, anim = null) => {
    for (const p of stickerPoses(state, anim, cam)) {
      tracks[p.id].push({ t, mat: place(p.mat), facing: p.facing, shade: p.shade, slab: p.slab, plast: 1, fill: FACE_COLORS[p.color] });
    }
  };
  for (const s of plan.seq) {
    const { axis, sign } = FACE[s.m.f];
    const q = signedTurns(s.m);
    // Equal steps of ANGLE, not of time: the ease lives in when each step is reached, and no
    // two keyframes are ever far enough apart for the browser to interpolate them badly.
    const K = Math.abs(q) * (s.kind === 'scramble' ? 3 : 4);
    record(s.t0, { axis, sign, angle: 0 });
    for (let k = 1; k < K; k++) record(s.t0 + (s.t1 - s.t0) * easeInverse(k / K), { axis, sign, angle: q * (Math.PI / 2) * (k / K) });
    applyMove(state, s.m);
    record(s.t1);
  }
  const moveTracks = tracks.map((t) => t.slice());

  // flights in and out, plus the rest pose before and after
  const restMat = rest.map((p) => place(p.mat));
  tracks.forEach((tr, id) => {
    const p = rest[id];
    const face = FACE_COLORS[p.color];
    const src = srcOf.get(id);
    const head = [];
    const tail = [];
    if (src) {
      const a = src.a;
      const m0 = cellMat(src.x, src.y, size);
      const arc = Math.min(16, Math.hypot(restMat[id][4] - src.x, restMat[id][5] - src.y) * 0.12);
      const sample = (t, u, back) => {
        const k = back ? 1 - u : u;
        return {
          t,
          mat: back ? flightMat(restMat[id], m0, u, 0.3, arc) : flightMat(m0, restMat[id], u, 0.3, arc),
          facing: p.facing,
          shade: p.shade * ramp(k, 0.4, 1),
          slab: false,
          plast: ramp(k, 0.35, 0.8),
          fill: mix(a, face, ramp(k, 0.25, 0.85)),
        };
      };
      head.push({ t: 0, mat: m0, facing: p.facing, shade: 0, slab: false, plast: 0, fill: a });
      for (let i = 0; i <= FLIGHT_STEPS; i++) head.push(sample(inAt + src.delay + (FLIGHT * i) / FLIGHT_STEPS, i / FLIGHT_STEPS, false));
      for (let i = 0; i <= FLIGHT_STEPS; i++) tail.push(sample(outAt + src.delay + (FLIGHT * i) / FLIGHT_STEPS, i / FLIGHT_STEPS, true));
      tail.push({ t: L, mat: m0, facing: p.facing, shade: 0, slab: false, plast: 0, fill: a });
    } else {
      head.push({ t: 0, mat: restMat[id], facing: p.facing, shade: p.shade, slab: false, plast: 1, fill: face });
      tail.push({ t: L, mat: restMat[id], facing: p.facing, shade: p.shade, slab: false, plast: 1, fill: face });
    }
    tracks[id] = head.concat(moveTracks[id], tail);
  });

  // ---- emit keyframes + elements ------------------------------------------------------
  /** `@keyframes` for one property; interior members of a constant run are dropped. */
  const frames = (name, tr, prop, get, step = false) => {
    const rows = [];
    for (let i = 0; i < tr.length; i++) {
      const v = get(tr[i]);
      if (!step && i > 0 && i < tr.length - 1 && get(tr[i - 1]) === v && get(tr[i + 1]) === v) continue;
      if (step && i > 0 && get(tr[i - 1]) === v) continue;
      const p = pct(tr[i].t);
      if (rows.length && rows.at(-1)[0] === p) rows.pop();
      rows.push([p, v]);
    }
    return `@keyframes ${name}{${rows.map(([p, v]) => `${p}%{${prop ? `${prop}:` : ''}${v}}`).join('')}}`;
  };

  // A sticker's pose lives in six registered number properties and `transform` just reads them.
  // Animating `transform: matrix()` itself would make the browser decompose both matrices into
  // rotate/skew/scale and blend those, which collapses a sticker that is turning edge-on; animating
  // the entries is an exact component-wise blend, the same one the live site draws with.
  const MAT = ['ma', 'mb', 'mc', 'md', 'me', 'mf'];
  const poseVars = (m) => MAT.map((k, i) => `--${k}:${num(m[i], 1)}`).join(';');
  let css =
    // (`<` must be written as an entity: this text sits inside an XML <style> element)
    MAT.map((k) => `@property --${k}{syntax:'&lt;number&gt;';inherits:false;initial-value:0}`).join('') +
    `.${prefix}q{transform:matrix(${MAT.map((k) => `var(--${k})`).join(',')})}`;
  let groupsA = '';
  let groupsB = '';
  let drawn = 0;
  const animList = (list) => list.map(([n, mode]) => `${n} ${L}s ${mode} infinite`).join(',');

  tracks.forEach((tr, id) => {
    // a sticker shows through copy `a` (static) or `b` (in the turning layer) while it faces the camera
    const seenAt = (i) => tr[i].facing > FACING_MIN && tr[Math.min(i + 1, tr.length - 1)].facing > FACING_MIN;
    const vis = (slab) => (i) => (seenAt(i) && tr[i].slab === slab ? 1 : 0);
    const everA = tr.some((_, i) => vis(false)(i));
    const everB = tr.some((_, i) => vis(true)(i));
    if (!everA && !everB) return; // hidden for good: never drawn
    drawn++;

    css += frames(`${prefix}t${id}`, tr, null, (s) => poseVars(s.mat));
    css += frames(`${prefix}s${id}`, tr, 'opacity', (s) => num(quant(s.shade, 0.02), 2));
    const src = srcOf.get(id);
    if (src) {
      css += frames(`${prefix}p${id}`, tr, 'opacity', (s) => num(s.plast, 2));
      css += frames(`${prefix}f${id}`, tr, 'fill', (s) => s.fill);
    }
    for (const [tag, slab, ever] of [['a', false, everA], ['b', true, everB]]) {
      if (ever) css += frames(`${prefix}${tag}${id}`, tr.map((s, i) => ({ t: s.t, v: vis(slab)(i) })), 'opacity', (s) => s.v, true);
    }

    const p = rest[id];
    const face = FACE_COLORS[p.color];
    const restOpacity = p.facing > FACING_MIN ? 1 : 0;
    const part = () =>
      `<rect x="-.5" y="-.5" width="1" height="1" rx=".17" fill="#070a11" stroke="#1d2740" stroke-width=".04"${src ? ` style="animation:${prefix}p${id} ${L}s linear infinite"` : ''}/>` +
      `<rect x="-.405" y="-.405" width=".81" height=".81" rx=".16" fill="${face}"${src ? ` style="animation:${prefix}f${id} ${L}s linear infinite"` : ''}/>` +
      `<rect x="-.405" y="-.405" width=".81" height=".81" rx=".16" fill="#03140c" style="opacity:${num(p.shade, 2)};animation:${prefix}s${id} ${L}s linear infinite"/>` +
      `<path d="M-.33 -.08V-.27Q-.33 -.33 -.27 -.33H-.04" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".05" stroke-linecap="round"${src ? ` style="animation:${prefix}p${id} ${L}s linear infinite"` : ''}/>`;
    // inline style = the finished, solved cube: what reduced-motion viewers see
    const g = (tag) =>
      `<g class="${prefix}q" style="${poseVars(restMat[id])};opacity:${tag === 'a' ? restOpacity : 0};animation:${animList([[`${prefix}t${id}`, 'linear'], [`${prefix}${tag}${id}`, 'step-end']])}">${part()}</g>`;
    if (everA) groupsA += g('a');
    if (everB) groupsB += g('b');
  });

  // cells that are not stickers fly into the cube (and out again)
  const targetFor = (c) => {
    let best = null;
    let bd = Infinity;
    for (const p of primary) {
      const [x, y] = center(p);
      const d = (x - c.x) ** 2 + (y - c.y) ** 2;
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
    return best;
  };
  let absorbed = '';
  cells.forEach((c, k) => {
    if (taken.has(k)) return;
    const [tx, ty] = targetFor(c);
    absorbed += `<rect class="${prefix}x" x="${num(c.x - size / 2, 1)}" y="${num(c.y - size / 2, 1)}" width="${size}" height="${size}" rx="2.6" style="--a:${c.a};--dx:${num(tx - c.x, 1)}px;--dy:${num(ty - c.y, 1)}px;--d:${num(c.delay, 2)}s"/>`;
  });
  const ease = 'cubic-bezier(.5,0,.75,.4)';
  css +=
    `.${prefix}x{fill:var(--a);transform-box:fill-box;transform-origin:center;animation:${prefix}x ${L}s linear infinite;animation-delay:var(--d)}` +
    `@keyframes ${prefix}x{0%,${pct(inAt)}%{transform:translate(0,0) scale(1);opacity:1;animation-timing-function:${ease}}` +
    `${pct(inAt + ABSORB)}%,${pct(outAt)}%{transform:translate(var(--dx),var(--dy)) scale(.18);opacity:0;animation-timing-function:cubic-bezier(.25,.6,.5,1)}` +
    `${pct(outAt + ABSORB)}%,100%{transform:translate(0,0) scale(1);opacity:1}}`;

  // ---- the hull, the glows and the status line ---------------------------------------
  const hullPts = cubeHull(cam)
    .map(([x, y]) => `${num(cx + x * scale, 1)},${num(cy + y * scale, 1)}`)
    .join(' ');
  const hullBottom = cy + Math.max(...cubeHull(cam).map((p) => p[1])) * scale;
  const hullHalfW = Math.max(...cubeHull(cam).map((p) => Math.abs(p[0]))) * scale;
  const first = Math.min(...cells.map((c) => c.delay));

  css +=
    `.${prefix}core{opacity:0;animation:${prefix}core ${L}s linear infinite}` +
    `@keyframes ${prefix}core{0%,${pct(inAt + first + FLIGHT * 0.55)}%{opacity:0}${pct(formedAt)}%,${pct(outAt + first)}%{opacity:1}${pct(outAt + first + 0.45)}%,100%{opacity:0}}` +
    `.${prefix}aura{opacity:0;animation:${prefix}aura ${L}s linear infinite}` +
    `@keyframes ${prefix}aura{0%,${pct(inAt + first)}%{opacity:0}${pct(formedAt + 0.2)}%,${pct(outAt + first)}%{opacity:1}${pct(outAt + first + 1.2)}%,100%{opacity:0}}` +
    `.${prefix}glow{opacity:0;animation:${prefix}glow ${L}s linear infinite}` +
    `@keyframes ${prefix}glow{0%,${pct(plan.solvedAt)}%{opacity:0}${pct(plan.solvedAt + 0.5)}%{opacity:.85}${pct(outAt)}%{opacity:.5}${pct(outAt + 1)}%,100%{opacity:0}}` +
    `.${prefix}burst{opacity:0;transform-box:fill-box;transform-origin:center;animation:${prefix}burst ${L}s linear infinite;animation-delay:${num(plan.solvedAt, 2)}s}` +
    `@keyframes ${prefix}burst{0%{opacity:.9;transform:scale(.2)}${pct(0.8)}%{opacity:0;transform:scale(1.5)}100%{opacity:0;transform:scale(1.5)}}`;

  const total = cells.reduce((n, c) => n + (c.count || 0), 0);
  let hud = '';
  const show = (id, t1, t2, text, fill) => {
    css += `@keyframes ${prefix}${id}{0%{opacity:0}${pct(t1)}%{opacity:1}${pct(t2)}%{opacity:0}100%{opacity:0}}.${prefix}${id}{opacity:0;animation:${prefix}${id} ${L}s step-end infinite}`;
    hud += label(cx, hudY, text, { size: 9, fill, anchor: 'middle', spacing: 0.1, cls: `${prefix}${id}` });
  };
  show('h0', inAt + first + 0.9, plan.seq[0].t0, `BUILT FROM ${total} CONTRIBUTIONS`, PAL.dim);
  show('h1', plan.seq[0].t0, plan.scrambleEnd, `SCRAMBLING · ${plan.n} MOVES`, GAME.past);
  show('h2', plan.scrambleEnd, plan.solveStart, `SCRAMBLED · ${plan.n} MOVES TO GO`, PAL.dim);
  const solve = plan.seq.filter((s) => s.kind === 'solve');
  solve.forEach((s, i) => {
    const end = solve[i + 1]?.t0 ?? s.t1 + 0.1;
    show(`m${i}`, s.t0 - 0.02, end - 0.02, `SOLVING ${String(i + 1).padStart(2, '0')}/${String(plan.n).padStart(2, '0')}  ${formatMove(s.m)}`, GAME.future);
  });
  show('hz', plan.solvedAt, outAt + first, `SOLVED · ${plan.n} MOVES · REVERSED SCRAMBLE`, GAME.hot);
  css += `@media (prefers-reduced-motion: reduce){.${prefix}x{opacity:0}.${prefix}core,.${prefix}aura{opacity:1}.${prefix}hz{opacity:1}.${prefix}glow{opacity:.5}.${prefix}burst{display:none}}`;

  const defs =
    `<radialGradient id="${prefix}au"><stop offset="0" stop-color="${GAME.future}" stop-opacity=".16"/><stop offset=".55" stop-color="${GAME.past}" stop-opacity=".07"/><stop offset="1" stop-color="${GAME.past}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${prefix}gl"><stop offset="0" stop-color="${GAME.future}" stop-opacity=".5"/><stop offset="1" stop-color="${GAME.future}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${prefix}bu"><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="${GAME.hot}" stop-opacity=".8"/><stop offset="1" stop-color="${GAME.hot}" stop-opacity="0"/></radialGradient>` +
    `<filter id="${prefix}sh" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="6"/></filter>`;

  const behind =
    `<g class="${prefix}aura"><circle cx="${num(cx, 1)}" cy="${num(cy, 1)}" r="${num(hullHalfW * 1.55, 1)}" fill="url(#${prefix}au)"/>` +
    `<ellipse cx="${num(cx, 1)}" cy="${num(hullBottom + 7, 1)}" rx="${num(hullHalfW * 0.82, 1)}" ry="9" fill="#000" opacity=".6" filter="url(#${prefix}sh)"/></g>` +
    `<circle class="${prefix}glow" cx="${num(cx, 1)}" cy="${num(cy, 1)}" r="${num(hullHalfW * 1.5, 1)}" fill="url(#${prefix}gl)"/>`;
  const front =
    `<polygon class="${prefix}core" points="${hullPts}" fill="#070a11" stroke="#1d2740" stroke-width="1" stroke-linejoin="round"/>` +
    groupsA +
    groupsB +
    `<circle class="${prefix}burst" cx="${num(cx, 1)}" cy="${num(cy, 1)}" r="${num(hullHalfW * 1.25, 1)}" fill="url(#${prefix}bu)"/>`;

  return {
    css,
    defs,
    under: absorbed + behind, // cells being drawn into the cube, and the light around it
    body: front + hud,
    meta: {
      stickers: drawn,
      fromCells: primary.length,
      absorbed: cells.length - taken.size,
      formedAt,
      scrambleStart: plan.seq[0].t0,
      scrambleEnd: plan.scrambleEnd,
      solveStart: plan.solveStart,
      solvedAt: plan.solvedAt,
      scramble: plan.scr.map(formatMove).join(' '),
      solution: plan.sol.map(formatMove).join(' '),
      contributions: total,
    },
  };
}
