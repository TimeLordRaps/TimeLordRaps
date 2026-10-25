// CHRONO-GRID: the real contribution graph reforms into the time, Pong is played
// inside the digits, the right-hand block of contributions folds into a Rubik's cube that
// scrambles and solves itself, then everything melts back into the activity.
// One 32s CSS loop, no scripts. Every cell keeps its real activity level: the days you
// were busiest are the brightest pixels of the clock.

import { layoutText } from '../../site/lib/font5x7.mjs';
import { recordRally, simplifyChannel } from '../../site/lib/pong.mjs';
import { bayLayout, camera, cubeExtent, cellDelay, STORY } from '../../site/lib/cellcube.mjs';
import { hash32 } from '../../site/lib/rng.mjs';
import { zoneParts, hhmm, dateLabel, monthName, progress } from '../../site/lib/timeutil.mjs';
import { PAL, ACT, CLK, GLOW, GAME, num, mix, svgDoc, cardDefs, card, label, clockMark } from './common.mjs';
import { buildCellCube } from './cube.mjs';

const W = 830;
const H = 224;
const L = 32; // loop length, seconds
const P = 15; // cell pitch
const C = 12; // cell size
const COLS = 53;
const ROWS = 7;
const GX = (W - COLS * P) / 2;
const GY = 56;
const MORPH_IN = 8; // seconds into the loop
const MORPH_OUT = 26;
const MORPH = 1; // per-cell transition length
const WAVE = STORY.wave; // left-to-right stagger across the whole graph
const POP = { t0: 11.4, dur: 13.8 }; // pong window inside the loop
const CUBE_PX = 136; // height of the cube on the page
const CUBE_MOVES = 9;

const pct = (t) => num((t / L) * 100, 3);
const cellX = (i) => GX + i * P + (P - C) / 2;
const cellY = (j) => GY + j * P + (P - C) / 2;
const courtY = (y) => GY + y * P;

function pickRally(day, court) {
  const k = Math.sqrt(court.w / 53); // a shorter court gets a slower ball
  const opts = { w: court.w, paddleX: court.paddleX, speed: 24 * k, maxSpeed: 38 * k };
  for (let seed = 1000 + day * 13; seed < 1000 + day * 13 + 600; seed++) {
    const r = recordRally(POP.dur, { seed, ...opts }, 60);
    const hits = r.events.filter((e) => e.type === 'hit').length;
    const scores = r.events.filter((e) => e.type === 'score');
    if (hits < 5 || hits > 9 || scores.length < 1 || scores.length > 2 || scores[0].t < 3.5) continue;
    if (!r.frames.at(-1)[5]) continue;
    return { seed, ...r };
  }
  throw new Error('no suitable rally found');
}

/** Piecewise-linear CSS keyframes (as a transform) from sampled frames. */
function transformKeyframes(name, frames, channels, toTransform, jumpAt = null) {
  const keep = new Set();
  for (const ch of channels) for (const i of simplifyChannel(frames, ch, 0.04)) keep.add(i);
  const idx = [...keep].sort((a, b) => a - b);
  const pts = [];
  for (let k = 0; k < idx.length; k++) {
    const f = frames[idx[k]];
    const t = POP.t0 + f[0];
    const prev = pts.at(-1);
    // A teleport (ball reset after a point) must not smear across the court.
    if (jumpAt && prev && Math.abs(f[jumpAt] - prev.f[jumpAt]) > 3) pts.push({ t: t - 0.002, f: prev.f });
    pts.push({ t, f });
  }
  const first = pts[0];
  const last = pts.at(-1);
  const rows = [`0%{transform:${toTransform(first.f)}}`];
  for (const p of pts) rows.push(`${pct(p.t)}%{transform:${toTransform(p.f)}}`);
  rows.push(`100%{transform:${toTransform(last.f)}}`);
  return `@keyframes ${name}{${rows.join('')}}`;
}

