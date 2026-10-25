// HERO BANNER: pixel-cell wordmark with a travelling shimmer, a drifting starfield,
// orbiting rings and a cycling tagline. Pure CSS/SMIL, no scripts.

import { layoutText } from '../../site/lib/font5x7.mjs';
import { mulberry32 } from '../../site/lib/rng.mjs';
import { zoneParts, hhmm } from '../../site/lib/timeutil.mjs';
import { PAL, FONT, num, esc, mix, svgDoc, cardDefs, card, label, clockMark, ago } from './common.mjs';

const W = 830;
const H = 240;
const PITCH = 10.6;
const CELL = 8.6;
const X0 = 28;
const Y0 = 58;
const TAG_SECONDS = 3.6;

function stars(rng, n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const r = [0.5, 0.7, 0.9, 1.2, 1.6][(rng() * 5) | 0];
    const o = 0.25 + rng() * 0.6;
    const col = rng() < 0.12 ? PAL.gold : rng() < 0.3 ? PAL.cyan : '#fff';
    out += `<circle cx="${num(rng() * W, 1)}" cy="${num(rng() * H, 1)}" r="${r}" fill="${col}" class="st" style="--o:${num(o, 2)};--p:${num(o * 0.2, 2)};animation-duration:${num(2.2 + rng() * 4.5, 1)}s;animation-delay:-${num(rng() * 6, 1)}s"/>`;
  }
  return out;
}

function orbit(cx, cy, rx, ry, rot, color, period, r = 3.4) {
  const path = `M${rx} 0A${rx} ${ry} 0 1 1 ${-rx} 0A${rx} ${ry} 0 1 1 ${rx} 0Z`;
  return (
    `<g transform="translate(${cx} ${cy}) rotate(${rot})">` +
    `<ellipse rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-opacity=".2" stroke-dasharray="1 5"/>` +
    `<circle r="${r + 4}" fill="${color}" opacity=".18"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}"/></circle>` +
    `<circle r="${r}" fill="${color}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}"/></circle>` +
    `</g>`
  );
}

function dial(cx, cy, r) {
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const len = i % 5 === 0 ? 7 : 3.2;
    ticks += `M${num(cx + Math.sin(a) * (r - len), 1)} ${num(cy - Math.cos(a) * (r - len), 1)}L${num(cx + Math.sin(a) * r, 1)} ${num(cy - Math.cos(a) * r, 1)}`;
  }
  return (
    `<g><path d="${ticks}" stroke="${PAL.cyan}" stroke-opacity=".28" stroke-width="1" fill="none"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r - 12}" fill="none" stroke="${PAL.cyan}" stroke-opacity=".1"/>` +
    `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="240s" repeatCount="indefinite"/></g>`
  );
}

