import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutText, glyphRows, GLYPH_H } from '../site/lib/font5x7.mjs';
import {
  createCube, applyMoves, parseMoves, invertMoves, scramble, stickers, isSolved, cloneCube,
  signedTurns, parseMove, formatMoves, letterOf,
} from '../site/lib/cube.mjs';
import { mulberry32 } from '../site/lib/rng.mjs';
import { Pong, recordRally, simplifyChannel } from '../site/lib/pong.mjs';
import { sunTimes, sunPosition, moonPhase, moonPositionFromPhase, moonPosition } from '../site/lib/astro.mjs';
import { zoneParts, zoneOffsetMinutes, progress } from '../site/lib/timeutil.mjs';

test('font: every glyph is 7 rows of equal width', () => {
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:.-/+<>·!') {
    const rows = glyphRows(ch);
    assert.ok(rows, `missing glyph ${ch}`);
    assert.equal(rows.length, GLYPH_H, ch);
    assert.ok(rows.every((r) => r.length === rows[0].length), `ragged glyph ${ch}`);
  }
});

test('font: clock layouts fit the 53-column contribution graph', () => {
  assert.equal(layoutText('15:20', { colonGap: 2 }).width, 27);
  assert.equal(layoutText('15:20:07', { colonGap: 1 }).width, 39);
  assert.equal(layoutText('TIMELORD', { gap: 1 }).width, 8 * 5 + 7);
});

test('cube: solved cube has 26 cubies and 54 stickers', () => {
  const c = createCube();
  assert.equal(c.length, 26);
  assert.equal(stickers(c).length, 54);
  assert.ok(isSolved(c));
});

test('cube: every face turn has order 4, and X X\' is the identity', () => {
  for (const f of 'RLUDFB') {
    const c = applyMoves(createCube(), parseMoves(`${f} ${f} ${f} ${f}`));
    assert.ok(isSolved(c), `${f}^4`);
    const d = applyMoves(createCube(), parseMoves(`${f} ${f}'`));
    assert.ok(isSolved(d), `${f} ${f}'`);
    const e = applyMoves(createCube(), parseMoves(`${f}2 ${f}2`));
    assert.ok(isSolved(e), `${f}2 ${f}2`);
  }
});

test('cube: known group orders (R U R\' U\' has order 6, R U has order 105)', () => {
  const sexy = parseMoves("R U R' U'");
  const c = createCube();
  for (let i = 1; i <= 6; i++) {
    applyMoves(c, sexy);
    assert.equal(isSolved(c), i === 6, `sexy^${i}`);
  }
  const ru = parseMoves('R U');
  const d = createCube();
  for (let i = 1; i <= 105; i++) {
    applyMoves(d, ru);
    assert.equal(isSolved(d), i === 105, `(RU)^${i}`);
  }
});

test('cube: clockwise conventions match standard notation', () => {
  const colorsAt = (cubies, pred) =>
    stickers(cubies).filter(pred).map((s) => s.color).sort().join('');
  // R carries the front-right column up onto U.
  let c = applyMoves(createCube(), parseMoves('R'));
  assert.equal(colorsAt(c, (s) => letterOf(s.normal) === 'U' && s.pos[0] === 1), 'FFF');
  // U carries the right face's top row to the front.
  c = applyMoves(createCube(), parseMoves('U'));
  assert.equal(colorsAt(c, (s) => letterOf(s.normal) === 'F' && s.pos[1] === 1), 'RRR');
  // F carries the up face's bottom row to the right face.
  c = applyMoves(createCube(), parseMoves('F'));
  assert.equal(colorsAt(c, (s) => letterOf(s.normal) === 'R' && s.pos[2] === 1), 'UUU');
  // D carries the front face's bottom row to the right face.
  c = applyMoves(createCube(), parseMoves('D'));
  assert.equal(colorsAt(c, (s) => letterOf(s.normal) === 'R' && s.pos[1] === -1), 'FFF');
});

test('cube: signed turns are the shortest rotation', () => {
  assert.equal(signedTurns(parseMove('R')), -1);
  assert.equal(signedTurns(parseMove("R'")), 1);
  assert.equal(signedTurns(parseMove('R2')), 2);
  assert.equal(signedTurns(parseMove('L')), 1);
  assert.equal(signedTurns(parseMove("L'")), -1);
});

test('cube: scramble then inverse solves, for many seeds and length ranges', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const len = 8 + (seed % 17);
    const moves = scramble(mulberry32(seed), len);
    assert.equal(moves.length, len);
    const c = applyMoves(createCube(), moves);
    assert.equal(isSolved(c), false, `seed ${seed} should not be solved after scramble`);
    const snapshot = cloneCube(c);
    applyMoves(c, invertMoves(moves));
    assert.ok(isSolved(c), `seed ${seed}: ${formatMoves(moves)}`);
    assert.equal(isSolved(snapshot), false);
  }
});

test('cube: restricted scrambles only use the allowed faces', () => {
  const moves = scramble(mulberry32(5), 40, 'URF');
  assert.ok(moves.every((m) => 'URF'.includes(m.f)));
  assert.ok(moves.every((m, i) => i === 0 || moves[i - 1].f !== m.f));
});

