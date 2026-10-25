// The instrument bay. Every instrument is a small object registered with defineInstrument():
//
//   defineInstrument({
//     id, title, accent, size,              // size: any of 'wide' 'narrow' 'half' 'tall' 'short'
//     init(app, item) -> state,
//     draw(g, w, h, state, app, dt, item),  // g is a 2D context already scaled to CSS pixels
//     meta?(state, app) -> string,          // small text in the header
//     foot?(state, app) -> string,          // small text in the footer
//     pointer?(type, x, y, state, app),     // 'move' | 'leave' | 'click'
//   })
//
// `app.clock` is the shared (time-machine) clock and `app.focus` the zone being shown, so a
// new instrument only has to read those two to join in.

import { sunPosition, sunTimes, moonPhase, moonPosition, julianDay } from '../lib/astro.mjs';
import { zoneParts, zoneOffsetMinutes, progress, pad2 } from '../lib/timeutil.mjs';
import { layoutText } from '../lib/font5x7.mjs';
import { hash32, mulberry32 } from '../lib/rng.mjs';
import { CONFIG } from './config.js';
import { clamp, lerp, TAU, hex, roundRectPath, ago, fitCanvas } from './util.js';

export const REGISTRY = [];
export const defineInstrument = (def) => (REGISTRY.push(def), def);

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
const INK = '#dbe7ff';
const DIM = '#8da0c4';
const FAINT = '#51648c';
const PLANET = ['#ffc857', '#46e0ff', '#4ff0b4', '#a287ff', '#ff5f9e', '#ff9f45', '#8fb8ff'];

