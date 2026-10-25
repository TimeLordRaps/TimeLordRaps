# Chronosphere: how this profile is built

The profile has two layers that share one set of source files.

| Layer | What it is | Where it runs |
|---|---|---|
| **README art** | Script-free animated SVGs: banner, Chrono-Grid, instruments, link pills | Drawn by `scripts/build.mjs`, refreshed by a workflow, served from the `chronos` branch |
| **Chronosphere site** | The real thing: click-to-your-time, live Pong, the graph folding into a self-solving cube, a WebGL cube lab, instrument bay, time machine | Static files in `site/`, deployed to GitHub Pages |

```
profile.config.json      who, where, taglines, featured repos (read by the build)
scripts/
  build.mjs              builds every README scene into dist/
  fetch-data.mjs         GraphQL (token) or public fallback -> one small JSON document
  serve.mjs              tiny static server for local previews
  scenes/                banner, chronogrid, instruments, pills (+ cube.mjs, common.mjs)
site/
  index.html css/ js/    the live page (plain ES modules, no dependencies, no build step)
  lib/                   pure modules shared by the build and the browser:
                         font5x7, cube, cubeseq, cellcube, pong, astro, timeutil, rng
  data/profile.sample.json   fallback data that ships with the page
preview/                 local pages for eyeballing scenes (frame, sheet, readme)
docs/                    this file
test/                    node --test
.github/workflows/       chronos.yml (scenes + data), pages.yml (site)
```

## Everyday commands

```bash
npm test                          # unit tests, README/config sync, SVG safety, workflow pinning
node scripts/build.mjs --sample   # build dist/ from the bundled sample data (offline)
node scripts/build.mjs            # build dist/ from live data (GITHUB_TOKEN, GH_TOKEN or `gh auth token`)
npm run serve                     # http://localhost:4173/site/  and  /preview/readme.html
```

`CHRONOS_NOW=2026-10-24T22:20:00Z node scripts/build.mjs --sample` pins the clock, which is handy for screenshots.

Open the site through `npm run serve` (or any static host). It loads ES modules, which browsers will not run from `file://`.

## Going live (one time)

1. Merge to `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** (`pages.yml` needs Pages enabled before its first run.)
3. **Actions → chronos → Run workflow.** This creates the `chronos` branch that the README images load from. After that it refreshes itself about every ten minutes.
4. Optional: add a repository secret `CHRONOS_TOKEN` (a token that can read your profile) if you want the graph to include exactly what you see when signed in. Without it the built-in `GITHUB_TOKEN` is used and the graph matches what visitors see.

If GitHub ever pauses the schedule (public repositories with no activity for 60 days), re-enable the `chronos` workflow from the Actions tab.

GitHub caches README images for a few minutes, so a fresh build can take a little while to appear. The clock drawn into the graph is labelled with the time it was baked (`SYNC 17:50 PDT`) so that is never a surprise.

## Adding an instrument

Everything in the bay reads the same clock, so a new instrument only has to draw itself from `app.clock` and `app.focus`. Register it in `site/js/instruments.js`:

```js
defineInstrument({
  id: 'tide',
  title: 'Tide',
  accent: '#46e0ff',
  size: 'half short',                    // any of: wide narrow half tall short
  init: (app) => ({ /* state */ }),
  draw(g, w, h, state, app, dt) {
    const now = app.clock.now();         // a Date, already shifted by the time machine
    // ...draw with the 2D context g (already scaled to CSS pixels)
  },
  meta: (state, app) => 'HEADER TEXT',
  foot: (state, app) => 'FOOTER TEXT',
});
```

Anything deterministic in `site/lib/` (the cube, Pong, the pixel font, the sky maths) can also be used from `scripts/scenes/` to draw the same thing into the README.

## Deep links

`?zone=tokyo` (also `london`, `nyc`, `sydney`, `delhi`, `saopaulo`, `utc`, `home`) shows that city's time, `?mode=activity` holds the contribution graph, and `?still` turns all motion off, as does the operating system's reduced-motion setting.

## Privacy

The page has no trackers and loads nothing from third parties. The visitor's time zone is read with `Intl` in the browser and never sent anywhere; the sky dial uses a built-in table of city coordinates keyed by time zone, not geolocation. The only network request is for the profile snapshot (`chronos/data/profile.json`), falling back to the copy bundled with the site.

## Supply chain

Every action in the workflows is pinned to a full commit SHA, with the release in a trailing comment, and `npm test` fails if one is not. To upgrade, resolve the new tag to a commit (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`) and replace both the SHA and the comment.

## The cube that the graph becomes

While the clock shows, the ~120 contribution cells on the right are matched (Hungarian assignment) to the 27 camera-facing stickers of a cube and fly there; the rest are absorbed. `site/lib/cellcube.mjs` holds the geometry and morph, `site/lib/cubeseq.mjs` plans a scramble and its reversed solution. The orthographic camera makes every sticker a single affine matrix, so the README SVG animates registered `@property --ma..--mf` numbers instead of CSS `transform` interpolation (which collapses edge-on stickers). The cube, paddles and ball use only the contribution greens (`FACE_COLORS` and `GAME` in `cellcube.mjs`); the clock digits use the same greens.