test('pong: deterministic, in bounds, produces rallies and points', () => {
  const a = recordRally(60, { seed: 11 });
  const b = recordRally(60, { seed: 11 });
  assert.deepEqual(a.frames, b.frames);
  for (const [, x, y, p0, p1] of a.frames) {
    assert.ok(x >= -2.5 && x <= 55.5, `x ${x}`);
    assert.ok(y >= 0 && y <= 7, `y ${y}`);
    assert.ok(p0 >= 1.2 - 1e-9 && p0 <= 5.8 + 1e-9, `p0 ${p0}`);
    assert.ok(p1 >= 1.2 - 1e-9 && p1 <= 5.8 + 1e-9, `p1 ${p1}`);
  }
  const hits = a.events.filter((e) => e.type === 'hit').length;
  assert.ok(hits >= 4, `expected rallies, got ${hits} hits`);
  assert.ok(a.score[0] + a.score[1] >= 1, 'expected at least one point in 60s');
});

test('pong: a human-controlled paddle follows its target', () => {
  const p = new Pong({ seed: 3 });
  p.player[0] = 5.5;
  for (let i = 0; i < 120; i++) p.step(1 / 60);
  assert.ok(Math.abs(p.paddleY[0] - 5.5) < 1e-6);
});

test('pong: path simplification keeps endpoints and stays within tolerance', () => {
  const { frames } = recordRally(20, { seed: 11 });
  const keep = simplifyChannel(frames, 1, 0.03);
  assert.equal(keep[0], 0);
  assert.equal(keep.at(-1), frames.length - 1);
  assert.ok(keep.length < frames.length / 4, `kept ${keep.length}/${frames.length}`);
  for (let k = 0; k < keep.length - 1; k++) {
    const [a, b] = [keep[k], keep[k + 1]];
    for (let i = a; i <= b; i++) {
      const u = (frames[i][0] - frames[a][0]) / (frames[b][0] - frames[a][0]);
      const v = frames[a][1] + (frames[b][1] - frames[a][1]) * u;
      assert.ok(Math.abs(v - frames[i][1]) <= 0.0301);
    }
  }
});

test('astro: San Diego sun times on 2026-10-24 are plausible', () => {
  const t = sunTimes(new Date('2026-10-24T20:00:00Z'), 32.7157, -117.1611);
  const rise = zoneParts(t.sunrise, 'America/Los_Angeles');
  const set = zoneParts(t.sunset, 'America/Los_Angeles');
  const r = rise.hour * 60 + rise.minute;
  const s = set.hour * 60 + set.minute;
  assert.ok(r >= 6 * 60 + 50 && r <= 7 * 60 + 20, `sunrise ${rise.hour}:${rise.minute}`);
  assert.ok(s >= 17 * 60 + 40 && s <= 18 * 60 + 15, `sunset ${set.hour}:${set.minute}`);
  const noon = sunPosition(t.solarNoon, 32.7157, -117.1611);
  assert.ok(noon.elevation > 40 && noon.elevation < 50, `noon elevation ${noon.elevation}`);
  const midnight = sunPosition(new Date('2026-10-25T08:00:00Z'), 32.7157, -117.1611);
  assert.ok(midnight.elevation < -30);
});

test('astro: moon phase matches the 2026 calendar', () => {
  const nearNew = moonPhase(new Date('2026-10-10T15:50:00Z'));
  assert.ok(nearNew.illum < 0.03, `new moon illum ${nearNew.illum}`);
  const nearFull = moonPhase(new Date('2026-10-26T04:12:00Z'));
  assert.ok(nearFull.illum > 0.97, `full moon illum ${nearFull.illum}`);
  const today = moonPhase(new Date('2026-10-24T22:00:00Z'));
  assert.equal(today.name, 'Waxing Gibbous');
  assert.ok(today.illum > 0.88 && today.illum < 0.99);
});

test('astro: the moon sits on the sun at new moon and opposite it at full moon', () => {
  const d = new Date('2026-10-24T22:25:00Z');
  const [lat, lon] = [32.7157, -117.1611];
  const sun = sunPosition(d, lat, lon);
  const nm = moonPositionFromPhase(d, lat, lon, 0);
  assert.ok(Math.abs(nm.elevation - sun.elevation) < 1e-6 && Math.abs(nm.azimuth - sun.azimuth) < 1e-6);
  const fm = moonPositionFromPhase(d, lat, lon, 0.5);
  assert.ok(Math.abs(fm.elevation + sun.elevation) < 1e-6, 'full moon elevation mirrors the sun');
  assert.ok(Math.abs(((fm.azimuth - sun.azimuth + 360) % 360) - 180) < 1e-6, 'and is 180 degrees around the sky');
  // a near-full moon has not risen yet in the mid-afternoon, and is up around local midnight
  assert.ok(moonPosition(d, lat, lon).elevation < 0);
  assert.ok(moonPosition(new Date('2026-10-25T08:00:00Z'), lat, lon).elevation > 20);
});

test('timeutil: zone parts, offsets and progress', () => {
  const d = new Date('2026-10-24T22:20:00Z');
  const la = zoneParts(d, 'America/Los_Angeles');
  assert.deepEqual([la.hour, la.minute, la.weekday, la.tzName], [15, 20, 6, 'PDT']);
  assert.equal(zoneOffsetMinutes(d, 'America/Los_Angeles'), -420);
  assert.equal(zoneOffsetMinutes(d, 'Asia/Kolkata'), 330);
  assert.equal(zoneOffsetMinutes(d, 'UTC'), 0);
  const p = progress(d, 'UTC');
  assert.ok(Math.abs(p.day - (22 * 60 + 20) / 1440) < 1e-9);
  assert.equal(p.dayOfYear, 297);
});
