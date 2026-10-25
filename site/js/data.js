// Loads the profile snapshot written by the scheduled workflow, falling back to the
// copy that ships with the site so the page always has something real to show.

import { CONFIG } from './config.js';

const SOURCES = () => [`${CONFIG.assetBase}/data/profile.json`, new URL('../data/profile.sample.json', import.meta.url).href];

function valid(d) {
  return d && d.contrib && Array.isArray(d.contrib.weeks) && d.contrib.weeks.length > 20 && Array.isArray(d.repos);
}

/** Resolves to the parsed document, or null on any failure; never rejects. */
async function getJson(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: ctl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return valid(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadProfile() {
  const [liveUrl, bundledUrl] = SOURCES();
  // the bundled copy is requested at the same time, so a slow or blocked network only ever costs
  // the short wait for the live snapshot
  const bundled = getJson(bundledUrl, 6000);
  const live = await getJson(liveUrl, 2500);
  if (live) return { data: live, source: 'live' };
  const data = await bundled;
  if (data) return { data, source: 'bundled' };
  throw new Error('no profile data available');
}