function txt(g, s, x, y, { size = 10, color = DIM, align = 'left', weight = 600, spacing = 0, base = 'alphabetic' } = {}) {
  g.font = `${weight} ${size}px ${MONO}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
  g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}

/** Draw a string with the 5x7 pixel font. Returns the drawn width. */
function ledText(g, str, x, y, pitch, color, glow = 0) {
  const lay = layoutText(str, { gap: 1, colonGap: 1 });
  g.fillStyle = color;
  if (glow) {
    g.shadowColor = color;
    g.shadowBlur = glow;
  }
  for (const [cx, cy] of lay.cells) {
    roundRectPath(g, x + cx * pitch, y + cy * pitch, pitch * 0.84, pitch * 0.84, pitch * 0.2);
    g.fill();
  }
  g.shadowBlur = 0;
  return lay.width * pitch;
}

// ====================================================================== bay
export class InstrumentBay {
  constructor(root, app) {
    this.app = app;
    this.items = [];
    this.acc = 0;
    this.byEl = new Map();
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const it = this.byEl.get(e.target);
          if (it) it.visible = e.isIntersecting;
        }
      },
      { rootMargin: '160px' },
    );
    for (const def of REGISTRY) this.mount(root, def);
  }

  mount(root, def) {
    const card = document.createElement('article');
    card.className = `card inst ${def.size ?? ''}`;
    card.style.setProperty('--accent', def.accent);
    card.id = `inst-${def.id}`;
    const head = document.createElement('header');
    const h3 = document.createElement('h3');
    h3.textContent = def.title;
    const meta = document.createElement('span');
    head.append(h3, meta);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', def.label ?? def.title);
    const foot = document.createElement('footer');
    card.append(head, canvas, foot);
    root.append(card);

    const item = { def, card, canvas, g: canvas.getContext('2d'), meta, foot, visible: false, state: null, texts: ['', ''] };
    item.state = def.init(this.app, item);
    this.items.push(item);
    this.byEl.set(card, item);
    this.io.observe(card);

    if (def.pointer) {
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      canvas.addEventListener('pointermove', (e) => def.pointer('move', ...pos(e), item.state, this.app, item));
      canvas.addEventListener('pointerleave', () => def.pointer('leave', 0, 0, item.state, this.app, item));
      canvas.addEventListener('click', (e) => def.pointer('click', ...pos(e), item.state, this.app, item));
    }
  }

  frame(dt) {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    const step = this.acc;
    this.acc = 0;
    for (const it of this.items) {
      if (!it.visible) continue;
      const { w, h, dpr } = fitCanvas(it.canvas);
      it.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      it.g.clearRect(0, 0, w, h);
      it.def.draw(it.g, w, h, it.state, this.app, step, it);
      const m = it.def.meta?.(it.state, this.app) ?? '';
      if (m !== it.texts[0]) it.meta.textContent = it.texts[0] = m;
      const f = it.def.foot?.(it.state, this.app) ?? '';
      if (f !== it.texts[1]) it.foot.textContent = it.texts[1] = f;
    }
  }
}

// ====================================================================== orrery
defineInstrument({
  id: 'orrery',
  title: 'Repo Orrery',
  accent: '#ffc857',
  size: 'wide tall',
  label: 'Orrery: the most recently pushed repositories orbit closest to the sun; older ones sit in an outer belt.',
  init(app) {
    const repos = app.data.repos
      .filter((r) => r.name !== CONFIG.login && !r.fork && !r.archived)
      .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1));
    const planets = repos.slice(0, 7).map((r, i) => {
      const rx = 30 + i * 13.2;
      return {
        r, rx, ry: rx * 0.58, period: 14 * (rx / 30) ** 1.45, phase: (hash32(r.name) % 1000) / 1000,
        size: 2.8 + Math.min(3.6, Math.log10(1 + r.size) * 0.5 + r.stars * 0.9), color: PLANET[i % PLANET.length], sx: 0, sy: 0,
      };
    });
    const belt = repos.slice(7).map((r, k) => {
      const h = hash32(r.name);
      return { r, rx: 138 + (k % 3) * 5, a0: ((h % 1000) / 1000) * TAU, speed: 0.012 + (h % 7) * 0.003, color: DIM, size: 1.7, sx: 0, sy: 0 };
    });
    return { planets, belt, mouse: null, hover: null, tilt: (-14 * Math.PI) / 180, spin: 0 };
  },
  meta: (s) => `${s.planets.length} ORBITS · ${s.belt.length} IN THE BELT`,
  foot: (s) => (s.hover ? `${s.hover.r.name.toUpperCase()} · CLICK TO OPEN ON GITHUB` : 'INNER ORBIT = FRESHEST PUSH · HOVER A PLANET'),
  pointer(type, x, y, s) {
    if (type === 'leave') s.mouse = null;
    else if (type === 'move') s.mouse = [x, y];
    else if (type === 'click' && s.hover) window.open(s.hover.r.url, '_blank', 'noopener');
  },
  draw(g, w, h, s, app, dt) {
    const t = app.clock.ms() / 1000;
    s.spin += dt;
    const ct = Math.cos(s.tilt);
    const st = Math.sin(s.tilt);
    const k = Math.min((w / 2 - 14) / 150, (h / 2 - 22) / 95);
    const cx = w / 2;
    const cy = h / 2 + 4;
    const pr = (x, y) => [cx + (x * ct - y * st) * k, cy + (x * st + y * ct) * k];
    const ks = clamp(k * 0.8, 0.9, 1.5);

    // rings
    g.lineWidth = 1;
    for (const p of s.planets) {
      g.strokeStyle = p.color + '30';
      g.beginPath();
      g.ellipse(cx, cy, p.rx * k, p.ry * k, s.tilt, 0, TAU);
      g.stroke();
    }

    // belt
    for (const b of s.belt) {
      const a = b.a0 + t * b.speed;
      [b.sx, b.sy] = pr(Math.cos(a) * b.rx, Math.sin(a) * b.rx * 0.58);
    }
    g.fillStyle = '#8da0c4';
    g.globalAlpha = 0.55;
    for (const b of s.belt) {
      g.beginPath();
      g.arc(b.sx, b.sy, b.size * ks, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;

    // sun
    const pulse = 0.85 + 0.15 * Math.sin(s.spin * 1.7);
    const sun = g.createRadialGradient(cx, cy, 0, cx, cy, 30 * ks);
    sun.addColorStop(0, `rgba(255,246,214,${pulse})`);
    sun.addColorStop(0.3, `rgba(255,200,87,${0.75 * pulse})`);
    sun.addColorStop(1, 'rgba(255,200,87,0)');
    g.fillStyle = sun;
    g.beginPath();
    g.arc(cx, cy, 30 * ks, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,200,87,.8)';
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + s.spin * 0.16;
      const r0 = 11 * ks;
      const r1 = (i % 2 ? 15 : 19) * ks;
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    g.stroke();
    g.fillStyle = '#fff6d6';
    g.beginPath();
    g.arc(cx, cy, 6 * ks, 0, TAU);
    g.fill();

    // planets
    for (const p of s.planets) {
      const a = TAU * (t / p.period + p.phase);
      [p.sx, p.sy] = pr(Math.cos(a) * p.rx, Math.sin(a) * p.ry);
    }
    let best = null;
    let bd = 15;
    if (s.mouse) {
      for (const o of [...s.planets, ...s.belt]) {
        const d = Math.hypot(o.sx - s.mouse[0], o.sy - s.mouse[1]);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
    }
    s.hover = best;
    g.canvas.style.cursor = best ? 'pointer' : 'default';

    for (const p of s.planets) {
      const size = p.size * ks * (p === s.hover ? 1.25 : 1);
      g.fillStyle = p.color + '2a';
      g.beginPath();
      g.arc(p.sx, p.sy, size + 4 * ks, 0, TAU);
      g.fill();
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.sx, p.sy, size, 0, TAU);
      g.fill();
      if (p.r.langColor) {
        g.strokeStyle = p.r.langColor;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(p.sx, p.sy, size + 1.3, 0, TAU);
        g.stroke();
      }
      // label on whichever side has room
      const name = p.r.name.length > 14 ? `${p.r.name.slice(0, 13)}…` : p.r.name;
      const need = name.length * 5.4 + 8;
      const right = p.sx + size + 5 + need < w - 8;
      const left = p.sx - size - 5 - need > 8;
      const alpha = right || left ? 1 : 0.0;
      if (alpha) {
        g.globalAlpha = 0.95;
        g.lineJoin = 'round';
        g.lineWidth = 3;
        g.strokeStyle = '#070b14';
        g.font = `600 9.5px ${MONO}`;
        g.textAlign = right ? 'left' : 'right';
        g.textBaseline = 'middle';
        const lx = right ? p.sx + size + 5 : p.sx - size - 5;
        g.strokeText(name, lx, p.sy + 0.5);
        g.fillStyle = p === s.hover ? '#fff' : INK;
        g.fillText(name, lx, p.sy + 0.5);
        g.globalAlpha = 1;
      }
    }
    if (s.hover && !s.planets.includes(s.hover)) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(s.hover.sx, s.hover.sy, 5, 0, TAU);
      g.stroke();
    }

    // callout for the hovered body
    if (s.hover) {
      const r = s.hover.r;
      const lines = [r.name, ...wrap(r.description || 'No description yet.', 44, 2), `${ago(r.pushedAt)} · ${r.lang ?? 'n/a'}${r.stars ? ` · ★${r.stars}` : ''}`];
      const bw = Math.min(w - 16, 300);
      const bh = 14 * lines.length + 14;
      let bx = s.hover.sx + 14;
      let by = s.hover.sy - bh - 10;
      if (bx + bw > w - 8) bx = s.hover.sx - bw - 14;
      bx = clamp(bx, 8, w - bw - 8);
      if (by < 8) by = s.hover.sy + 14;
      by = clamp(by, 8, h - bh - 8);
      g.fillStyle = 'rgba(5,8,16,.94)';
      g.strokeStyle = '#2b4070';
      g.lineWidth = 1;
      roundRectPath(g, bx, by, bw, bh, 8);
      g.fill();
      g.stroke();
      lines.forEach((ln, i) => txt(g, ln, bx + 10, by + 18 + i * 14, { size: i === 0 ? 11 : 10, color: i === 0 ? '#fff' : i === lines.length - 1 ? '#46e0ff' : DIM, weight: i === 0 ? 700 : 600 }));
    }
  },
});

function wrap(text, max, maxLines) {
  const words = text.split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      out.push(line);
      line = w;
      if (out.length === maxLines) break;
    } else line = (line + ' ' + w).trim();
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length === maxLines && words.join(' ').length > out.join(' ').length) out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '…');
  return out;
}

// ====================================================================== sky
const SKY = [
  [-18, '#030611', '#071026'], [-6, '#0a1538', '#5b3566'], [0, '#1a3a78', '#d9804a'], [6, '#2a6bb8', '#f0c283'], [30, '#2f78c8', '#9fd0f5'],
].map(([e, top, bot]) => [e, hex(top), hex(bot)]);

function skyColors(el) {
  if (el <= SKY[0][0]) return [SKY[0][1], SKY[0][2]];
  for (let i = 1; i < SKY.length; i++) {
    if (el <= SKY[i][0]) {
      const u = (el - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]);
      return [0, 1].map((k) => SKY[i - 1][k + 1].map((v, c) => lerp(v, SKY[i][k + 1][c], u)));
    }
  }
  return [SKY.at(-1)[1], SKY.at(-1)[2]];
}
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

function drawMoon(g, cx, cy, r, illum, waxing) {
  g.fillStyle = '#16213a';
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();
  const f = 1 - 2 * illum;
  const termCCW = (waxing ? (f > 0 ? 0 : 1) : f > 0 ? 1 : 0) === 0;
  g.save();
  g.fillStyle = '#eef2ff';
  g.shadowColor = 'rgba(220,230,255,.8)';
  g.shadowBlur = 14;
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
  g.ellipse(cx, cy, Math.max(0.01, Math.abs(f) * r), r, 0, Math.PI / 2, -Math.PI / 2, termCCW);
  g.closePath();
  g.fill();
  g.restore();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.clip();
  g.fillStyle = 'rgba(120,135,185,.28)';
  for (const [dx, dy, rr] of [[-0.3, -0.25, 0.26], [0.3, 0.3, 0.2], [0, 0.45, 0.12], [0.32, -0.3, 0.13], [-0.5, 0.18, 0.1]]) {
    g.beginPath();
    g.arc(cx + dx * r, cy + dy * r, rr * r, 0, TAU);
    g.fill();
  }
  g.restore();
}

defineInstrument({
  id: 'sky',
  title: 'Sky Dial',
  accent: '#a287ff',
  size: 'narrow tall',
  label: 'The sun and moon over the selected city, with today’s sun path.',
  init() {
    const rng = mulberry32(77);
    return { stars: Array.from({ length: 70 }, () => ({ x: rng(), y: rng() * 0.7, r: 0.5 + rng() * 1.1, p: rng() * 6.3 })), pathKey: '', path: [], t: 0 };
  },
  meta: (s, app) => `${app.placeLabel(app.focus)}${app.placeOf(app.focus).exact ? '' : ' ≈'}`,
  foot(s) {
    return s.line ?? '';
  },
  draw(g, w, h, s, app, dt) {
    s.t += dt;
    const z = app.focus;
    const place = app.placeOf(z);
    const now = app.clock.now();
    const sun = sunPosition(now, place.lat, place.lon);
    const phase = moonPhase(now);
    const moon = moonPosition(now, place.lat, place.lon);
    const horizon = h * 0.78;
    const south = place.lat >= 0;
    const span = 214;
    const xOf = (az) => {
      const d = (((south ? az - 180 : az) + 540) % 360) - 180;
      return w / 2 + (d / span) * w;
    };
    const yOf = (el) => horizon - (el / 90) * (horizon - 26);

    // sky
    const [top, bot] = skyColors(sun.elevation);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, css(top));
    sky.addColorStop(1, css(bot));
    g.fillStyle = sky;
    g.fillRect(0, 0, w, horizon);
    const night = clamp((-4 - sun.elevation) / 10, 0, 1);
    if (night > 0) {
      g.fillStyle = '#fff';
      for (const st of s.stars) {
        g.globalAlpha = night * (0.35 + 0.35 * Math.sin(s.t * 1.4 + st.p));
        g.beginPath();
        g.arc(st.x * w, st.y * horizon, st.r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // today's sun path
    const p = zoneParts(now, z.tz);
    const key = `${z.id}|${p.year}-${p.month}-${p.day}|${place.lat.toFixed(1)}`;
    if (key !== s.pathKey) {
      s.pathKey = key;
      const mid = Date.UTC(p.year, p.month - 1, p.day) - zoneOffsetMinutes(now, z.tz) * 60000;
      s.path = [];
      for (let m = 0; m <= 1440; m += 10) {
        const e = sunPosition(new Date(mid + m * 60000), place.lat, place.lon);
        s.path.push([e.azimuth, e.elevation, m]);
      }
      const st = sunTimes(new Date(mid + 12 * 3600e3), place.lat, place.lon);
      const f = (d) => (d ? `${pad2(zoneParts(d, z.tz).hour)}:${pad2(zoneParts(d, z.tz).minute)}` : '--:--');
      s.rise = f(st.sunrise);
      s.set = f(st.sunset);
    }
    g.strokeStyle = 'rgba(255,200,87,.55)';
    g.lineWidth = 1.5;
    g.setLineDash([2, 5]);
    g.beginPath();
    let pen = false;
    let lastX = 0;
    for (const [az, el] of s.path) {
      if (el < -3) {
        pen = false;
        continue;
      }
      const x = xOf(az);
      const y = yOf(el);
      if (!pen || Math.abs(x - lastX) > w * 0.6) g.moveTo(x, y);
      else g.lineTo(x, y);
      pen = true;
      lastX = x;
    }
    g.stroke();
    g.setLineDash([]);

    // sun
    const sx = xOf(sun.azimuth);
    const sy = yOf(sun.elevation);
    if (sun.elevation > -6) {
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 46);
      glow.addColorStop(0, 'rgba(255,230,160,.85)');
      glow.addColorStop(0.25, 'rgba(255,200,87,.35)');
      glow.addColorStop(1, 'rgba(255,200,87,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(sx, sy, 46, 0, TAU);
      g.fill();
      g.fillStyle = '#fff6d6';
      g.beginPath();
      g.arc(sx, sy, 9, 0, TAU);
      g.fill();
    }

    // moon
    if (moon.elevation > -5) drawMoon(g, xOf(moon.azimuth), yOf(Math.max(moon.elevation, -2)), 10, phase.illum, south ? phase.phase < 0.5 : phase.phase >= 0.5);

    // ground
    const ground = g.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, '#0a0f1c');
    ground.addColorStop(1, '#050810');
    g.fillStyle = ground;
    g.fillRect(0, horizon, w, h - horizon);
    g.strokeStyle = css(bot);
    g.globalAlpha = 0.7;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, horizon);
    g.lineTo(w, horizon);
    g.stroke();
    g.globalAlpha = 1;

    // compass
    const compass = south ? [['E', 90], ['S', 180], ['W', 270]] : [['W', 270], ['N', 0], ['E', 90]];
    for (const [c, az] of compass) txt(g, c, xOf(az), horizon + 16, { size: 10, color: FAINT, align: 'center', weight: 700 });

    // readouts
    txt(g, `${sun.elevation >= 0 ? 'SUN' : 'SUN (BELOW)'} ${sun.elevation >= 0 ? '+' : ''}${sun.elevation.toFixed(1)}°`, 14, 22, { size: 10.5, color: '#ffe3a3', weight: 700, spacing: 0.6 });
    txt(g, `AZ ${Math.round(sun.azimuth)}°`, 14, 36, { size: 9.5, color: 'rgba(255,255,255,.55)' });
    txt(g, `MOON ${Math.round(phase.illum * 100)}%`, w - 14, 22, { size: 10.5, color: '#dfe6ff', align: 'right', weight: 700, spacing: 0.6 });
    txt(g, phase.name.toUpperCase(), w - 14, 36, { size: 9.5, color: 'rgba(255,255,255,.55)', align: 'right' });
    txt(g, `↑ ${s.rise}   ↓ ${s.set}`, w / 2, h - 12, { size: 10, color: DIM, align: 'center', spacing: 0.4 });
    s.line = place.exact ? `${app.placeLabel(z)} · SKY FROM ITS CITY COORDINATES` : 'APPROXIMATE · INFERRED FROM YOUR TIME ZONE OFFSET';
  },
});

// ====================================================================== world wall
defineInstrument({
  id: 'wall',
  title: 'Zone Wall',
  accent: '#46e0ff',
  size: 'wide',
  label: 'Live clocks for the visitor’s time zone and eight others. Select one to show it in the Chrono-Grid.',
  init() {
    return { tiles: [], hover: -1 };
  },
  meta: (s, app) => `${app.zones.list.length} ZONES`,
  foot: () => 'CLICK A ZONE TO SHOW IT IN THE CHRONO-GRID',
  pointer(type, x, y, s, app) {
    if (type === 'leave') {
      s.hover = -1;
      return;
    }
    const idx = s.tiles.findIndex((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
    s.hover = idx;
    if (type === 'click' && idx >= 0) app.selectZone(app.zones.list[idx]);
  },
  draw(g, w, h, s, app, dt, item) {
    const zs = app.zones.list;
    const cols = w < 520 ? 2 : 3;
    const rows = Math.ceil(zs.length / cols);
    const gap = 8;
    const wantH = rows * 92 + (rows - 1) * gap + 16;
    if (Math.abs(item.canvas.clientHeight - wantH) > 1) item.canvas.style.height = `${wantH}px`;
    const tw = (w - 16 - gap * (cols - 1)) / cols;
    const th = (h - 16 - gap * (rows - 1)) / rows;
    const now = app.clock.now();
    const me = zoneOffsetMinutes(now, app.zones.you.tz);
    s.tiles = [];
    zs.forEach((z, i) => {
      const x = 8 + (i % cols) * (tw + gap);
      const y = 8 + Math.floor(i / cols) * (th + gap);
      s.tiles.push({ x, y, w: tw, h: th });
      const p = zoneParts(now, z.tz);
      const sel = z === app.focus;
      const hov = s.hover === i;
      const day = p.hour >= 6 && p.hour < 18;
      g.fillStyle = sel ? 'rgba(70,224,255,.12)' : hov ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.025)';
      g.strokeStyle = sel ? '#46e0ff' : hov ? '#2b4070' : '#1c2a47';
      g.lineWidth = sel ? 1.5 : 1;
      roundRectPath(g, x, y, tw, th, 10);
      g.fill();
      g.stroke();
      txt(g, z.id === 'you' ? `YOU · ${z.place}` : z.label, x + 12, y + 17, { size: 9.5, color: sel ? '#46e0ff' : z.id === 'you' ? '#ffc857' : DIM, weight: 700, spacing: 1 });
      g.fillStyle = day ? '#ffc857' : '#a287ff';
      g.beginPath();
      g.arc(x + tw - 14, y + 14, 4, 0, TAU);
      g.fill();
      const pitch = Math.min(6, (tw - 24 - 34) / 25);
      const dw = ledText(g, `${pad2(p.hour)}:${pad2(p.minute)}`, x + 12, y + 27, pitch, sel ? '#bdfbf2' : '#72dff0', sel ? 8 : 4);
      txt(g, `:${pad2(p.second)}`, x + 12 + dw + 6, y + 27 + pitch * 7, { size: 11, color: sel ? '#bdfbf2' : DIM, weight: 700 });
      const off = zoneOffsetMinutes(now, z.tz) - me;
      const rel = z.id === 'you' ? 'YOUR CLOCK' : off === 0 ? 'SAME AS YOU' : `${off > 0 ? '+' : '−'}${Math.floor(Math.abs(off) / 60)}H${Math.abs(off) % 60 ? pad2(Math.abs(off) % 60) : ''} FROM YOU`;
      txt(g, `${p.tzName} · ${rel}`, x + 12, y + th - 9, { size: 8.5, color: FAINT, spacing: 0.5 });
    });
    g.canvas.style.cursor = s.hover >= 0 ? 'pointer' : 'default';
  },
});

// ====================================================================== epoch rings
defineInstrument({
  id: 'rings',
  title: 'Epoch Rings',
  accent: '#4ff0b4',
  size: 'narrow',
  label: 'How far through the day, week, month and year it is.',
  init() {
    return { disp: [0, 0, 0, 0] };
  },
  meta: (s, app) => app.focus.label === 'YOU' ? app.focus.place : app.focus.label,
  foot: () => `ELAPSED, NOT REMAINING · ACCOUNT SINCE ${CONFIG.accountCreated.slice(0, 10)}`,
  draw(g, w, h, s, app, dt) {
    const z = app.focus;
    const now = app.clock.now();
    const pr = progress(now, z.tz);
    const p = zoneParts(now, z.tz);
    const vals = [pr.day, pr.week, pr.month, pr.year];
    const names = ['DAY', 'WEEK', 'MONTH', 'YEAR'];
    const cols = ['#46e0ff', '#4ff0b4', '#ffc857', '#ff5f9e'];
    const R0 = Math.max(40, Math.min(h * 0.5 - 14, w * 0.25));
    const cx = R0 + 16;
    const cy = h * 0.5 + 2;
    const step = Math.min(15, R0 * 0.165);
    vals.forEach((v, i) => {
      s.disp[i] += (v - s.disp[i]) * Math.min(1, dt * 5);
      const r = R0 - i * step;
      g.lineWidth = step * 0.62;
      g.lineCap = 'round';
      g.strokeStyle = '#16223a';
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
      g.strokeStyle = cols[i];
      g.shadowColor = cols[i];
      g.shadowBlur = 8;
      g.beginPath();
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.002, s.disp[i]));
      g.stroke();
      g.shadowBlur = 0;
    });
    const sec = p.hour * 3600 + p.minute * 60 + p.second;
    const big = clamp(R0 * 0.16, 11, 15);
    txt(g, `${pad2(p.hour)}:${pad2(p.minute)}`, cx, cy + 4, { size: big, color: INK, align: 'center', weight: 700 });
    txt(g, `:${pad2(p.second)}`, cx, cy + 4 + big, { size: 10, color: DIM, align: 'center' });

    const daysInYear = pr.daysInYear;
    const born = new Date(CONFIG.accountCreated);
    const ageDays = (now - born) / 86400000;
    const y = Math.floor(ageDays / 365.2425);
    const mo = Math.floor((ageDays - y * 365.2425) / 30.436875);
    const toMidnight = 86400 - sec;
    const lx = cx + R0 + 20;
    const rowsOut = [
      [names[0], `${Math.floor(vals[0] * 100)}%`, `${sec.toLocaleString('en-US')} / 86,400 s`, cols[0]],
      [names[1], `${Math.floor(vals[1] * 100)}%`, `DAY ${p.weekday + 1} OF 7`, cols[1]],
      [names[2], `${Math.floor(vals[2] * 100)}%`, `DAY ${p.day} OF ${new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()}`, cols[2]],
      [names[3], `${Math.floor(vals[3] * 100)}%`, `DAY ${pr.dayOfYear} OF ${daysInYear} · ${daysInYear - pr.dayOfYear} LEFT`, cols[3]],
    ];
    rowsOut.forEach(([n, pct, detail, c], i) => {
      const yy = 38 + i * 38;
      g.fillStyle = c;
      g.fillRect(lx, yy - 9, 3, 24);
      txt(g, n, lx + 10, yy, { size: 9, color: DIM, weight: 700, spacing: 1.2 });
      txt(g, pct, w - 14, yy + 2, { size: 15, color: INK, align: 'right', weight: 700 });
      txt(g, detail, lx + 10, yy + 14, { size: 9, color: FAINT });
    });
    txt(g, `MIDNIGHT IN ${pad2(Math.floor(toMidnight / 3600))}:${pad2(Math.floor((toMidnight % 3600) / 60))}:${pad2(toMidnight % 60)}`, lx, h - 34, { size: 9.5, color: '#4ff0b4', weight: 700, spacing: 0.6 });
    txt(g, `ACCOUNT AGE ${y}Y ${mo}M`, lx, h - 18, { size: 9, color: FAINT });
  },
});

// ====================================================================== epoch odometer
defineInstrument({
  id: 'odometer',
  title: 'Unix Odometer',
  accent: '#ffc857',
  size: 'half short',
  label: 'Seconds since 1 January 1970 UTC as a mechanical odometer, with the countdown to the year-2038 rollover.',
  init: () => ({}),
  meta: (s, app) => (app.clock.live ? 'LIVE' : 'TIME MACHINE'),
  foot: () => 'SECONDS SINCE 1970-01-01T00:00:00Z',
  draw(g, w, h, s, app) {
    const ms = app.clock.ms();
    const secs = ms / 1000;
    const n = 10;
    const ww = Math.min(40, (w - 32) / n);
    const wh = Math.min(62, h * 0.4);
    const x0 = (w - ww * n) / 2;
    const y0 = 20;
    g.font = `700 ${wh * 0.74}px ${MONO}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Mechanical carry: a wheel only moves while every wheel below it is turning 9 -> 0.
    const dig = [];
    const roll = [];
    let prev = secs % 10;
    dig[0] = Math.floor(prev);
    roll[0] = prev - dig[0];
    for (let k = 1; k < n; k++) {
      dig[k] = Math.floor(secs / 10 ** k) % 10;
      roll[k] = clamp(prev - 9, 0, 1);
      prev = dig[k] + roll[k];
    }
    for (let k = n - 1; k >= 0; k--) {
      const idx = n - 1 - k; // left to right
      const d = dig[k];
      const rl = roll[k];
      const x = x0 + idx * ww;
      g.save();
      roundRectPath(g, x + 2, y0, ww - 4, wh, 7);
      g.fillStyle = '#0b1424';
      g.fill();
      g.clip();
      const cy = y0 + wh / 2;
      g.fillStyle = k < 2 ? '#ffc857' : '#dbe7ff';
      g.fillText(String(d), x + ww / 2, cy - rl * wh);
      g.fillText(String((d + 1) % 10), x + ww / 2, cy + wh - rl * wh);
      const shade = g.createLinearGradient(0, y0, 0, y0 + wh);
      shade.addColorStop(0, 'rgba(0,0,0,.65)');
      shade.addColorStop(0.28, 'rgba(0,0,0,0)');
      shade.addColorStop(0.72, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,.65)');
      g.fillStyle = shade;
      g.fillRect(x, y0, ww, wh);
      g.restore();
      g.strokeStyle = '#1c2a47';
      g.lineWidth = 1;
      roundRectPath(g, x + 2, y0, ww - 4, wh, 7);
      g.stroke();
    }
    g.textBaseline = 'alphabetic';
    const target = Date.UTC(2038, 0, 19, 3, 14, 7);
    let left = Math.max(0, (target - ms) / 1000);
    const yrs = Math.floor(left / (365.2425 * 86400));
    left -= yrs * 365.2425 * 86400;
    const mos = Math.floor(left / (30.436875 * 86400));
    left -= mos * 30.436875 * 86400;
    const days = Math.floor(left / 86400);
    left -= days * 86400;
    const hms = `${pad2(Math.floor(left / 3600))}:${pad2(Math.floor((left % 3600) / 60))}:${pad2(Math.floor(left % 60))}`;
    const yy = y0 + wh + 26;
    txt(g, `0x${Math.floor(secs).toString(16).toUpperCase()}`, x0 + 4, yy, { size: 11, color: '#46e0ff', weight: 700 });
    txt(g, `JD ${julianDay(new Date(ms)).toFixed(3)}`, w - x0 - 4, yy, { size: 11, color: DIM, align: 'right' });
    txt(g, `INT32 ROLLOVER IN ${yrs}Y ${pad2(mos)}M ${pad2(days)}D ${hms}`, w / 2, yy + 22, { size: 10, color: '#ff5f9e', align: 'center', weight: 700, spacing: 0.6 });
  },
});

