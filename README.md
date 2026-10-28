<div align="center">

<a href="https://timelordraps.github.io/TimeLordRaps/"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/banner.svg" width="830" alt="TIMELORD RAPS. Tyler Roost: independent researcher, systems architect and creative technologist. Auditable AI, formal tools, interactive media."></a>

**Independent researcher, systems architect, and creative technologist**

I build auditable AI systems, formal tools, and interactive media—turning ambitious ideas into inspectable, reproducible work.

<a href="https://timelordraps.github.io/TimeLordRaps/"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/pill-enter.svg" height="36" alt="Enter the Chronosphere"></a>&nbsp; <a href="https://github.com/TimeLordRaps?tab=repositories"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/pill-repos.svg" height="36" alt="Repositories"></a>&nbsp; <a href="https://github.com/sponsors/TimeLordRaps"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/pill-sponsor.svg" height="36" alt="Sponsor"></a>&nbsp; <a href="https://soundcloud.com/timelordraps"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/pill-music.svg" height="36" alt="Music"></a>

[Featured work](#featured-work) · [All repositories](https://github.com/TimeLordRaps?tab=repositories) · [Sponsor open work](https://github.com/sponsors/TimeLordRaps) · [Music](https://soundcloud.com/timelordraps)

<a href="https://timelordraps.github.io/TimeLordRaps/"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/chronogrid.svg" width="830" alt="Animated: my GitHub contribution graph reforms into the current time, Pong is played between PAST and FUTURE inside the glowing digits while the contributions on the right fold into a Rubik's cube that scrambles and solves itself, then everything melts back into the activity graph."></a>

<sub><b>That is my real contribution graph.</b> It melts into the time, plays Pong inside the digits, folds its right-hand side into a self-solving cube (all in contribution greens), and melts back. On the <a href="https://timelordraps.github.io/TimeLordRaps/">live page</a>, click it and it becomes <i>your</i> time.</sub>

<a href="https://timelordraps.github.io/TimeLordRaps/#instruments"><img src="https://raw.githubusercontent.com/TimeLordRaps/TimeLordRaps/chronos/instruments.svg" width="830" alt="Animated instruments: world clocks, an orrery of my most recently pushed repositories, and dials for the moon, daylight, and how far through the day, week, month and year it is."></a>

</div>

> I build things that shouldn’t exist yet. Then I make them rigorous.

## Focus

- **Auditable AI and verification:** tools that bind computational claims to evidence, checking mechanisms, provenance, and explicit limits.
- **Formal and mathematical systems:** executable research across Lean, ordinal arithmetic, logic, and the broader hyperfield ecosystem.
- **Creative technology:** AI-assisted games, music systems, creator tools, and experiments that make difficult ideas tangible.

## Featured work

| Project | What it does |
|---|---|
| [Verifier](https://github.com/TimeLordRaps/verifier) | Implements the Verifier Standard (VSTD) for portable, bounded, refutable computational evidence and provenance graphs. |
| [Lean4 Explainer](https://github.com/TimeLordRaps/lean4-explainer) | Builds navigable proofsites from Lean 4 code using an explanation layer designed for higher-order specificity. |
| [Hyperfields](https://github.com/TimeLordRaps/hyperfields) | Provides a Lean 4-checked, source-pinned map of the public hyperfield ecosystem. |
| [Hypermath](https://github.com/TimeLordRaps/hypermath) | Develops a formal universe from one primitive operation, with a Lean translation and explicit open proof obligations. |
| [Ordinatics](https://github.com/TimeLordRaps/ordinatics) | Explores exact ordinal arithmetic and bounded typed satisfaction in an ordinal-first computational framework. |

## Working principles

- Evidence before confidence.
- Reproducible artifacts before broad claims.
- Open obligations and unknowns stated plainly.
- Ambitious ideas paired with mechanisms that can be inspected, tested, and challenged.

## Support the work

I publish open research, tools, experiments, and documentation across AI, computation, mathematics, and creative systems. If that work helps you think, build, or verify something more effectively, [sponsorship helps fund more of it](https://github.com/sponsors/TimeLordRaps).

## Connect

For a project-specific question or collaboration idea, open an issue in the relevant repository with a concrete use case, counterexample, or proposal.

---

<details>
<summary><b>How an interactive thing lives inside a README</b></summary>

<br>

A profile README cannot run JavaScript, so this page is built in two layers that share one set of source files.

**1. The animated images above** are script-free SVGs (CSS and SMIL animation only), drawn by [`scripts/build.mjs`](https://github.com/TimeLordRaps/TimeLordRaps/blob/main/scripts/build.mjs) from my real GitHub data. A [scheduled workflow](https://github.com/TimeLordRaps/TimeLordRaps/blob/main/.github/workflows/chronos.yml) rebuilds them once daily and publishes them to a throwaway `chronos` branch, so `main` never fills up with history. The clock inside the graph is a snapshot labelled with the time it was taken (`SYNC 17:50 PDT`). The Pong match and the cube are deterministic simulations that replay on a loop, and the glow of each digit pixel is the activity of the day it covers.

**2. The [Chronosphere](https://timelordraps.github.io/TimeLordRaps/)** is the live version, served from GitHub Pages with no dependencies, no trackers and no build step:

- **Click the graph.** It reforms into *your* time, read from your browser's time zone. Click again and it returns to the real activity.
- **Take a paddle.** Move over the clock and you play PAST against FUTURE inside the digits.
- **Watch the cube.** It scrambles and solves itself on a shared clock, so everyone who is looking sees the same turn at the same moment. Drag to orbit, click to reshuffle.
- **Use the time machine.** Slide every instrument a day or an hour, or run time at ×3600.
- **Pick a place.** `?zone=tokyo`, `?zone=london` and friends deep-link to a city's time; `?mode=activity` holds the graph; `?still` turns motion off.

Your time zone never leaves your browser. The page respects `prefers-reduced-motion`, and every animated image has a static fallback.

Everything here runs on time, so new instruments are cheap to add: an instrument is one small object registered in [`site/js/instruments.js`](https://github.com/TimeLordRaps/TimeLordRaps/blob/main/site/js/instruments.js). Notes for tinkerers are in [`docs/CHRONOSPHERE.md`](https://github.com/TimeLordRaps/TimeLordRaps/blob/main/docs/CHRONOSPHERE.md).

</details>
