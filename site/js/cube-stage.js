// The cube panel: a shared, time-seeded scramble/solve cycle, drag-to-orbit, a click that
// starts your own shuffle, and a clock-face floor whose hand is the second hand.
//
// Every visitor sees the same cube at the same moment: the cycle index is floor(unix/20s)
// and the scramble is a pure function of it. The solve is the reversed scramble.

import { createCube, cloneCube, applyMove, invertMoves, scramble, moveAngle, FACE, formatMove } from '../lib/cube.mjs';
import { mulberry32, hash32, easeInOutCubic } from '../lib/rng.mjs';
import { CubeRenderer, STICKER_HEX } from './cube-gl.js';
import { fitCanvas, clamp, TAU } from './util.js';

export const CYCLE = 20; // seconds, so the hand of the floor dial passes 12, 4 and 8 o'clock at each new cube
const LEAD = 0.4;
const T_SCRAMBLE = 0.12;
const HOLD = 1.5;
const T_SOLVE = 0.5;
const GAP = 0.05;

/** Timed move list for one shared cycle. Times are seconds from the cycle start. */
export function cycleFor(idx) {
  const rng = mulberry32(hash32(`chronosphere:${idx}`));
  const n = 14 + ((rng() * 5) | 0);
  const scr = scramble(rng, n, 'RLUDFB');
  const sol = invertMoves(scr);
  const seq = [];
  let t = LEAD;
  for (const m of scr) {
    seq.push({ m, t0: t, t1: t + T_SCRAMBLE, kind: 'scramble' });
    t += T_SCRAMBLE;
  }
  t += HOLD;
  const solveStart = t;
  for (const m of sol) {
    const d = m.n === 2 ? T_SOLVE * 1.25 : T_SOLVE;
    seq.push({ m, t0: t, t1: t + d, kind: 'solve' });
    t += d + GAP;
  }
  return { idx, n, seq, firstSolve: n, scrambleEnd: LEAD + n * T_SCRAMBLE, solveStart, solvedAt: seq.at(-1).t1 };
}

/** Plays a move list against the cube model, applying moves incrementally. */
class Track {
  constructor(seq, start = null) {
    this.seq = seq;
    this.start = start;
    this.reset();
  }
  reset() {
    this.model = this.start ? cloneCube(this.start) : createCube();
    this.applied = 0;
  }
  at(tau) {
    let done = this.applied;
    if (done > 0 && this.seq[done - 1].t1 > tau) {
      this.reset();
      done = 0;
    }
    while (done < this.seq.length && this.seq[done].t1 <= tau) done++;
    while (this.applied < done) applyMove(this.model, this.seq[this.applied++].m);
    let anim = null;
    const s = this.seq[done];
    if (s && s.t0 <= tau) {
      const { axis, sign } = FACE[s.m.f];
      anim = { axis, sign, angle: moveAngle(s.m, easeInOutCubic(clamp((tau - s.t0) / (s.t1 - s.t0), 0, 1))), step: s, index: done };
    }
    return { model: this.model, anim, done };
  }
}

export class CubeStage {
  constructor({ stage, glCanvas, floor, fx, hudEl, infoEl, app }) {
    this.stage = stage;
    this.app = app;
    this.hudEl = hudEl;
    this.infoEl = infoEl;
    this.floor = floor;
    this.fx = fx;
    this.fg = floor.getContext('2d');
    this.xg = fx.getContext('2d');
    this.renderer = new CubeRenderer(glCanvas);
    this.rest = createCube();

    this.yaw = 0.6;
    this.pitch = 0.46;
    this.vyaw = 0;
    this.vpitch = 0;
    this.drag = null;
    this.glow = 0;
    this.wasSolved = true;
    this.particles = [];
    this.personal = null;
    this.syncWait = false;
    this.cycle = null;
    this.hud = '';
    this.visible = true;
    this.bind();
  }

