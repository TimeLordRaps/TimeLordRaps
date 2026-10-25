// Chronosphere: wires the clock, the Chrono-Grid, the cube and the instrument bay together.

import { CONFIG } from './config.js';
import { loadProfile } from './data.js';
import { VClock, buildZones } from './clock.js';
import { Emitter, $, toast, prefersReducedMotion, ago } from './util.js';
import { ChronoGrid } from './grid.js';
import { Wordmark } from './wordmark.js';
import { CubeStage } from './cube-stage.js';
import { InstrumentBay } from './instruments.js';
import { Starfield } from './stars.js';
import { zoneParts, pad2 } from '../lib/timeutil.mjs';

class App extends Emitter {
  constructor(data, source) {
    super();
    const params = new URLSearchParams(location.search);
    this.params = params;
    this.data = data;
    this.source = source;
    this.clock = new VClock();
    this.zones = buildZones();
    this.reduced = prefersReducedMotion() || params.has('still');
    this.focus = this.zones.you;
    this.toast = toast;
  }

  placeOf(z) {
    return { lat: z.lat, lon: z.lon, exact: z.exact };
  }

  placeLabel(z) {
    return z.id === 'you' ? z.place : z.label;
  }

  setMode(mode) {
    this.grid.setMode(mode);
    this.updateChips();
  }

  selectZone(z, quiet = false) {
    this.focus = z;
    this.grid.setZone(z);
    this.grid.setMode('clock');
    this.updateChips();
    if (!quiet) {
      const p = zoneParts(this.clock.now(), z.tz);
      toast(z.id === 'you' ? `YOUR TIME · ${z.place} · ${p.tzName}` : `${z.label} · ${p.tzName}`);
    }
  }

  /** Click or tap on the graph: your time, then back to the activity. */
  onGridClick() {
    const g = this.grid;
    if (g.mode === 'clock' && g.zone === this.zones.you && g.want === 1) {
      this.setMode('activity');
      toast('BACK TO THE ACTIVITY GRAPH');
    } else this.selectZone(this.zones.you);
  }

  updateChips() {
    const g = this.grid;
    const id = g.mode === 'auto' ? 'auto' : g.mode === 'activity' ? 'activity' : g.zone.id;
    for (const b of document.querySelectorAll('#modeChips button, #zoneChips button')) b.setAttribute('aria-checked', String(b.dataset.id === id));
    const you = g.mode === 'clock' && g.zone === this.zones.you;
    g.canvas.setAttribute(
      'aria-label',
      g.mode === 'clock'
        ? `Chrono-Grid showing the time in ${g.zone.id === 'you' ? 'your time zone' : g.zone.label}. Activate to ${you ? 'return to the activity graph' : 'show your own time zone'}.`
        : 'Chrono-Grid: my contribution graph. Activate to show the time in your time zone.',
    );
  }
}

function buildChips(app) {
  const mk = (label, id, onClick, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.id = id;
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  $('#modeChips').append(
    mk('▶ Auto', 'auto', () => app.setMode('auto'), 'Cycle between the activity graph and the clock, with Pong'),
    mk('Activity', 'activity', () => app.setMode('activity'), 'Hold the real contribution graph'),
  );
  for (const z of app.zones.list) {
    $('#zoneChips').append(mk(z.id === 'you' ? `You · ${z.place}` : z.label, z.id, () => app.selectZone(z), `Show the time in ${z.tz.replace(/_/g, ' ')}`));
  }
}

function buildTimeMachine(app) {
  const root = $('#timeMachine');
  const out = $('#tmState');
  const rates = [...root.querySelectorAll('[data-rate]')];
  const sync = () => rates.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rate === app.clock.rate)));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.shift) app.clock.shift(+b.dataset.shift);
    else if (b.hasAttribute('data-now')) app.clock.reset();
    else if (b.dataset.rate) app.clock.setRate(+b.dataset.rate);
    sync();
    render();
  });
  const render = () => {
    const c = app.clock;
    let text = 'LIVE';
    if (!c.live) {
      const off = c.offsetMs;
      const a = Math.abs(off) / 1000;
      const d = Math.floor(a / 86400);
      const h = Math.floor((a % 86400) / 3600);
      const m = Math.floor((a % 3600) / 60);
      text = `${off < 0 ? '−' : '+'}${d ? `${d}D ` : ''}${h}H ${pad2(m)}M${c.rate !== 1 ? ` · ×${c.rate}` : ''}`;
    }
    if (out.value !== text) out.value = text;
    out.classList.toggle('warp', !c.live);
  };
  return render;
}

function fillWorkStats(data) {
  for (const li of document.querySelectorAll('[data-repo]')) {
    const r = data.repos.find((x) => x.name.toLowerCase() === li.dataset.repo);
    const el = li.querySelector('[data-stat]');
    if (!r || !el) continue;
    el.textContent = `PUSHED ${ago(r.pushedAt).toUpperCase()}${r.lang ? ` · ${r.lang.toUpperCase()}` : ''}${r.stars ? ` · ★${r.stars}` : ''} →`;
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function fillStats(data) {
  const days = data.contrib.weeks.flat().filter((d) => d.d <= new Date().toISOString().slice(0, 10));
  let cur = 0;
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.c > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].c > 0) cur++;
    else if (i === days.length - 1) continue; // today may not have happened yet
    else break;
  }
  const busiest = days.reduce((m, d) => (d.c > m.c ? d : m), { c: 0, d: '' });
  const tiles = [
    [data.contrib.total, 'contributions'],
    [data.contrib.commits, 'commits'],
    [data.contrib.prs, 'pull requests'],
    [data.contrib.issues, 'issues'],
    [`${cur}d`, `streak · best ${best}d`],
    [busiest.c, `busiest · ${MONTHS[+busiest.d.slice(5, 7) - 1] ?? ''} ${+busiest.d.slice(8, 10) || ''}`.trim()],
  ];
  const ul = $('#gridStats');
  for (const [n, label] of tiles) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = String(n);
    const sp = document.createElement('span');
    sp.textContent = label;
    li.append(b, sp);
    ul.append(li);
  }
}

