// INSTRUMENT ROW: a self-solving cube, an orrery of the newest repos, and time dials.
// Three cards in one 830px-wide image, the same width as GitHub's README column.

import { sunPosition, sunTimes, moonPhase } from '../../site/lib/astro.mjs';
import { zoneParts, hhmm, progress, pad2 } from '../../site/lib/timeutil.mjs';
import { hash32 } from '../../site/lib/rng.mjs';
import { PAL, FONT, num, esc, svgDoc, cardDefs, card, label } from './common.mjs';
import { buildCube } from './cube.mjs';

const W = 830;
const H = 252;
const CARD_W = 270;
const XS = [0, 280, 560];
const PLANET_COLORS = [PAL.gold, PAL.cyan, PAL.mint, PAL.violet, PAL.pink, PAL.orange, '#8fb8ff'];

const text = (x, y, s, o = {}) => label(x, y, s, o);

// ---------------------------------------------------------------- cube card
function cubeCard(x0, { cfg, now, parts }) {
  const seed = hash32(`${parts.year}-${parts.month}-${parts.day}-${hhmm(parts)}`);
  const cube = buildCube({ cx: x0 + 135, cy: 124, scale: 38, seed, moves: 14, prefix: 'k' });
  const { loop, solvedAt, hold0, schedule } = cube.meta;
  const pct = (t) => num((t / loop) * 100, 3);

  let css = cube.css;
  css += `.kglow{opacity:0;animation:kglow ${loop}s linear infinite}@keyframes kglow{0%,${pct(solvedAt)}%{opacity:0}${pct(solvedAt + 0.5)}%{opacity:.8}${pct(loop - 0.6)}%{opacity:.5}100%{opacity:0}}`;
  css += `.kburst{opacity:0;transform-box:fill-box;transform-origin:center;animation:kburst ${loop}s linear infinite}@keyframes kburst{0%{opacity:.9;transform:scale(.2)}${pct(0.7)}%{opacity:0;transform:scale(1.5)}100%{opacity:0;transform:scale(1.5)}}`;

  // HUD: scrambled -> move ticker -> solved, shown with hard steps
  let hud = '';
  const show = (id, t1, t2, svg) => {
    css += `@keyframes ${id}{0%{opacity:0}${pct(t1)}%{opacity:1}${pct(t2)}%{opacity:0}100%{opacity:0}}.${id}{opacity:0;animation:${id} ${loop}s step-end infinite}`;
    hud += svg.replace('<text ', `<text class="${id}" `);
  };
  const hy = H - 22;
  show('hud0', 0, hold0 - 0.05, text(x0 + 18, hy, `SCRAMBLED · ${schedule.length} MOVES TO GO`, { size: 9.5, fill: PAL.dim }));
  schedule.forEach((s, i) => {
    const end = schedule[i + 1]?.t0 ?? s.t1 + 0.1;
    show(`hud${i + 1}`, s.t0 - 0.02, end - 0.02, text(x0 + 18, hy, `MOVE ${pad2(i + 1)}/${pad2(schedule.length)}  ${s.move}`, { size: 9.5, fill: PAL.cyan }));
  });
  show('hudz', solvedAt, loop - 0.4, text(x0 + 18, hy, `SOLVED · ${schedule.length} MOVES · REVERSED SCRAMBLE`, { size: 9.5, fill: PAL.mint }));

  css += `@media (prefers-reduced-motion: reduce){.hudz{opacity:1;animation:none!important}.kglow{opacity:.5;animation:none!important}.kburst{display:none}}`;

  const defs =
    `<radialGradient id="kgl"><stop offset="0" stop-color="${PAL.mint}" stop-opacity=".55"/><stop offset="1" stop-color="${PAL.mint}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="kbu"><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset=".85" stop-color="${PAL.cyan}" stop-opacity=".8"/><stop offset="1" stop-color="${PAL.cyan}" stop-opacity="0"/></radialGradient>` +
    `<filter id="ksh" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>`;

  const body =
    card('i', x0, 0, CARD_W, H) +
    text(x0 + 18, 29, 'SELF-SOLVING CUBE', { size: 10.5, fill: PAL.cyan, spacing: 0.2, weight: 700 }) +
    text(x0 + CARD_W - 18, 29, `#${hhmm(parts).replace(':', '')}`, { size: 9.5, fill: PAL.faint, anchor: 'end' }) +
    `<circle class="kglow" cx="${x0 + 135}" cy="126" r="118" fill="url(#kgl)"/>` +
    `<ellipse cx="${x0 + 135}" cy="${H - 52}" rx="82" ry="13" fill="#000" opacity=".55" filter="url(#ksh)"/>` +
    cube.body +
    `<circle class="kburst" cx="${x0 + 135}" cy="124" r="96" fill="url(#kbu)"/>` +
    hud;
  return { css, defs, body, meta: cube.meta };
}