export function renderChronogrid({ cfg, data, now }) {
  const tz = cfg.home.tz;
  const parts = zoneParts(now, tz);
  const time = hhmm(parts);
  const day = Math.floor(progress(now, tz).dayOfYear);

  // --- grid cells from the real activity data -------------------------------------
  const cells = [];
  data.contrib.weeks.forEach((week, i) => {
    for (const d of week) {
      const j = new Date(d.d + 'T00:00:00Z').getUTCDay();
      cells.push({ i, j, level: d.l, count: d.c, date: d.d });
    }
  });

  // --- the clock on the left, the cube's bay on the right ---------------------------
  const lay = layoutText(time, { colonGap: 2 });
  const plan = bayLayout({ cols: COLS, rows: ROWS, clockWidth: lay.width });
  if (!plan) throw new Error('the graph is too narrow for the clock and the cube');
  const off = plan.clockOff;
  const court = plan.court;
  const courtX = (x) => GX + (court.x + x) * P;
  const lit = new Set(lay.cells.map(([x, y]) => `${off + x},${y}`));
  const colonGlyph = lay.glyphs.find((g) => g.ch === ':');
  const isColon = (i) => colonGlyph && i === off + colonGlyph.x;
  const inBay = (c) => c.i >= plan.bay.c0 && c.i < plan.bay.c1;

  const bgDark = '#070b14';
  const cellEls = [];
  const glowEls = [];
  const maskEls = [];
  const bayCells = [];
  for (const c of cells) {
    const delay = cellDelay(c.i, c.j, COLS);
    if (inBay(c)) {
      // these become the cube: stickers, or cells that are drawn into it
      bayCells.push({ x: GX + c.i * P + P / 2, y: GY + c.j * P + P / 2, a: ACT[c.level], delay, count: c.count, date: c.date });
      continue;
    }
    const key = `${c.i},${c.j}`;
    const on = lit.has(key);
    const a = ACT[c.level];
    const b = on ? CLK[c.level] : c.level === 0 ? '#0b1220' : mix(a, bgDark, 0.74);
    const x = num(cellX(c.i), 1);
    const y = num(cellY(c.j), 1);
    cellEls.push(`<rect class="c${on && isColon(c.i) ? ' k' : ''}" x="${x}" y="${y}" width="${C}" height="${C}" rx="2.6" style="--a:${a};--b:${b};--d:${num(delay, 2)}s"/>`);
    if (on) {
      const k = isColon(c.i) ? ' class="k"' : '';
      const hx = num(cellX(c.i) + C / 2, 1);
      const hy = num(cellY(c.j) + C / 2, 1);
      glowEls.push(
        `<circle${k} cx="${hx}" cy="${hy}" r="${15 + c.level * 3.2}" fill="url(#gh${c.level})" opacity="${GLOW[c.level]}"/>` +
          `<rect${k} x="${num(cellX(c.i) + 2.6, 1)}" y="${num(cellY(c.j) + 2.6, 1)}" width="${C - 5.2}" height="${C - 5.2}" rx="1.6" fill="#fff" opacity="${num(0.2 + 0.2 * GLOW[c.level], 2)}"/>`,
      );
      maskEls.push(`<rect x="${x}" y="${y}" width="${C}" height="${C}" rx="2.6" fill="#fff" opacity="${num(0.4 + 0.6 * GLOW[c.level], 2)}"/>`);
    }
  }

  // --- the cube, built from the bay -----------------------------------------------------
  const cubeCx = GX + plan.center.x * P;
  const cubeCy = GY + plan.center.y * P;
  const cube = buildCellCube({
    L,
    cx: cubeCx,
    cy: cubeCy,
    scale: CUBE_PX / (2 * cubeExtent(camera()).hy), // px per sticker edge so the silhouette is CUBE_PX tall
    seed: hash32(`${parts.year}-${parts.month}-${parts.day}-${time}`),
    moves: CUBE_MOVES,
    cells: bayCells,
    size: C,
    inAt: MORPH_IN,
    outAt: MORPH_OUT,
    hudY: 190,
  });

  // --- month ticks along the top ----------------------------------------------------
  const months = [];
  let prevMonth = -1;
  let lastCol = -9;
  data.contrib.weeks.forEach((week, i) => {
    const m = +week[0].d.slice(5, 7);
    if (m !== prevMonth && i - lastCol >= 3) {
      months.push(label(GX + i * P + 1, GY - 8, monthName(m), { size: 8.5, fill: PAL.faint, spacing: 0.1 }));
      lastCol = i;
    }
    prevMonth = m;
  });

  // --- pong, baked from the shared simulation ---------------------------------------
  const rally = pickRally(day, court);
  const ballT = (f) => `translate(${num(courtX(f[1]), 1)}px,${num(courtY(f[2]), 1)}px)`;
  const padT = (ch) => (f) => `translateY(${num(courtY(f[ch] - 1.3), 1)}px)`;
  const padH = 2.6 * P;
  const padW = 0.8 * P;
  const kf = [
    transformKeyframes('ball', rally.frames, [1, 2], ballT, 1),
    transformKeyframes('padL', rally.frames, [3], padT(3)),
    transformKeyframes('padR', rally.frames, [4], padT(4)),
  ].join('');

  const rings = rally.events
    .filter((e) => e.type === 'hit' || e.type === 'wall')
    .map((e) => {
      const hit = e.type === 'hit';
      const col = hit ? (e.side === 0 ? GAME.past : GAME.future) : GAME.hot;
      return `<circle class="ring" cx="${num(courtX(e.x), 1)}" cy="${num(courtY(e.y), 1)}" r="${hit ? 7 : 4.5}" fill="none" stroke="${col}" stroke-width="${hit ? 2 : 1.4}" style="animation-delay:${num(POP.t0 + e.t, 3)}s"/>`;
    })
    .join('');

  // score states, shown with hard steps
  const states = [{ t: 0, s: [0, 0] }];
  for (const e of rally.events.filter((x) => x.type === 'score')) {
    const s = states.at(-1).s.slice();
    s[e.side]++;
    states.push({ t: e.t, s });
  }
  let scoreCss = '';
  let scoreEls = '';
  states.forEach((st, k) => {
    const t1 = k === 0 ? 0 : POP.t0 + st.t;
    const t2 = k === states.length - 1 ? POP.t0 + POP.dur : POP.t0 + states[k + 1].t;
    scoreCss += `@keyframes sb${k}{0%{opacity:0}${pct(k === 0 ? POP.t0 - 0.2 : t1)}%{opacity:1}${pct(t2)}%{opacity:0}100%{opacity:0}}.sb${k}{animation:sb${k} ${L}s step-end infinite}`;
    scoreEls +=
      label(courtX(0.9), GY + ROWS * P + 17, `PAST ${st.s[0]}`, { size: 9, fill: GAME.past, cls: `sb sb${k}` }) +
      label(courtX(court.w - 0.9), GY + ROWS * P + 17, `${st.s[1]} FUTURE`, { size: 9, fill: GAME.future, anchor: 'end', cls: `sb sb${k}` });
  });

  const ball0 = rally.frames[0];
  const css = `
.c{fill:var(--a);animation:cell ${L}s linear infinite;animation-delay:var(--d)}
@keyframes cell{0%,${pct(MORPH_IN)}%{fill:var(--a)}${pct(MORPH_IN + MORPH)}%,${pct(MORPH_OUT)}%{fill:var(--b)}${pct(MORPH_OUT + MORPH)}%,100%{fill:var(--a)}}
.k{animation:blink 2s step-end infinite}
.c.k{animation:cell ${L}s linear infinite,blink 2s step-end infinite;animation-delay:var(--d),0s}
@keyframes blink{0%{opacity:1}50%{opacity:.35}}
.glowg{opacity:0;mix-blend-mode:screen;animation:glowg ${L}s linear infinite}
@keyframes glowg{0%,${pct(MORPH_IN)}%{opacity:0}${pct(MORPH_IN + WAVE + MORPH)}%,${pct(MORPH_OUT)}%{opacity:1}${pct(MORPH_OUT + WAVE + MORPH)}%,100%{opacity:0}}
.pong{opacity:0;animation:pong ${L}s linear infinite}
@keyframes pong{0%,${pct(POP.t0 - 1.4)}%{opacity:0}${pct(POP.t0 - 0.4)}%,${pct(POP.t0 + POP.dur + 0.2)}%{opacity:1}${pct(POP.t0 + POP.dur + 1)}%,100%{opacity:0}}
.act{animation:act ${L}s linear infinite}
@keyframes act{0%,${pct(MORPH_IN - 0.4)}%{opacity:1}${pct(MORPH_IN + 0.8)}%,${pct(MORPH_OUT + 0.6)}%{opacity:0}${pct(MORPH_OUT + WAVE + MORPH)}%,100%{opacity:1}}
.clk{opacity:0;animation:clk ${L}s linear infinite}
@keyframes clk{0%,${pct(MORPH_IN + 0.4)}%{opacity:0}${pct(MORPH_IN + WAVE + MORPH)}%,${pct(MORPH_OUT)}%{opacity:1}${pct(MORPH_OUT + 0.8)}%,100%{opacity:0}}
.scan{opacity:0;animation:scan ${L}s linear infinite}
@keyframes scan{0%{transform:translateX(-70px);opacity:0}${pct(0.6)}%{transform:translateX(-70px);opacity:1;animation-timing-function:cubic-bezier(.45,0,.55,1)}${pct(MORPH_IN - 0.4)}%{transform:translateX(${W - 40}px);opacity:1}${pct(MORPH_IN - 0.2)}%,100%{transform:translateX(${W - 40}px);opacity:0}}
.ballg{transform:${ballT(ball0)};animation:ball ${L}s linear infinite}
.t1{animation-delay:.04s}.t2{animation-delay:.08s}.t3{animation-delay:.12s}.t4{animation-delay:.16s}.t5{animation-delay:.2s}
.padl{transform:translateY(${num(courtY(3.5 - 1.3), 1)}px);animation:padL ${L}s linear infinite}
.padr{transform:translateY(${num(courtY(3.5 - 1.3), 1)}px);animation:padR ${L}s linear infinite}
.ring{opacity:0;transform-box:fill-box;transform-origin:center;animation:ring ${L}s linear infinite}
@keyframes ring{0%{opacity:.95;transform:scale(.35)}${num((0.55 / L) * 100, 3)}%{opacity:0;transform:scale(2.6)}100%{opacity:0;transform:scale(2.6)}}
.sb{opacity:0}.sb0{opacity:1}
${scoreCss}
${kf}
${cube.css}
@media (prefers-reduced-motion: reduce){
*{animation:none!important}
.c{fill:var(--b)}.glowg,.pong,.clk{opacity:1}.act,.scan,.ring{opacity:0}
}`.trim();

  const defs =
    cardDefs('g') +
    [0, 1, 2, 3, 4].map((l) => `<radialGradient id="gh${l}"><stop offset="0" stop-color="${CLK[l]}" stop-opacity=".85"/><stop offset=".4" stop-color="${CLK[l]}" stop-opacity=".32"/><stop offset="1" stop-color="${CLK[l]}" stop-opacity="0"/></radialGradient>`).join('') +
    `<radialGradient id="gblob"><stop offset="0" stop-color="${GAME.ball}" stop-opacity=".95"/><stop offset=".45" stop-color="${GAME.future}" stop-opacity=".45"/><stop offset="1" stop-color="${GAME.future}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="gball"><stop offset="0" stop-color="${GAME.future}" stop-opacity=".7"/><stop offset="1" stop-color="${GAME.future}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="gband" x1="0" x2="1"><stop offset="0" stop-color="#6dffb4" stop-opacity="0"/><stop offset=".85" stop-color="#6dffb4" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient>` +
    `<mask id="glit" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${maskEls.join('')}</mask>` +
    cube.defs;

  const padCore = (color) =>
    `<rect x="${num(-padW * 0.9, 1)}" y="-4" width="${num(padW * 1.8, 1)}" height="${padH + 8}" rx="7" fill="${color}" opacity=".22"/>` +
    `<rect x="${num(-padW / 2, 1)}" y="0" width="${padW}" height="${padH}" rx="4" fill="${color}"/>` +
    `<rect x="${num(-padW / 2 + 2, 1)}" y="3" width="2.2" height="${padH - 6}" rx="1.1" fill="#fff" opacity=".55"/>`;

  const trails = [5.0, 4.2, 3.4, 2.6, 1.9]
    .map((r, k) => `<circle class="ballg t${k + 1}" r="${r}" fill="${GAME.future}" opacity="${num(0.5 - k * 0.09, 2)}"/>`)
    .join('');

  const body = [
    card('g', 0, 0, W, H),
    // header
    clockMark(30, 25, 6.5),
    label(44, 29, 'CHRONO-GRID', { size: 11, fill: "#6dffb4", spacing: 0.2, weight: 700 }),
    label(W - 22, 29, `${data.contrib.total} CONTRIBUTIONS · LAST 12 MONTHS`, { size: 10, anchor: 'end', cls: 'act' }),
    label(W - 22, 29, `${time} ${parts.tzName} · ${cfg.home.label}`, { size: 10, anchor: 'end', fill: PAL.gold, cls: 'clk' }),
    `<g class="act">${months.join('')}</g>`,
    // the graph / clock
    `<g>${cellEls.join('')}</g>`,
    // the right-hand block of the graph, folding into the cube
    `<g>${cube.under}</g>`,
    `<g>${cube.body}</g>`,
    `<g class="glowg">${glowEls.join('')}</g>`,
    `<rect class="scan" x="0" y="${GY - 6}" width="40" height="${ROWS * P + 8}" fill="url(#gband)"/>`,
    // pong
    `<g class="pong">`,
    `<g mask="url(#glit)" style="mix-blend-mode:screen"><circle class="ballg" r="62" fill="url(#gblob)"/></g>`,
    `<g transform="translate(${num(courtX(court.paddleX[0]), 1)} 0)"><g class="padl">${padCore(GAME.past)}</g></g>`,
    `<g transform="translate(${num(courtX(court.paddleX[1]), 1)} 0)"><g class="padr">${padCore(GAME.future)}</g></g>`,
    rings,
    trails,
    `<circle class="ballg" r="15" fill="url(#gball)"/>`,
    `<circle class="ballg" r="6.4" fill="${GAME.ball}"/>`,
    `<circle class="ballg" r="6.4" fill="none" stroke="${GAME.future}" stroke-width="1.6"/>`,
    scoreEls,
    `</g>`,
    // footer
    label(22, H - 14, `${dateLabel(parts)} · SYNC ${time} ${parts.tzName} · ${cfg.home.label}`, { size: 9.5, fill: PAL.dim, spacing: 0.12 }),
    label(W - 38, H - 14, 'CLICK FOR LIVE · YOUR TIME ZONE', { size: 9.5, fill: "#6dffb4", anchor: 'end', spacing: 0.12 }),
    `<path d="M${W - 31} ${H - 22}l7.5 4.3-7.5 4.3z" fill="#6dffb4"/>`,
  ].join('');

  const svg = svgDoc({
    w: W,
    h: H,
    title: 'Chrono-Grid: contribution graph that reforms into a clock and a self-solving cube',
    desc: `TimeLordRaps' GitHub activity graph (${data.contrib.total} contributions in the last year) periodically reforms into the time ${time} ${parts.tzName}, with Pong played between PAST and FUTURE inside the digits. The contributions on its right-hand side fold into a Rubik's cube that scrambles and solves itself, then everything melts back into the activity graph.`,
    defs,
    css,
    body,
  });
  return {
    svg,
    meta: {
      time,
      rally: { seed: rally.seed, hits: rally.events.filter((e) => e.type === 'hit').length, score: rally.score },
      cube: cube.meta,
    },
  };
}
