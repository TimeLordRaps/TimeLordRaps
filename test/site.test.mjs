// Guards the pieces that have to agree with each other: the site config, the README, the
// generated scenes and the workflows. None of these need a network or a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG, WORLD } from '../site/js/config.js';
import { renderBanner } from '../scripts/scenes/banner.mjs';
import { renderChronogrid } from '../scripts/scenes/chronogrid.mjs';
import { renderInstruments } from '../scripts/scenes/instruments.mjs';
import { renderPills } from '../scripts/scenes/pills.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cfg = JSON.parse(read('profile.config.json'));
const sample = JSON.parse(read('site/data/profile.sample.json'));
const NOW = new Date('2026-10-24T22:20:00Z');

/** Same flattening as scripts/build.mjs: { 'banner.svg': '<svg…', … }. */
function buildAll(data = sample, now = NOW) {
  const input = { cfg, data: { ...structuredClone(data), generatedAt: now.toISOString() }, now };
  const scenes = {
    chronogrid: renderChronogrid(input),
    banner: renderBanner(input),
    instruments: renderInstruments(input),
    pills: renderPills(input),
  };
  const files = {};
  for (const [name, res] of Object.entries(scenes)) Object.assign(files, res.files ?? { [`${name}.svg`]: res.svg });
  return files;
}

const SIZE_CAP_KB = { 'banner.svg': 120, 'chronogrid.svg': 160, 'instruments.svg': 420 };
const PILL_CAP_KB = 4;