export function renderBanner({ cfg, data, now }) {
  const tz = cfg.home.tz;
  const parts = zoneParts(now, tz);
  const [first, second] = cfg.wordmark;
  const lay = layoutText(`${first} ${second}`, { gap: 1, spaceW: 3 });
  const split = lay.glyphs.find((g, i) => i === first.length)?.x ?? lay.width; // first column of 2nd word

  const rects = [];
  const halo = { a: [], b: [] };
  for (const [cx, cy] of lay.cells) {
    const isSecond = cx >= split;
    const t = isSecond ? (cx - split) / 22 : cx / (split - 3);
    const color = isSecond ? mix(PAL.gold, PAL.orange, t) : mix(PAL.cyan, '#e9f6ff', t * 0.85);
    const x = num(X0 + cx * PITCH, 1);
    const y = num(Y0 + cy * PITCH, 1);
    const delay = cx * 0.032 + cy * 0.012;
    rects.push(`<rect class="p" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" style="--c:${color};--d:${num(delay, 2)}s"/>`);
    halo[isSecond ? 'b' : 'a'].push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2"/>`);
  }

  const rng = mulberry32(2026);
  const latest = data.repos.reduce((m, r) => (r.pushedAt > m ? r.pushedAt : m), '');
  const taglines = cfg.taglines
    .map(
      (t, k) =>
        `<text class="tg${k === 0 ? ' tg0' : ''}" x="${X0}" y="${Y0 + 7 * PITCH + 38}" font-family='${FONT}' font-size="15" fill="${PAL.ink}" style="animation-delay:${num(k * TAG_SECONDS, 1)}s">${esc(t)}</text>`,
    )
    .join('');
  const cycle = TAG_SECONDS * cfg.taglines.length;

  const stat = (x, text, color) =>
    `<path d="M${x} ${H - 23}l3.5 3.5-3.5 3.5-3.5-3.5z" fill="${color}"/>` + label(x + 10, H - 16, text, { size: 9.5, fill: PAL.dim, spacing: 0.14 });

  const css = `
.st{opacity:var(--o);animation:tw 4s ease-in-out infinite}
@keyframes tw{0%,100%{opacity:var(--o)}50%{opacity:var(--p)}}
.p{fill:var(--c);animation:sh 8.4s linear infinite;animation-delay:var(--d)}
@keyframes sh{0%{fill:var(--c)}5%{fill:#fff}13%,100%{fill:var(--c)}}
.tg{opacity:0;animation:tg ${cycle}s linear infinite}
@keyframes tg{0%{opacity:0;transform:translateY(7px)}3%{opacity:1;transform:translateY(0)}${num((100 / cfg.taglines.length) * 0.86, 2)}%{opacity:1;transform:translateY(0)}${num(100 / cfg.taglines.length, 2)}%{opacity:0;transform:translateY(-5px)}100%{opacity:0}}
.pulse{animation:pulse 5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.8}}
.sweep{animation:sweep 6s cubic-bezier(.5,0,.5,1) infinite}
@keyframes sweep{0%{transform:translateX(-160px)}100%{transform:translateX(${W + 40}px)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.tg0{opacity:1}}`.trim();

  const defs =
    cardDefs('b') +
    `<radialGradient id="bgl1" cx="0.82" cy="0.18" r="0.7"><stop offset="0" stop-color="${PAL.cyan}" stop-opacity=".2"/><stop offset="1" stop-color="${PAL.cyan}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="bgl2" cx="0.08" cy="1" r="0.6"><stop offset="0" stop-color="${PAL.violet}" stop-opacity=".22"/><stop offset="1" stop-color="${PAL.violet}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="bsw" x1="0" x2="1"><stop offset="0" stop-color="${PAL.cyan}" stop-opacity="0"/><stop offset=".7" stop-color="${PAL.cyan}" stop-opacity=".9"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<filter id="bblur" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>` +
    `<clipPath id="bclip"><rect width="${W}" height="${H}" rx="14"/></clipPath>`;

  const body = [
    card('b', 0, 0, W, H),
    `<g clip-path="url(#bclip)">`,
    `<rect width="${W}" height="${H}" fill="url(#bgl1)"/><rect width="${W}" height="${H}" fill="url(#bgl2)"/>`,
    stars(rng, 64),
    dial(690, 112, 104),
    orbit(690, 112, 150, 46, -16, PAL.violet, 26),
    orbit(690, 112, 96, 30, 24, PAL.gold, 14, 3),
    orbit(690, 112, 210, 70, 8, PAL.cyan, 44, 2.6),
    `<g class="pulse" filter="url(#bblur)" fill="${PAL.cyan}">${halo.a.join('')}</g>`,
    `<g class="pulse" filter="url(#bblur)" fill="${PAL.gold}">${halo.b.join('')}</g>`,
    rects.join(''),
    `<rect class="sweep" x="0" y="${H - 2}" width="160" height="2" fill="url(#bsw)"/>`,
    `</g>`,
    clockMark(36, 30, 6.2),
    label(50, 34, `${cfg.displayName.toUpperCase()} · INDEPENDENT RESEARCHER`, { size: 10.5, fill: PAL.dim, spacing: 0.22, weight: 700 }),
    label(W - 28, 34, `SYNC ${hhmm(parts)} ${parts.tzName}`, { size: 10, fill: PAL.gold, anchor: 'end', spacing: 0.16 }),
    taglines,
    stat(X0 + 1, `${data.user.publicRepos} PUBLIC REPOS`, PAL.cyan),
    stat(X0 + 150, `${data.contrib.total} CONTRIBUTIONS / 12 MO`, PAL.mint),
    stat(X0 + 358, `LAST PUSH ${ago(latest, now)} AGO`, PAL.gold),
    stat(X0 + 522, `${cfg.home.label}, CA`, PAL.violet),
  ].join('');

  const svg = svgDoc({
    w: W,
    h: H,
    title: `${first}${second} · ${cfg.displayName}`,
    desc: `Animated banner for ${cfg.displayName} (${cfg.login}): ${cfg.taglines.join(' ')}`,
    defs,
    css,
    body,
  });
  return { svg, meta: { latestPush: latest } };
}
