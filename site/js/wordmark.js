// The hero wordmark, drawn from the same 5x7 pixel cells as the clock. It shimmers on its
// own, lights up under the pointer, and ripples when you click or tap it.

import { layoutText } from '../lib/font5x7.mjs';
import { fitCanvas, hex, roundRectPath, glowSprite, clamp } from './util.js';

const CYAN = hex('#46e0ff');
const ICE = hex('#e9f6ff');
const GOLD = hex('#ffc857');
const ORANGE = hex('#ff9f45');
const WHITE = [255, 255, 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Wordmark {
  constructor({ canvas, app, words }) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.app = app;
    this.words = words;
    this.t = app.reduced ? 5 : 0;
    this.ptr = null;
    this.ripples = [];
    this.cells = [];
    this.sprites = [glowSprite(CYAN), glowSprite(GOLD)];
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.ptr = [e.clientX - r.left, e.clientY - r.top];
    });
    canvas.addEventListener('pointerleave', () => (this.ptr = null));
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      this.ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, t0: this.t });
    });
    this.resize();
  }

  resize() {
    const W = this.canvas.clientWidth || 800;
    const stacked = W < 720;
    this.cells = [];
    const place = (lay, wordIdx, ox, oy, pitch) => {
      for (const [x, y] of lay.cells) this.cells.push({ x: ox + (x + 0.5) * pitch, y: oy + (y + 0.5) * pitch, word: wordIdx, u: x / Math.max(1, lay.width - 1), e: 0, d: 0 });
    };
    let H;
    if (stacked) {
      const a = layoutText(this.words[0], { gap: 1 });
      const b = layoutText(this.words[1], { gap: 1 });
      this.pitch = Math.min(15, (W - 4) / a.width);
      place(a, 0, 2, 4, this.pitch);
      place(b, 1, 2, 4 + 9 * this.pitch, this.pitch);
      H = 4 + 16 * this.pitch + 6;
    } else {
      const lay = layoutText(`${this.words[0]} ${this.words[1]}`, { gap: 1, spaceW: 3 });
      const split = lay.glyphs[this.words[0].length].x;
      this.pitch = Math.min(13, (W - 4) / lay.width);
      for (const [x, y] of lay.cells) {
        const second = x >= split;
        const u = second ? (x - split) / Math.max(1, lay.width - split - 1) : x / Math.max(1, split - 4);
        this.cells.push({ x: 2 + (x + 0.5) * this.pitch, y: 4 + (y + 0.5) * this.pitch, word: second ? 1 : 0, u, e: 0, d: 0 });
      }
      H = 4 + 7 * this.pitch + 6;
    }
    this.canvas.style.height = `${Math.ceil(H)}px`;
    const { dpr } = fitCanvas(this.canvas);
    this.W = W;
    this.H = Math.ceil(H);
    this.dpr = dpr;
    // boot-up sweep: cells appear left to right
    this.cells.forEach((c) => (c.d = this.app.reduced ? -9 : (c.x / W) * 0.9 + ((c.x * 7 + c.y * 13) % 25) / 100));
  }

  frame(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const g = this.g;
    const t = this.t;
    const { W, H, dpr, pitch } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const size = pitch * 0.8;
    const still = this.app.reduced;
    const band = still ? -999 : ((t * 0.32) % 2.6) * (W + 320) - 160;
    this.ripples = this.ripples.filter((r) => t - r.t0 < 1.4);

    for (const c of this.cells) {
      const boot = clamp((t - c.d) / 0.5, 0, 1);
      if (boot <= 0) continue;
      // energy from the pointer and from ripples
      let target = 0;
      if (this.ptr) target = Math.exp(-((c.x - this.ptr[0]) ** 2 + (c.y - this.ptr[1]) ** 2) / (2 * (pitch * 3.4) ** 2));
      for (const r of this.ripples) {
        const age = t - r.t0;
        const ring = age * 520;
        const d = Math.hypot(c.x - r.x, c.y - r.y);
        target = Math.max(target, Math.exp(-((d - ring) ** 2) / (2 * 26 ** 2)) * (1 - age / 1.4));
      }
      c.e = Math.max(target, c.e - dt * 2.6);
      const sh = Math.exp(-(((c.x + c.y * 1.3) - band) ** 2) / (2 * 55 ** 2));
      const base = c.word === 0 ? mix(CYAN, ICE, c.u * 0.85) : mix(GOLD, ORANGE, c.u);
      const col = mix(base, WHITE, clamp(sh * 0.85 + c.e * 0.7, 0, 1));
      const s = size * (1 + c.e * 0.2) * (0.6 + 0.4 * boot);
      g.globalAlpha = boot;
      g.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      roundRectPath(g, c.x - s / 2, c.y - s / 2, s, s, s * 0.22);
      g.fill();
    }

    // glow pass
    g.globalCompositeOperation = 'lighter';
    for (const c of this.cells) {
      const boot = clamp((t - c.d) / 0.5, 0, 1);
      if (boot <= 0) continue;
      const sh = Math.exp(-(((c.x + c.y * 1.3) - band) ** 2) / (2 * 55 ** 2));
      const a = (0.1 + sh * 0.35 + c.e * 0.55) * boot;
      if (a < 0.03) continue;
      g.globalAlpha = Math.min(1, a);
      const r = pitch * (1.5 + c.e * 1.2);
      g.drawImage(this.sprites[c.word], c.x - r, c.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
