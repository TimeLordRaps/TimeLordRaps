// A virtual clock (the "time machine") and the list of zones every instrument can show.

import { localZone, zoneOffsetMinutes } from '../lib/timeutil.mjs';
import { WORLD } from './config.js';
import { placeForZone } from './places.js';

export class VClock {
  constructor() {
    this.reset();
  }
  reset() {
    this.realAnchor = Date.now();
    this.virtAnchor = this.realAnchor;
    this.rate = 1;
  }
  ms() {
    return this.virtAnchor + (Date.now() - this.realAnchor) * this.rate;
  }
  now() {
    return new Date(this.ms());
  }
  shift(deltaMs) {
    const v = this.ms() + deltaMs;
    this.realAnchor = Date.now();
    this.virtAnchor = v;
  }
  setRate(rate) {
    const v = this.ms();
    this.realAnchor = Date.now();
    this.virtAnchor = v;
    this.rate = rate;
  }
  get offsetMs() {
    return this.ms() - Date.now();
  }
  get live() {
    return this.rate === 1 && Math.abs(this.offsetMs) < 1500;
  }
}

const prettyZone = (tz) => (tz.split('/').pop() || tz).replace(/_/g, ' ').toUpperCase();

/** Build the zone table. The visitor's own zone is detected locally and never sent anywhere. */
export function buildZones() {
  const tz = localZone();
  const spot = placeForZone(tz, zoneOffsetMinutes(new Date(), tz));
  const you = { id: 'you', label: 'YOU', place: prettyZone(tz), tz, lat: spot.lat, lon: spot.lon, exact: spot.exact };
  const list = [you, ...WORLD.map((z) => ({ ...z, place: z.label, exact: true }))];
  const byId = Object.fromEntries(list.map((z) => [z.id, z]));
  return { list, byId, you, home: byId.home };
}