function rotateTaglines(app) {
  const el = $('#tagline');
  let i = 0;
  el.textContent = CONFIG.taglines[0];
  if (app.reduced) return;
  setInterval(() => {
    el.classList.add('out');
    setTimeout(() => {
      i = (i + 1) % CONFIG.taglines.length;
      el.textContent = CONFIG.taglines[i];
      el.classList.remove('out');
    }, 380);
  }, 4800);
}

function cubeFallback(stage, why) {
  stage.querySelectorAll('canvas').forEach((c) => (c.hidden = true));
  stage.style.cursor = 'default';
  // the animated Chrono-Grid, cropped to the right-hand block where the cube forms
  stage.style.backgroundImage = `url(${CONFIG.assetBase}/chronogrid.svg)`;
  stage.style.backgroundSize = '280% auto';
  stage.style.backgroundPosition = '100% 50%';
  stage.style.backgroundRepeat = 'no-repeat';
  stage.style.minHeight = '260px';
  $('#cubeHud').textContent = `3D CUBE UNAVAILABLE HERE (${why}). SHOWING THE ANIMATED VERSION.`;
}

async function boot() {
  let loaded;
  try {
    loaded = await loadProfile();
  } catch (err) {
    $('#gridInfo').textContent = 'COULD NOT LOAD ACTIVITY DATA';
    console.error(err);
    return;
  }
  const app = new App(loaded.data, loaded.source);
  window.chronosphere = app;

  app.stars = new Starfield($('#stars'), app.reduced);
  rotateTaglines(app);
  fillWorkStats(app.data);
  fillStats(app.data);

  // hero pieces
  app.wordmark = new Wordmark({ canvas: $('#wordmark'), app, words: CONFIG.wordmark });
  app.grid = new ChronoGrid({ canvas: $('#grid'), tip: $('#gridTip'), app });
  buildChips(app);
  app.updateChips();
  const renderTm = buildTimeMachine(app);

  try {
    app.cube = new CubeStage({ stage: $('#cubeStage'), glCanvas: $('#cube'), floor: $('#floor'), fx: $('#fx'), hudEl: $('#cubeHud'), infoEl: $('#cubeInfo'), app });
  } catch (err) {
    console.warn('cube disabled:', err);
    cubeFallback($('#cubeStage'), err.message);
  }

  app.bay = new InstrumentBay($('#instGrid'), app);

  // deep links: ?zone=tokyo  ?mode=activity  ?still (no motion)
  const zoneParam = app.params.get('zone');
  if (zoneParam && app.zones.byId[zoneParam]) app.selectZone(app.zones.byId[zoneParam], true);
  else if (app.params.get('mode') === 'activity') app.setMode('activity');

  // only animate what is on screen
  const vis = { grid: true, cube: true };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) vis[e.target.dataset.watch] = e.isIntersecting;
    },
    { rootMargin: '80px' },
  );
  for (const [sel, key] of [['.grid-panel', 'grid'], ['.cube-panel', 'cube']]) {
    const el = $(sel);
    el.dataset.watch = key;
    io.observe(el);
  }
  new ResizeObserver(() => {
    app.grid.resize();
    app.wordmark.resize();
  }).observe($('.hero'));

  const text = {};
  const setText = (id, value, html = false) => {
    if (text[id] === value) return;
    text[id] = value;
    $(`#${id}`)[html ? 'innerHTML' : 'textContent'] = value;
  };

  let last = performance.now();
  let slow = 0;
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    app.stars?.frame?.(dt);
    app.wordmark.frame(dt);
    if (vis.grid) {
      app.grid.update(dt);
      app.grid.draw();
      const L = app.grid.labels();
      setText('gridInfo', L.info);
      setText('gridClock', L.clock);
      setText('gridScore', L.score ? `<b class="past">PAST ${L.score[0]}</b> : <b class="future">${L.score[1]} FUTURE</b>` : '', true);
      const v = app.grid.view;
      setText(
        'gridHint',
        !v.clock
          ? 'CLICK THE GRAPH FOR YOUR TIME'
          : v.cube && app.grid.playAlpha > 0.5
            ? 'DRAG THE CUBE · MOVE OVER THE COURT TO TAKE A PADDLE'
            : v.cube
              ? 'DRAG THE CUBE TO ORBIT IT'
              : app.grid.playAlpha > 0.5
                ? 'MOVE OVER THE COURT TO TAKE A PADDLE'
                : v.zone === app.zones.you
                  ? 'CLICK TO RETURN TO ACTIVITY'
                  : 'CLICK FOR YOUR TIME',
      );
    }
    if (app.cube && vis.cube) {
      app.cube.visible = true;
      app.cube.frame(dt);
    }
    app.bay.frame(dt);
    slow += dt;
    if (slow > 0.25) {
      slow = 0;
      renderTm();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