// ====================================================================== binary clock
defineInstrument({
  id: 'binary',
  title: 'Binary Clock',
  accent: '#a287ff',
  size: 'half short',
  label: 'The current time in binary-coded decimal.',
  init: () => ({}),
  meta: (s, app) => (app.focus.id === 'you' ? app.focus.place : app.focus.label),
  foot: (s, app) => {
    const p = zoneParts(app.clock.now(), app.focus.tz);
    return `BCD · ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} ${p.tzName}`;
  },
  draw(g, w, h, s, app) {
    const p = zoneParts(app.clock.now(), app.focus.tz);
    const digits = [Math.floor(p.hour / 10), p.hour % 10, Math.floor(p.minute / 10), p.minute % 10, Math.floor(p.second / 10), p.second % 10];
    const bits = [2, 4, 3, 4, 3, 4];
    const colors = ['#46e0ff', '#46e0ff', '#4ff0b4', '#4ff0b4', '#ffc857', '#ffc857'];
    const gx = (w - 60) / 6;
    const gy = (h - 20) / 4.4;
    const r = Math.min(gx, gy) * 0.34;
    const x0 = 44;
    const y0 = 18;
    [8, 4, 2, 1].forEach((v, row) => txt(g, String(v), 28, y0 + row * gy + gy / 2 + 3, { size: 10, color: FAINT, align: 'right', weight: 700 }));
    digits.forEach((d, col) => {
      const x = x0 + col * gx + gx / 2 + (col >= 2 ? 8 : 0) + (col >= 4 ? 8 : 0);
      for (let row = 0; row < 4; row++) {
        const bit = 8 >> row;
        const possible = 4 - row <= bits[col];
        const on = (d & bit) !== 0;
        const y = y0 + row * gy + gy / 2;
        if (!possible) {
          g.fillStyle = 'rgba(255,255,255,.05)';
          g.beginPath();
          g.arc(x, y, 2, 0, TAU);
          g.fill();
          continue;
        }
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        if (on) {
          g.fillStyle = colors[col];
          g.shadowColor = colors[col];
          g.shadowBlur = 14;
          g.fill();
          g.shadowBlur = 0;
          g.fillStyle = 'rgba(255,255,255,.55)';
          g.beginPath();
          g.arc(x - r * 0.28, y - r * 0.3, r * 0.3, 0, TAU);
          g.fill();
        } else {
          g.fillStyle = '#101a2e';
          g.fill();
          g.strokeStyle = '#1c2a47';
          g.stroke();
        }
      }
      txt(g, String(d), x, y0 + 4 * gy + 4, { size: 11, color: DIM, align: 'center', weight: 700 });
    });
  },
});