// ---------------------------------------------------------------- orrery card
const ORRERY_SAMPLES = 72;

/** Position (unrotated orbit frame) at each of n+1 equal-time steps of a paced ellipse orbit. */
function orbitTrack(rx, ry, n) {
  const cum = [0];
  let prev = [rx, 0];
  for (let i = 1; i <= 720; i++) {
    const th = (i / 720) * Math.PI * 2;
    const p = [rx * Math.cos(th), ry * Math.sin(th)];
    cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[720];
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * total;
    while (j < 719 && cum[j + 1] < target) j++;
    const u = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    const th = ((j + u) / 720) * Math.PI * 2;
    out.push([rx * Math.cos(th), ry * Math.sin(th)]);
  }
  return out;
}

function orreryCard(x0, { cfg, data, now }) {
  const cx = x0 + 135;
  const cy = 136;
  const repos = data.repos
    .filter((r) => r.name !== cfg.login && !r.fork && !r.archived)
    .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1))
    .slice(0, 7);

  const tilt = -14;
  const cosT = Math.cos((tilt * Math.PI) / 180);
  const sinT = Math.sin((tilt * Math.PI) / 180);
  const CH = 5.1; // monospace glyph advance at 8.5px
  const pad = 9;
  let rings = '';
  let planets = '';
  repos.forEach((r, i) => {
    const rx = 32 + i * 13.2;
    const ry = rx * 0.58;
    const period = 7 * (rx / 32) ** 1.45;
    const color = PLANET_COLORS[i % PLANET_COLORS.length];
    const size = 2.5 + Math.min(3.4, Math.log10(1 + r.size) * 0.5 + r.stars * 0.9);
    const phase = ((hash32(r.name) % 1000) / 1000) * period;
    const path = `M${num(rx, 1)} 0A${num(rx, 1)} ${num(ry, 1)} 0 1 1 ${num(-rx, 1)} 0A${num(rx, 1)} ${num(ry, 1)} 0 1 1 ${num(rx, 1)} 0Z`;
    rings += `<ellipse rx="${num(rx, 1)}" ry="${num(ry, 1)}" fill="none" stroke="${color}" stroke-opacity=".16"/>`;
    const name = r.name.length > 13 ? r.name.slice(0, 12) + '…' : r.name;
    const need = size + 5 + name.length * CH;

    // The label sits on whichever side of the planet has room, and fades while neither does.
    const track = orbitTrack(rx, ry, ORRERY_SAMPLES);
    const keyTimes = track.map((_, k) => num(k / ORRERY_SAMPLES, 4)).join(';');
    const fade = (v) => Math.max(0, Math.min(1, v / 14));
    const right = [];
    const left = [];
    for (const [px, py] of track) {
      const sx = cx + px * cosT - py * sinT;
      const fr = fade(x0 + CARD_W - pad - (sx + need));
      const fl = fade(sx - need - (x0 + pad));
      right.push(num(fr, 2));
      left.push(num(Math.min(fl, 1 - fr), 2));
    }
    const anim = (vals) =>
      `<animate attributeName="opacity" dur="${num(period, 1)}s" begin="-${num(phase, 1)}s" repeatCount="indefinite" keyTimes="${keyTimes}" values="${vals.join(';')}"/>`;
    const txt = (anchor, x, vals) =>
      `<text class="pl" transform="rotate(${-tilt})" x="${x}" y="3" text-anchor="${anchor}" font-family='${FONT}' font-size="8.5" fill="${PAL.ink}" opacity="${vals[0]}">${esc(name)}${anim(vals)}</text>`;
    planets +=
      `<g><animateMotion dur="${num(period, 1)}s" begin="-${num(phase, 1)}s" repeatCount="indefinite" path="${path}"/>` +
      `<circle r="${num(size + 3.5, 1)}" fill="${color}" opacity=".16"/>` +
      `<circle r="${num(size, 1)}" fill="${color}"/>` +
      (r.langColor ? `<circle r="${num(size + 1.2, 1)}" fill="none" stroke="${r.langColor}" stroke-width="1" stroke-opacity=".9"/>` : '') +
      txt('start', num(size + 5, 1), right) +
      txt('end', num(-(size + 5), 1), left) +
      `</g>`;
  });

  const rays = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2;
    return `M${num(Math.cos(a) * 11, 1)} ${num(Math.sin(a) * 11, 1)}L${num(Math.cos(a) * (k % 2 ? 15 : 19), 1)} ${num(Math.sin(a) * (k % 2 ? 15 : 19), 1)}`;
  }).join('');

  const css = `.pl{paint-order:stroke;stroke:#070b14;stroke-width:2.6px;stroke-linejoin:round}.sun{animation:sunp 3.6s ease-in-out infinite}@keyframes sunp{0%,100%{opacity:.7}50%{opacity:1}}@media (prefers-reduced-motion: reduce){*{animation:none!important}}`;
  const defs =
    `<radialGradient id="osun"><stop offset="0" stop-color="#fff6d6"/><stop offset=".35" stop-color="${PAL.gold}"/><stop offset="1" stop-color="${PAL.gold}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="oclip"><rect x="${x0 + 1}" y="1" width="${CARD_W - 2}" height="${H - 2}" rx="13"/></clipPath>`;
  const body =
    card('i', x0, 0, CARD_W, H) +
    text(x0 + 18, 29, 'REPO ORRERY', { size: 10.5, fill: PAL.gold, spacing: 0.2, weight: 700 }) +
    text(x0 + CARD_W - 18, 29, `${repos.length} ORBITS`, { size: 9.5, fill: PAL.faint, anchor: 'end' }) +
    `<g clip-path="url(#oclip)"><g transform="translate(${cx} ${cy}) rotate(${tilt})">${rings}${planets}` +
    `<circle class="sun" r="17" fill="url(#osun)"/><path d="${rays}" stroke="${PAL.gold}" stroke-width="1.2" stroke-linecap="round" opacity=".8"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="40s" repeatCount="indefinite"/></path><circle r="6" fill="#fff6d6"/></g></g>` +
    text(x0 + 18, H - 22, 'INNER ORBIT = FRESHEST PUSH', { size: 9.5, fill: PAL.dim });
  return { css, defs, body };
}

