// Low-precision astronomy for the sky and moon instruments (NOAA solar position,
// Meeus ch. 48 lunar phase). Accurate to about a minute for the sun and a few
// percent for lunar illumination, which is plenty for a dial.

import { clamp } from './rng.mjs';

const RAD = Math.PI / 180;
const norm360 = (d) => ((d % 360) + 360) % 360;

export const julianDay = (date) => date.getTime() / 86400000 + 2440587.5;

function sunCoords(jd) {
  const jc = (jd - 2451545) / 36525;
  const L0 = norm360(280.46646 + jc * (36000.76983 + jc * 0.0003032));
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C =
    Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const eqTime =
    (4 *
      (y * Math.sin(2 * L0 * RAD) -
        2 * e * Math.sin(M * RAD) +
        4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
        0.5 * y * y * Math.sin(4 * L0 * RAD) -
        1.25 * e * e * Math.sin(2 * M * RAD))) /
    RAD;
  return { decl, eqTime, lambda, eps };
}

/** Elevation/azimuth (degrees) of a body with declination `decl` and hour angle `ha` (both degrees). */
function altAz(lat, decl, ha) {
  const cosZ = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const zen = Math.acos(clamp(cosZ, -1, 1));
  const denom = Math.cos(lat * RAD) * Math.sin(zen);
  let az;
  if (Math.abs(denom) > 0.001) {
    const c = clamp((Math.sin(lat * RAD) * Math.cos(zen) - Math.sin(decl * RAD)) / denom, -1, 1);
    az = 180 - Math.acos(c) / RAD;
    if (ha > 0) az = -az;
  } else az = lat > 0 ? 180 : 0;
  return { elevation: 90 - zen / RAD, azimuth: norm360(az), declination: decl };
}

function solarHourAngle(date, lon, eqTime) {
  const minUTC =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  const tst = (((minUTC + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  return tst / 4 - 180;
}

/** Sun elevation/azimuth (degrees) for an observer. lon is east-positive. */
export function sunPosition(date, lat, lon) {
  const { decl, eqTime } = sunCoords(julianDay(date));
  return altAz(lat, decl, solarHourAngle(date, lon, eqTime));
}

/**
 * Where the moon is for a given phase (0 new .. .5 full .. 1). It is placed on the ecliptic
 * `phase * 360` degrees ahead of the sun, so it ignores the moon's own few degrees of
 * ecliptic latitude. That is good for a sky dial, not for pointing a telescope.
 */
export function moonPositionFromPhase(date, lat, lon, phase) {
  const { eqTime, lambda, eps } = sunCoords(julianDay(date));
  const lm = lambda + phase * 360;
  const ra = (l) => Math.atan2(Math.cos(eps * RAD) * Math.sin(l * RAD), Math.cos(l * RAD)) / RAD;
  const declM = Math.asin(Math.sin(eps * RAD) * Math.sin(lm * RAD)) / RAD;
  const haM = solarHourAngle(date, lon, eqTime) + ra(lambda) - ra(lm);
  return altAz(lat, declM, haM);
}

export function moonPosition(date, lat, lon) {
  return moonPositionFromPhase(date, lat, lon, moonPhase(date).phase);
}

/** Sunrise / solar noon / sunset (UTC instants) for the calendar day around `date`. */
export function sunTimes(date, lat, lon) {
  const day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const probe = new Date(day0 + 12 * 3600e3 - lon * 4 * 60e3);
  const { decl, eqTime } = sunCoords(julianDay(probe));
  const noonMin = 720 - 4 * lon - eqTime;
  const solarNoon = new Date(day0 + noonMin * 60e3);
  const cosH =
    (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
  if (cosH > 1) return { sunrise: null, sunset: null, solarNoon, polar: 'night' };
  if (cosH < -1) return { sunrise: null, sunset: null, solarNoon, polar: 'day' };
  const H = Math.acos(cosH) / RAD;
  return {
    sunrise: new Date(day0 + (noonMin - 4 * H) * 60e3),
    sunset: new Date(day0 + (noonMin + 4 * H) * 60e3),
    solarNoon,
    polar: null,
  };
}

const PHASES = [
  [0.03, 'New Moon'],
  [0.22, 'Waxing Crescent'],
  [0.28, 'First Quarter'],
  [0.47, 'Waxing Gibbous'],
  [0.53, 'Full Moon'],
  [0.72, 'Waning Gibbous'],
  [0.78, 'Last Quarter'],
  [0.97, 'Waning Crescent'],
  [1.01, 'New Moon'],
];

/** phase: 0 new .. .5 full .. 1 new. illum: 0..1. */
export function moonPhase(date) {
  const T = (julianDay(date) - 2451545) / 36525;
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868 - T ** 4 / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + (T * T * T) / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699 - T ** 4 / 14712000);
  const s = (deg) => Math.sin(deg * RAD);
  const i = 180 - D - 6.289 * s(Mp) + 2.1 * s(M) - 1.274 * s(2 * D - Mp) - 0.658 * s(2 * D) - 0.214 * s(2 * Mp) - 0.11 * s(D);
  const illum = (1 + Math.cos(i * RAD)) / 2;
  const phase = D / 360;
  const name = PHASES.find(([max]) => phase < max)[1];
  return { illum, phase, name, ageDays: phase * 29.530588 };
}
