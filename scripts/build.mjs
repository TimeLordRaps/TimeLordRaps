// Builds every README scene into dist/ (published to the `chronos` branch by the workflow).
//   node scripts/build.mjs              live data, current time
//   node scripts/build.mjs --sample     offline: site/data/profile.sample.json
//   CHRONOS_NOW=2026-10-24T22:20:00Z    pin the clock (useful for screenshots and tests)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchProfileData } from './fetch-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const out = path.join(root, 'dist');

const cfg = JSON.parse(await fs.readFile(path.join(root, 'profile.config.json'), 'utf8'));
const now = process.env.CHRONOS_NOW ? new Date(process.env.CHRONOS_NOW) : new Date();

let data;
if (args.has('--sample')) {
  data = JSON.parse(await fs.readFile(path.join(root, 'site/data/profile.sample.json'), 'utf8'));
} else {
  try {
    data = await fetchProfileData(cfg.login);
  } catch (e) {
    const cache = process.env.CHRONOS_CACHE;
    if (!cache) throw e;
    console.warn(`live fetch failed (${e.message}); falling back to ${cache}`);
    data = JSON.parse(await fs.readFile(cache, 'utf8'));
  }
}
data.generatedAt = now.toISOString();

const scenes = {};
const add = async (name, mod, fn) => {
  const m = await import(mod);
  scenes[name] = m[fn]({ cfg, data, now });
};

const wanted = [
  ['chronogrid', './scenes/chronogrid.mjs', 'renderChronogrid'],
  ['banner', './scenes/banner.mjs', 'renderBanner'],
  ['instruments', './scenes/instruments.mjs', 'renderInstruments'],
  ['pills', './scenes/pills.mjs', 'renderPills'],
];
for (const [name, mod, fn] of wanted) {
  try {
    await add(name, mod, fn);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(path.basename(mod))) {
      console.warn(`skip ${name}: not written yet`);
      continue;
    }
    throw e;
  }
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'data'), { recursive: true });
const report = {};
for (const [name, res] of Object.entries(scenes)) {
  const files = res.files ?? { [`${name}.svg`]: res.svg };
  for (const [file, svg] of Object.entries(files)) {
    await fs.writeFile(path.join(out, file), svg);
    report[file] = `${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`;
  }
}
await fs.writeFile(path.join(out, 'data', 'profile.json'), JSON.stringify(data));
await fs.writeFile(
  path.join(out, 'data', 'meta.json'),
  JSON.stringify({ generatedAt: now.toISOString(), source: data.source ?? 'sample', scenes: Object.fromEntries(Object.entries(scenes).map(([k, v]) => [k, v.meta ?? null])) }, null, 2),
);
console.table(report);
console.log(`built at ${now.toISOString()} from ${data.source ?? 'sample'} data`);