// ---------------------------------------------------------------- dials card
function moonShape(cx, cy, r, illum, waxing) {
  const f = 1 - 2 * illum;
  const rx = Math.abs(f) * r;
  const top = `${num(cx, 1)} ${num(cy - r, 1)}`;
  const bot = `${num(cx, 1)} ${num(cy + r, 1)}`;
  const limb = waxing ? 1 : 0;
  const term = waxing ? (f > 0 ? 0 : 1) : f > 0 ? 1 : 0;
  return `M${top}A${r} ${r} 0 0 ${limb} ${bot}A${num(rx, 2)} ${r} 0 0 ${term} ${top}Z`;
}

function dialsCard(x0, { cfg, now, parts }) {
  const tz = cfg.home.tz;
  const { lat, lon } = cfg.home;
  const moon = moonPhase(now);
  const waxing = moon.phase < 0.5;

  // daylight curve over the local day (sampled every 20 minutes)
  const day0 = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offsetMin = (() => {
    const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((asUTC - Math.floor(now.getTime() / 1000) * 1000) / 60000);
  })();
  const localMidnightUTC = day0.getTime() - offsetMin * 60000;
  const gx = x0 + 112;
  const gw = 140;
  const yh = 74;
  const k = 0.55;
  const pts = [];
  for (let m = 0; m <= 1440; m += 20) {
    const e = sunPosition(new Date(localMidnightUTC + m * 60000), lat, lon).elevation;
    pts.push([gx + (m / 1440) * gw, yh - e * k]);
  }
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x, 1)} ${num(y, 1)}`).join('');
  const nowM = parts.hour * 60 + parts.minute;
  const nowE = sunPosition(now, lat, lon).elevation;
  const nx = gx + (nowM / 1440) * gw;
  const ny = yh - nowE * k;
  const st = sunTimes(new Date(localMidnightUTC + 12 * 3600e3), lat, lon);
  const tzTime = (d) => {
    const p = zoneParts(d, tz);
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
  };

  const pr = progress(now, tz);
  const rings = [
    ['DAY', pr.day, PAL.cyan],
    ['WEEK', pr.week, PAL.mint],
    ['MONTH', pr.month, PAL.gold],
    ['YEAR', pr.year, PAL.pink],
  ];
  const R = 19;
  const C = 2 * Math.PI * R;
  let ringEls = '';
  rings.forEach(([name, v, color], i) => {
    const rx = x0 + 39 + i * 64;
    const ry = 176;
    ringEls +=
      `<circle cx="${rx}" cy="${ry}" r="${R}" fill="none" stroke="#18243c" stroke-width="5"/>` +
      `<circle class="arc" cx="${rx}" cy="${ry}" r="${R}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" transform="rotate(-90 ${rx} ${ry})" stroke-dasharray="${num(C, 1)}" style="--c:${num(C, 1)};--o:${num(C * (1 - v), 1)};stroke-dashoffset:${num(C * (1 - v), 1)};animation-delay:${num(i * 0.15, 2)}s"/>` +
      `<text x="${rx}" y="${ry + 3.4}" text-anchor="middle" font-family='${FONT}' font-size="9.5" font-weight="700" fill="${PAL.ink}">${Math.round(v * 100)}%</text>` +
      label(rx, ry + 36, name, { size: 8.5, fill: PAL.dim, anchor: 'middle', spacing: 0.14 });
  });

  const css = `.arc{animation:draw 12s ease-out infinite}@keyframes draw{0%{stroke-dashoffset:var(--c)}9%,100%{stroke-dashoffset:var(--o)}}.nowdot{animation:np 2.4s ease-in-out infinite}@keyframes np{0%,100%{opacity:.5}50%{opacity:1}}@media (prefers-reduced-motion: reduce){*{animation:none!important}}`;
  const defs =
    `<linearGradient id="dday" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PAL.gold}" stop-opacity=".5"/><stop offset="1" stop-color="${PAL.gold}" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="dsky"><rect x="${gx}" y="${yh - 40}" width="${gw}" height="40"/></clipPath>`;

  const body =
    card('i', x0, 0, CARD_W, H) +
    text(x0 + 18, 29, 'CHRONO-DIALS', { size: 10.5, fill: PAL.mint, spacing: 0.2, weight: 700 }) +
    text(x0 + CARD_W - 18, 29, `${cfg.home.label}`, { size: 9.5, fill: PAL.faint, anchor: 'end' }) +
    // moon
    `<circle cx="${x0 + 58}" cy="76" r="25" fill="#101a2e" stroke="#26385a"/>` +
    `<clipPath id="mlit"><path d="${moonShape(x0 + 58, 76, 25, moon.illum, waxing)}"/></clipPath>` +
    `<path d="${moonShape(x0 + 58, 76, 25, moon.illum, waxing)}" fill="#e9eefc"/>` +
    `<g clip-path="url(#mlit)" fill="#8d9ccb" opacity=".42"><circle cx="${x0 + 50}" cy="68" r="6.5"/><circle cx="${x0 + 66}" cy="84" r="5"/><circle cx="${x0 + 57}" cy="88" r="3"/><circle cx="${x0 + 68}" cy="66" r="3.4"/><circle cx="${x0 + 46}" cy="82" r="2.6"/></g>` +
    `<circle cx="${x0 + 58}" cy="76" r="25" fill="none" stroke="#fff" stroke-opacity=".12"/>` +
    text(x0 + 58, 118, moon.name.toUpperCase(), { size: 8, fill: PAL.dim, anchor: 'middle', spacing: 0.08 }) +
    text(x0 + 58, 130, `${Math.round(moon.illum * 100)}% LIT`, { size: 8, fill: PAL.ink, anchor: 'middle', spacing: 0.1 }) +
    // daylight curve
    `<line x1="${gx}" y1="${yh}" x2="${gx + gw}" y2="${yh}" stroke="#2c4066" stroke-dasharray="2 3"/>` +
    `<path d="${line}L${gx + gw} ${yh}L${gx} ${yh}Z" fill="url(#dday)" clip-path="url(#dsky)"/>` +
    `<path d="${line}" fill="none" stroke="${PAL.gold}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle class="nowdot" cx="${num(nx, 1)}" cy="${num(ny, 1)}" r="7" fill="${PAL.gold}" opacity=".35"/>` +
    `<circle cx="${num(nx, 1)}" cy="${num(ny, 1)}" r="3.4" fill="${nowE > 0 ? '#fff6d6' : PAL.violet}"/>` +
    (st.sunrise ? text(gx, yh + 46, `↑ ${tzTime(st.sunrise)}`, { size: 8.5, fill: PAL.dim, spacing: 0.06 }) : '') +
    (st.sunset ? text(gx + gw, yh + 46, `↓ ${tzTime(st.sunset)}`, { size: 8.5, fill: PAL.dim, anchor: 'end', spacing: 0.06 }) : '') +
    text(gx + gw / 2, yh + 46, nowE > 0 ? 'DAYLIGHT' : 'NIGHT', { size: 8, fill: nowE > 0 ? PAL.gold : PAL.violet, anchor: 'middle', spacing: 0.14 }) +
    ringEls +
    text(x0 + 18, H - 22, 'ELAPSED AT SYNC · LIVE ON THE SITE', { size: 9.5, fill: PAL.dim });
  return { css, defs, body };
}

export function renderInstruments({ cfg, data, now }) {
  const parts = zoneParts(now, cfg.home.tz);
  const ctx = { cfg, data, now, parts };
  const cards = [cubeCard(XS[0], ctx), orreryCard(XS[1], ctx), dialsCard(XS[2], ctx)];
  const svg = svgDoc({
    w: W,
    h: H,
    title: 'Instruments: self-solving cube, repo orrery, time dials',
    desc: 'A Rubik’s cube that scrambles and solves itself, an orrery where the most recently pushed repositories orbit closest, and dials for moon phase, daylight and how far through the day, week, month and year it is.',
    defs: cardDefs('i') + cards.map((c) => c.defs).join(''),
    css: cards.map((c) => c.css).join('\n'),
    body: cards.map((c) => c.body).join(''),
  });
  return { svg, meta: { cube: cards[0].meta } };
}
