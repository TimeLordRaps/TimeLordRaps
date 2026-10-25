// Deterministic Pong on a 53x7 court (the contribution graph's own proportions).
// "PAST" is the left paddle, "FUTURE" the right one, and the ball is NOW.
// The same simulation drives the pre-baked README animation and the live, playable site.

import { mulberry32, clamp } from './rng.mjs';

const SUB = 1 / 120;

export class Pong {
  constructor(o = {}) {
    this.w = o.w ?? 53;
    this.h = o.h ?? 7;
    this.paddleH = o.paddleH ?? 2.6;
    this.paddleT = o.paddleT ?? 0.8;
    this.px = o.paddleX ?? [2.4, this.w - 2.4];
    this.r = o.ballR ?? 0.38;
    this.speed0 = o.speed ?? 19;
    this.speedMax = o.maxSpeed ?? 32;
    this.aiSpeed = o.aiSpeed ?? 11;
    this.missRate = o.missRate ?? 0.2;
    this.playerSpeed = o.playerSpeed ?? 48;
    this.rng = mulberry32(o.seed ?? 7);
    this.t = 0;
    this.acc = 0;
    this.score = [0, 0];
    this.paddleY = [this.h / 2, this.h / 2];
    this.player = [null, null]; // target y while a human steers that side
    this.aim = [0, 0];
    this.events = []; // {type:'launch'|'wall'|'hit'|'score', t, x, y, side?}
    this.serve(this.rng() < 0.5 ? 1 : -1, 0.5);
  }

  serve(dir, delay = 0.9) {
    this.ball = { x: this.w / 2, y: this.h / 2, vx: 0, vy: 0 };
    this.pending = { dir, at: this.t + delay };
    this._reroll(0);
    this._reroll(1);
  }

  _reroll(i) {
    const pad = this.paddleH / 2;
    this.aim[i] =
      this.rng() < this.missRate
        ? (this.rng() < 0.5 ? -1 : 1) * (pad + this.r + 0.9)
        : (this.rng() * 2 - 1) * pad * 0.85;
  }

  _predict(x) {
    const b = this.ball;
    const H = this.h - 2 * this.r;
    let y = (b.y + b.vy * ((x - b.x) / b.vx) - this.r) % (2 * H);
    if (y < 0) y += 2 * H;
    if (y > H) y = 2 * H - y;
    return y + this.r;
  }

  step(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) {
      this._tick(SUB);
      this.acc -= SUB;
    }
  }

  _tick(dt) {
    this.t += dt;
    this._paddles(dt);
    const b = this.ball;
    if (this.pending) {
      if (this.t < this.pending.at) return;
      const ang = (this.rng() - 0.5) * 0.9;
      b.vx = Math.cos(ang) * this.speed0 * this.pending.dir;
      b.vy = Math.sin(ang) * this.speed0;
      this.pending = null;
      this.events.push({ type: 'launch', t: this.t, x: b.x, y: b.y });
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const { r, h } = this;
    if (b.y < r) {
      b.y = 2 * r - b.y;
      b.vy = Math.abs(b.vy);
      this.events.push({ type: 'wall', t: this.t, x: b.x, y: r });
    } else if (b.y > h - r) {
      b.y = 2 * (h - r) - b.y;
      b.vy = -Math.abs(b.vy);
      this.events.push({ type: 'wall', t: this.t, x: b.x, y: h - r });
    }

    for (let i = 0; i < 2; i++) {
      if (i === 0 ? b.vx >= 0 : b.vx <= 0) continue;
      const face = this.px[i] + (i === 0 ? 1 : -1) * (this.paddleT / 2);
      const reached = i === 0 ? b.x - r <= face : b.x + r >= face;
      const notPast = Math.abs(b.x - this.px[i]) < this.paddleT / 2 + r + 0.6;
      if (reached && notPast && Math.abs(b.y - this.paddleY[i]) <= this.paddleH / 2 + r * 0.7) {
        this._hit(i, face);
      }
    }

    if (b.x < -2) this._point(1);
    else if (b.x > this.w + 2) this._point(0);
  }

  _hit(i, face) {
    const b = this.ball;
    const dir = i === 0 ? 1 : -1;
    b.x = face + dir * this.r;
    const off = clamp((b.y - this.paddleY[i]) / (this.paddleH / 2 + this.r * 0.7), -1, 1);
    const sp = Math.min(this.speedMax, Math.hypot(b.vx, b.vy) * 1.04 + 0.5);
    const ang = off * 0.95;
    b.vx = dir * Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    this._reroll(1 - i);
    this.events.push({ type: 'hit', side: i, t: this.t, x: b.x, y: b.y });
  }

  _point(winner) {
    this.score[winner]++;
    this.events.push({ type: 'score', side: winner, t: this.t, x: this.ball.x, y: this.ball.y });
    this.serve(winner === 0 ? 1 : -1);
  }

  _paddles(dt) {
    const lo = this.paddleH / 2;
    const hi = this.h - lo;
    for (let i = 0; i < 2; i++) {
      let target;
      let speed = this.aiSpeed;
      if (this.player[i] != null) {
        target = this.player[i];
        speed = this.playerSpeed;
      } else {
        const b = this.ball;
        const toward = !this.pending && (i === 0 ? b.vx < 0 : b.vx > 0);
        target = toward
          ? this._predict(this.px[i]) + this.aim[i]
          : this.h / 2 + Math.sin(this.t * 0.9 + i * 2.1) * 0.9;
      }
      const d = clamp(target - this.paddleY[i], -speed * dt, speed * dt);
      this.paddleY[i] = clamp(this.paddleY[i] + d, lo, hi);
    }
  }

  snapshot() {
    return {
      t: this.t,
      ball: { x: this.ball.x, y: this.ball.y, live: !this.pending },
      paddles: this.paddleY.slice(),
      score: this.score.slice(),
    };
  }
}

/**
 * Run the simulation offline and return sampled frames [t, bx, by, p0, p1].
 * Used to bake a rally into SVG keyframes.
 */
export function recordRally(seconds, opts = {}, fps = 60) {
  const sim = new Pong(opts);
  const frames = [];
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) {
    const s = sim.snapshot();
    frames.push([i * dt, s.ball.x, s.ball.y, s.paddles[0], s.paddles[1], s.ball.live ? 1 : 0]);
    sim.step(dt);
  }
  return { frames, events: sim.events, score: sim.score.slice() };
}

/** Ramer-Douglas-Peucker on one scalar channel over time, returns kept indices. */
export function simplifyChannel(frames, ch, tol) {
  const keep = new Set([0, frames.length - 1]);
  const stack = [[0, frames.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let wi = -1;
    const ta = frames[a][0];
    const tb = frames[b][0];
    const va = frames[a][ch];
    const vb = frames[b][ch];
    for (let i = a + 1; i < b; i++) {
      const u = (frames[i][0] - ta) / (tb - ta);
      const e = Math.abs(frames[i][ch] - (va + (vb - va) * u));
      if (e > worst) {
        worst = e;
        wi = i;
      }
    }
    if (worst > tol) {
      keep.add(wi);
      stack.push([a, wi], [wi, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}
