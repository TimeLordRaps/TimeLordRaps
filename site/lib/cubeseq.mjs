// Timed move lists for the self-solving cube, shared by the README builder and the site.
//
// A "plan" is a scramble followed, after a hold, by its exact reverse. The reverse of a
// scramble is a solution, so every cube here solves itself without a search.

import { createCube, cloneCube, applyMove, invertMoves, scramble, moveAngle, FACE } from './cube.mjs';
import { easeInOutCubic, clamp } from './rng.mjs';

/**
 * @param rng        () => [0,1)
 * @param o.moves    scramble length
 * @param o.faces    letters the scramble may turn ('URF' keeps every turn on the visible corner)
 * @param o.t0       time of the first move, seconds
 * @returns {{n, scr, sol, seq, firstSolve, scrambleEnd, solveStart, solvedAt}} where seq is
 *          [{ m, t0, t1, kind: 'scramble' | 'solve' }] in play order.
 */
export function planSolve(rng, o = {}) {
  const { moves = 9, faces = 'RLUDFB', t0 = 0, scrambleMove = 0.12, hold = 1.5, solveMove = 0.5, gap = 0.05, halfTurnScale = 1.25 } = o;
  const scr = scramble(rng, moves, faces);
  const sol = invertMoves(scr);
  const seq = [];
  let t = t0;
  for (const m of scr) {
    seq.push({ m, t0: t, t1: t + scrambleMove, kind: 'scramble' });
    t += scrambleMove;
  }
  const scrambleEnd = t;
  t += hold;
  const solveStart = t;
  for (const m of sol) {
    const d = m.n === 2 ? solveMove * halfTurnScale : solveMove;
    seq.push({ m, t0: t, t1: t + d, kind: 'solve' });
    t += d + gap;
  }
  return { n: moves, scr, sol, seq, firstSolve: moves, scrambleEnd, solveStart, solvedAt: seq.at(-1).t1 };
}

/** Plays a move list against the cube model, applying finished moves incrementally. */
export class Track {
  constructor(seq, start = null) {
    this.seq = seq;
    this.start = start;
    this.reset();
  }

  reset() {
    this.model = this.start ? cloneCube(this.start) : createCube();
    this.applied = 0;
  }

  /** State at `tau` seconds: the settled model, the move in flight (or null) and how many are done. */
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