  // ---------------------------------------------------------------- input
  bind() {
    const el = this.stage;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: 0 };
      this.vyaw = this.vpitch = 0;
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.lx;
      const dy = e.clientY - d.ly;
      d.lx = e.clientX;
      d.ly = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.0085;
      this.pitch = clamp(this.pitch + dy * 0.0065, -1.2, 1.35);
      this.vyaw = -dx * 0.0085 * 60;
      this.vpitch = dy * 0.0065 * 60;
    });
    const end = (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && d.moved < 6 && performance.now() - d.t < 500 && e.type === 'pointerup') this.reshuffle();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.reshuffle();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const k = 0.25;
        if (e.key === 'ArrowLeft') this.yaw += k;
        if (e.key === 'ArrowRight') this.yaw -= k;
        if (e.key === 'ArrowUp') this.pitch = clamp(this.pitch - k, -1.2, 1.35);
        if (e.key === 'ArrowDown') this.pitch = clamp(this.pitch + k, -1.2, 1.35);
      }
    });
  }

  // ---------------------------------------------------------------- your own shuffle
  /** Rewind whatever is on the cube, scramble it your way, then solve it. Starts seamlessly. */
  reshuffle() {
    if (this.personal || !this.cycle) return;
    const sec = Date.now() / 1000;
    const tau = sec - this.cycle.idx * CYCLE;
    const cur = this.shared;
    const history = this.cycle.seq.slice(0, cur.done).map((s) => s.m);
    const seq = [];
    let t = 0;
    if (cur.anim) {
      const s = cur.anim.step;
      seq.push({ m: s.m, t0: s.t0 - tau, t1: s.t1 - tau, kind: 'rewind' });
      history.push(s.m);
      t = s.t1 - tau;
    }
    for (const m of invertMoves(history)) {
      const d = m.n === 2 ? 0.2 : 0.14;
      seq.push({ m, t0: t, t1: t + d, kind: 'rewind' });
      t += d;
    }
    t += 0.3;
    const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    const extra = scramble(rng, 9 + ((rng() * 5) | 0), 'RLUDFB');
    for (const m of extra) {
      seq.push({ m, t0: t, t1: t + 0.11, kind: 'scramble' });
      t += 0.11;
    }
    const scrambleEnd = t;
    t += 1.1;
    const solveStart = t;
    for (const m of invertMoves(extra)) {
      const d = m.n === 2 ? T_SOLVE * 1.25 : T_SOLVE;
      seq.push({ m, t0: t, t1: t + d, kind: 'solve' });
      t += d + GAP;
    }
    const start = cloneCube(cur.model);
    this.personal = { base: sec, track: new Track(seq, start), seq, end: seq.at(-1).t1 + 0.2, n: extra.length, firstSolve: seq.findIndex((x) => x.kind === 'solve'), scrambleEnd, solveStart, solvedAt: seq.at(-1).t1 };
    this.app.emit('reshuffle');
  }

  // ---------------------------------------------------------------- per frame
  frame(dt) {
    dt = Math.min(dt, 0.1);
    const sec = Date.now() / 1000;
    const idx = Math.floor(sec / CYCLE);
    if (!this.cycle || this.cycle.idx !== idx) {
      this.cycle = cycleFor(idx);
      this.track = new Track(this.cycle.seq);
    }
    const tau = sec - idx * CYCLE;
    const frozen = this.app.reduced && !this.personal;
    this.shared = frozen ? { model: this.rest, anim: null, done: 0 } : this.track.at(tau);

    let view = this.shared;
    let plan = this.cycle;
    let t = tau;
    let own = false;
    if (this.personal) {
      const pt = sec - this.personal.base;
      if (pt >= this.personal.end) {
        this.personal = null;
        this.syncWait = true;
      } else {
        view = this.personal.track.at(pt);
        plan = this.personal;
        t = pt;
        own = true;
      }
    }
    if (!this.personal && this.syncWait) {
      const settled = frozen || tau >= this.cycle.solvedAt || (this.shared.done === 0 && !this.shared.anim);
      if (settled) this.syncWait = false;
      else view = { model: this.rest, anim: null, done: 0 };
    }

    // ---- status line
    const total = plan.n;
    const pad = (n) => String(n).padStart(2, '0');
    let text;
    let solved = false;
    if (this.syncWait) {
      text = `SOLVED · NEXT CUBE ON THE ${pad(CYCLE - (tau % CYCLE) | 0)}S MARK`;
      solved = true;
    } else if (frozen) {
      text = 'SOLVED · CLICK TO SHUFFLE';
      solved = true;
    } else {
      const cur = view.anim ? view.anim.step : plan.seq[Math.min(view.done, plan.seq.length - 1)];
      if (t >= plan.solvedAt) {
        text = own ? `SOLVED · ${total} MOVES` : `SOLVED · ${total} MOVES · REVERSED SCRAMBLE`;
        solved = true;
      } else if (t >= plan.solveStart) {
        const k = clamp(view.done - plan.firstSolve + 1, 1, total);
        text = `SOLVING ${pad(k)}/${pad(total)} · ${formatMove(cur.m)}`;
      } else if (t >= plan.scrambleEnd) text = `SCRAMBLED · SOLVING IN ${Math.max(0, plan.solveStart - t).toFixed(1)}S`;
      else if (cur.kind === 'rewind') text = 'REWINDING TO SOLVED…';
      else text = own ? `YOUR SHUFFLE · ${total} MOVES` : tau < LEAD ? `NEW CUBE · SEED #${this.cycle.idx % 100000}` : `SCRAMBLING · ${total} MOVES`;
    }
    if (text !== this.hud) {
      this.hud = text;
      this.hudEl.textContent = text;
    }
    const info = own ? 'YOUR SHUFFLE' : `SHARED · #${this.cycle.idx % 100000}`;
    if (info !== this.infoEl.textContent) this.infoEl.textContent = info;
    this.stage.classList.toggle('solved', solved);

    // ---- celebration
    if (solved && !this.wasSolved) this.burst();
    this.wasSolved = solved;
    this.glow += ((solved ? 1 : 0) - this.glow) * Math.min(1, dt * 4);

    // ---- view
    const idle = this.app.reduced ? 0 : 0.2;
    if (!this.drag) {
      this.yaw += (this.vyaw + (this.vyaw === 0 ? idle : 0)) * dt;
      this.pitch = clamp(this.pitch + this.vpitch * dt, -1.2, 1.35);
      const damp = Math.exp(-dt * 3.2);
      this.vyaw *= damp;
      this.vpitch *= damp;
      if (Math.abs(this.vyaw) < 0.02) this.vyaw = 0;
      if (Math.abs(this.vpitch) < 0.01) this.vpitch = 0;
      // settle the pitch back to a pleasant angle when nobody is steering
      if (this.vpitch === 0) this.pitch += (0.46 - this.pitch) * Math.min(1, dt * 0.6);
    }

    if (!this.visible) return;
    this.renderer.render({ cubies: view.model, anim: view.anim, yaw: this.yaw, pitch: this.pitch, glow: this.glow });
    this.drawFloor(dt, solved);
    this.drawFx(dt);
  }

  // ---------------------------------------------------------------- 2D layers
  drawFloor(dt, solved) {
    const { w, h, dpr } = fitCanvas(this.floor);
    const g = this.fg;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.8;
    const rx = Math.min(w * 0.44, h * 0.62);
    const ry = rx * 0.3;
    const sec = (this.app.clock.ms() / 1000) % 60;

    // contact shadow
    const sh = g.createRadialGradient(cx, cy - ry * 0.15, 0, cx, cy - ry * 0.15, rx * 0.72);
    sh.addColorStop(0, 'rgba(0,0,0,.65)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.translate(0, 0);
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(cx, cy - ry * 0.15, rx * 0.72, ry * 0.62, 0, 0, TAU);
    g.fill();
    g.restore();

    // glow when solved
    if (this.glow > 0.01) {
      const gl = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
      gl.addColorStop(0, `rgba(79,240,180,${0.34 * this.glow})`);
      gl.addColorStop(1, 'rgba(79,240,180,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.ellipse(cx, cy, rx * 1.05, ry * 1.05, 0, 0, TAU);
      g.fill();
    }

    // dial: 60 ticks, the swept ones lit
    g.lineCap = 'round';
    for (let s = 0; s < 60; s++) {
      const a = (s / 60) * TAU - Math.PI / 2;
      const big = s % 5 === 0;
      const r0 = 1 - (big ? 0.09 : 0.045);
      const lit = s <= sec;
      const age = sec - s;
      g.strokeStyle = lit ? (age < 1.2 ? '#ffffff' : `rgba(70,224,255,${0.35 + 0.5 * Math.max(0, 1 - age / 20)})`) : big ? 'rgba(141,160,196,.5)' : 'rgba(81,100,140,.45)';
      g.lineWidth = big ? 2.2 : 1.3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * rx * r0, cy + Math.sin(a) * ry * r0);
      g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      g.stroke();
    }
    g.strokeStyle = 'rgba(70,224,255,.22)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.9, ry * 0.9, 0, 0, TAU);
    g.stroke();

    // the second hand, with a fading wake
    const a = (sec / 60) * TAU - Math.PI / 2;
    g.save();
    g.beginPath();
    g.moveTo(cx, cy);
    g.ellipse(cx, cy, rx * 0.9, ry * 0.9, 0, a - 0.9, a);
    g.closePath();
    const wake = g.createRadialGradient(cx, cy, 0, cx, cy, rx * 0.9);
    wake.addColorStop(0, 'rgba(70,224,255,0)');
    wake.addColorStop(1, 'rgba(70,224,255,.22)');
    g.fillStyle = wake;
    g.fill();
    g.restore();
    g.strokeStyle = '#ffc857';
    g.lineWidth = 2;
    g.shadowColor = '#ffc857';
    g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * rx * 0.97, cy + Math.sin(a) * ry * 0.97);
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#ffc857';
    g.beginPath();
    g.arc(cx, cy, 3.2, 0, TAU);
    g.fill();
  }

  burst() {
    if (this.app.reduced) return;
    const cols = Object.values(STICKER_HEX);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 170;
      this.particles.push({ x: 0.5, y: 0.46, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 40, life: 0, max: 0.9 + Math.random() * 0.7, c: cols[i % cols.length], r: 1.4 + Math.random() * 2.2 });
    }
  }

  drawFx(dt) {
    const { w, h, dpr } = fitCanvas(this.fx);
    const g = this.xg;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.particles.length) return;
    g.globalCompositeOperation = 'lighter';
    this.particles = this.particles.filter((p) => (p.life += dt) < p.max);
    for (const p of this.particles) {
      p.vy += 160 * dt;
      p.x += (p.vx * dt) / w;
      p.y += (p.vy * dt) / h;
      const u = 1 - p.life / p.max;
      g.globalAlpha = u * 0.9;
      g.fillStyle = p.c;
      g.shadowColor = p.c;
      g.shadowBlur = 10;
      g.beginPath();
      g.arc(p.x * w, p.y * h, p.r * (0.4 + u), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'source-over';
  }
}
