// A quiet fixed starfield behind the page, with the odd shooting star.

import { mulberry32 } from '../lib/rng.mjs';

export class Starfield {
  constructor(canvas, reduced) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.reduced = reduced;
    this.t = 0;
    this.acc = 0;
    this.shoot = null;
    this.nextShoot = 6;
    const rng = mulberry32(2026);
    this.stars = Array.from({ length: 150 }, () => ({
      x: rng(),
      y: rng(),
      r: [0.5, 0.7, 0.9, 1.2, 1.5][(rng() * 5) | 0],
      o: 0.25 + rng() * 0.6,
      s: 0.6 + rng() * 2.4,
      p: rng() * 6.28,
      c: rng() < 0.12 ? '#ffc857' : rng() < 0.3 ? '#46e0ff' : '#ffffff',
    }));
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    this.draw();
  }

  frame(dt) {
    if (this.reduced) return;
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 24) return;
    const step = this.acc;
    this.acc = 0;
    if (!this.shoot && this.t > this.nextShoot) {
      const y = Math.random() * this.h * 0.5;
      this.shoot = { x: Math.random() * this.w * 0.7 + this.w * 0.15, y, vx: 520 + Math.random() * 260, vy: 200 + Math.random() * 120, life: 0 };
      this.nextShoot = this.t + 14 + Math.random() * 16;
    }
    if (this.shoot) {
      const s = this.shoot;
      s.life += step;
      s.x += s.vx * step;
      s.y += s.vy * step;
      if (s.life > 0.9) this.shoot = null;
    }
    this.draw();
  }

  draw() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const drift = (typeof scrollY === 'number' ? scrollY : 0) * 0.04;
    for (const s of this.stars) {
      const tw = this.reduced ? 1 : 0.55 + 0.45 * Math.sin(this.t * s.s + s.p);
      g.globalAlpha = s.o * tw;
      g.fillStyle = s.c;
      g.beginPath();
      g.arc(s.x * this.w, (s.y * this.h - drift * (0.4 + s.r)) % this.h, s.r, 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;
    if (this.shoot) {
      const s = this.shoot;
      const len = 90;
      const n = Math.hypot(s.vx, s.vy);
      const grd = g.createLinearGradient(s.x, s.y, s.x - (s.vx / n) * len, s.y - (s.vy / n) * len);
      grd.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - s.life / 0.9)})`);
      grd.addColorStop(1, 'rgba(70,224,255,0)');
      g.strokeStyle = grd;
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - (s.vx / n) * len, s.y - (s.vy / n) * len);
      g.stroke();
    }
  }
}