/** Returns a list of problems; empty means the SVG is safe to serve as a profile image. */
function sceneProblems(file, svg) {
  const bad = [];
  const kb = Buffer.byteLength(svg) / 1024;
  const cap = SIZE_CAP_KB[file] ?? PILL_CAP_KB;
  if (kb > cap) bad.push(`${kb.toFixed(1)} KB exceeds the ${cap} KB cap`);
  if (!/^<svg[\s>]/.test(svg) || !svg.trimEnd().endsWith('</svg>')) bad.push('not a single <svg> document');
  if (!/\brole="img"/.test(svg) || !/<title[ >]/.test(svg) || !/<desc[ >]/.test(svg)) bad.push('missing role/title/desc');
  if (!svg.includes('prefers-reduced-motion')) bad.push('no reduced-motion fallback');

  const css = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const body = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/(<style[^>]*>)[\s\S]*?(<\/style>)/g, '$1$2');
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;

  // nothing that can run code, load anything, or phone home. Text that merely *looks* like a
  // payload is inert once escaped, so these look at elements, attributes and CSS only.
  const FORBIDDEN_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'meta', 'image', 'audio', 'video']);
  for (const m of body.matchAll(tag)) {
    if (FORBIDDEN_TAGS.has(m[2].toLowerCase())) bad.push(`contains <${m[2]}>`);
    const attrs = m[3];
    if (/(?:^|\s)on[a-z]+\s*=/i.test(attrs)) bad.push(`event handler attribute on <${m[2]}>`);
    if (/javascript:/i.test(attrs)) bad.push(`javascript: URL on <${m[2]}>`);
    if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(attrs)) bad.push(`non-local href on <${m[2]}>`);
    if (/url\(\s*["']?(?!#|data:)/i.test(attrs)) bad.push(`url() that is not a local reference on <${m[2]}>`);
    if (/https?:\/\//i.test(attrs.replace(/xmlns(?::\w+)?\s*=\s*"http:\/\/www\.w3\.org\/[^"]*"/g, ''))) bad.push(`external URL on <${m[2]}>`);
  }
  if (/@import/i.test(css)) bad.push('@import in CSS');
  if (/url\(\s*["']?(?!#|data:)/i.test(css)) bad.push('url() in CSS that is not a local reference');
  if (/https?:\/\//i.test(css)) bad.push('external URL in CSS');

  // well-formed XML: balanced tags, escaped ampersands, no stray angle brackets
  const stack = [];
  for (let m; (m = tag.exec(body)); ) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (!close) stack.push(name);
    else if (stack.pop() !== name) {
      bad.push(`unbalanced </${name}>`);
      break;
    }
  }
  if (stack.length) bad.push(`unclosed <${stack.at(-1)}>`);
  if (/[<>]/.test(body.replace(tag, ''))) bad.push('stray < or > in text');
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(svg)) bad.push('unescaped &');

  // ids are unique and every local reference resolves
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) bad.push(`duplicate id "${id}"`);
    seen.add(id);
  }
  for (const m of svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) {
    const id = m[1] ?? m[2];
    if (!seen.has(id)) bad.push(`dangling reference #${id}`);
  }
  return bad;
}

test('site config mirrors profile.config.json', () => {
  assert.equal(CONFIG.login, cfg.login);
  assert.equal(CONFIG.displayName, cfg.displayName);
  assert.deepEqual(CONFIG.wordmark, cfg.wordmark);
  assert.deepEqual(CONFIG.taglines, cfg.taglines);
  assert.equal(CONFIG.assetBase, cfg.assetBase);
  assert.equal(CONFIG.accountCreated, sample.user.createdAt);
  const pick = ({ label, tz, lat, lon }) => ({ label, tz, lat, lon });
  assert.deepEqual(pick(CONFIG.home), cfg.home);
  assert.deepEqual(pick(WORLD.find((z) => z.id === 'home')), cfg.home);
});

test('config URLs point at this profile', () => {
  const login = cfg.login;
  assert.equal(new URL(cfg.siteUrl).hostname, `${login.toLowerCase()}.github.io`);
  assert.equal(cfg.assetBase, `https://raw.githubusercontent.com/${login}/${login}/chronos`);
  assert.equal(cfg.links.sponsor, `https://github.com/sponsors/${login}`);
  assert.ok(cfg.links.repos.startsWith(`https://github.com/${login}`));
});

test('README keeps the professional profile and links every featured repository', () => {
  const md = read('README.md');
  for (const heading of ['## Focus', '## Featured work', '## Working principles', '## Support the work', '## Connect']) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
  for (const name of cfg.featured) assert.ok(md.includes(`https://github.com/${cfg.login}/${name})`), `featured repo ${name} is not linked`);
  for (const line of ['Evidence before confidence.', 'Reproducible artifacts before broad claims.', 'Open obligations and unknowns stated plainly.']) {
    assert.ok(md.includes(line), line);
  }
  for (const url of Object.values(cfg.links)) assert.ok(md.includes(url), `README does not link ${url}`);
  assert.ok(md.includes(cfg.siteUrl), 'README does not link the live site');
});

test('every image the README embeds is built, hosted on the chronos branch, and has alt text', () => {
  const md = read('README.md');
  const built = Object.keys(buildAll());
  const imgs = [...md.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 7, 'banner, three scenes and four pills expected');
  for (const tagText of imgs) {
    const src = tagText.match(/\bsrc="([^"]+)"/)?.[1];
    assert.ok(src?.startsWith(`${cfg.assetBase}/`), `unexpected image source in ${tagText.slice(0, 80)}`);
    assert.ok(built.includes(src.slice(cfg.assetBase.length + 1)), `${src} is not produced by scripts/build.mjs`);
    assert.match(tagText, /\balt="[^"]+"/, `missing alt text: ${tagText.slice(0, 80)}`);
  }
  for (const file of built) assert.ok(md.includes(`/chronos/${file}`), `${file} is built but never shown`);
});

test('README, site and workflows only mention hosts we expect', () => {
  const allowed = new Set(['github.com', 'raw.githubusercontent.com', 'soundcloud.com', `${cfg.login.toLowerCase()}.github.io`, 'www.w3.org']);
  const files = ['README.md', 'site/index.html', ...fs.readdirSync(path.join(root, 'site/js')).map((f) => `site/js/${f}`), ...fs.readdirSync(path.join(root, 'site/css')).map((f) => `site/css/${f}`)];
  for (const f of files) {
    for (const m of read(f).matchAll(/https?:\/\/[^\s)"'<>`\\]+/g)) {
      assert.ok(allowed.has(new URL(m[0]).hostname), `${f} mentions ${m[0]}`);
    }
  }
});

test('the site loads nothing from outside and never sends the time zone anywhere', () => {
  const html = read('site/index.html');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href="https?:/i);
  const fetchers = [];
  for (const f of fs.readdirSync(path.join(root, 'site/js'))) {
    const code = read(`site/js/${f}`);
    assert.doesNotMatch(code, /navigator\.sendBeacon|new\s+WebSocket|XMLHttpRequest|geolocation/, `${f} talks to the network or location`);
    if (/\bfetch\s*\(/.test(code)) fetchers.push(f);
  }
  // one place may fetch, and it only reads the published snapshot or the copy shipped with the site
  assert.deepEqual(fetchers, ['data.js']);
  assert.match(
    read('site/js/data.js'),
    /const SOURCES = \(\) => \[`\$\{CONFIG\.assetBase\}\/data\/profile\.json`, new URL\('\.\.\/data\/profile\.sample\.json', import\.meta\.url\)\.href\];/,
  );
});

test('scenes are script-free, self-contained, well-formed and small', () => {
  const files = buildAll();
  assert.deepEqual(Object.keys(files).sort(), ['banner.svg', 'chronogrid.svg', 'instruments.svg', 'pill-enter.svg', 'pill-music.svg', 'pill-repos.svg', 'pill-sponsor.svg']);
  for (const [file, svg] of Object.entries(files)) {
    assert.deepEqual(sceneProblems(file, svg), [], file);
  }
});

test('hostile repository metadata cannot break out of the scenes', () => {
  const evil = structuredClone(sample);
  const payloads = [
    '<script>alert(1)</script>',
    '"><svg onload=alert(1)>',
    'a & b < c > d "q" \'s\'',
    '</text></svg><script>x</script>',
    'javascript:alert(1)',
    '&#x3c;script&#x3e;',
  ];
  evil.repos.forEach((r, i) => {
    const p = payloads[i % payloads.length];
    r.name = `${p}${r.name}`; // payload first: labels are truncated, so the tail may never be drawn
    r.description = p;
    r.lang = p;
    r.url = `https://github.com/x/${p}`;
  });
  evil.user.name = payloads[0];
  evil.user.location = payloads[1];
  const files = buildAll(evil);
  for (const [file, svg] of Object.entries(files)) {
    assert.deepEqual(sceneProblems(file, svg), [], `${file} with hostile input`);
    assert.ok(!svg.includes('<script>alert'), `${file} leaked a payload`);
  }
  // the payload must actually reach a scene (escaped), otherwise this test proves nothing
  assert.ok(Object.values(files).some((svg) => svg.includes('&lt;script&gt;')), 'hostile names never reached a scene');
});

test('scenes are deterministic for a given instant and move with the clock', () => {
  const a = buildAll();
  const b = buildAll();
  assert.deepEqual(a, b);
  const later = buildAll(sample, new Date(NOW.getTime() + 60_000));
  assert.notEqual(a['chronogrid.svg'], later['chronogrid.svg'], 'the baked clock should change with the minute');
});

test('workflows pin every action to a commit and run with least privilege', () => {
  const dir = path.join(root, '.github/workflows');
  const flows = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(flows.includes('chronos.yml') && flows.includes('pages.yml'));
  for (const f of flows) {
    const yml = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(yml, /\t/, `${f} contains tabs`);
    assert.match(yml, /^permissions:/m, `${f} has no top-level permissions`);
    assert.match(yml, /^concurrency:/m, `${f} has no concurrency group`);
    const uses = [...yml.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${f} uses no actions?`);
    for (const u of uses) assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${u} is not pinned to a commit SHA`);
  }
  const chronos = fs.readFileSync(path.join(dir, 'chronos.yml'), 'utf8');
  assert.match(chronos, /contents:\s*write/, 'chronos must be able to push its branch');
  assert.doesNotMatch(chronos, /pull_request_target/, 'never run this workflow on untrusted PR code');
});
