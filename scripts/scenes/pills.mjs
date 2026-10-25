// Navigation pills. Links can't live inside an <img> SVG, so each pill is its own
// small image that the README wraps in an <a>.

import { PAL, FONT, num, esc, svgDoc } from './common.mjs';

const H = 36;
const ADV = 11.5 * 0.6 + 11.5 * 0.16; // monospace advance incl. letter spacing

function pill({ id, text, color, icon = false, glow = false }) {
  const textW = text.length * ADV;
  const padL = icon ? 40 : 20;
  const w = Math.ceil(padL + textW + 22);
  const tx = padL + textW / 2;
  const css = `.pulse{animation:pu 2.6s ease-in-out infinite}@keyframes pu{0%,100%{opacity:.25}50%{opacity:.85}}@media (prefers-reduced-motion: reduce){*{animation:none!important}}`;
  const defs = `<linearGradient id="pf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".16"/><stop offset="1" stop-color="${color}" stop-opacity=".04"/></linearGradient><filter id="pb" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>`;
  const body =
    (glow ? `<rect class="pulse" x="2" y="2" width="${w - 4}" height="${H - 4}" rx="${(H - 4) / 2}" fill="none" stroke="${color}" stroke-width="3" filter="url(#pb)"/>` : '') +
    `<rect x="1" y="1" width="${w - 2}" height="${H - 2}" rx="${(H - 2) / 2}" fill="#070c18"/>` +
    `<rect x="1" y="1" width="${w - 2}" height="${H - 2}" rx="${(H - 2) / 2}" fill="url(#pf)" stroke="${color}" stroke-opacity=".75"/>` +
    (icon ? `<path d="M19 ${H / 2 - 6.5}l10.5 6.5-10.5 6.5z" fill="${color}"/>` : '') +
    `<text x="${num(tx, 1)}" y="${H / 2 + 4.2}" font-family='${FONT}' font-size="11.5" font-weight="700" letter-spacing=".16em" text-anchor="middle" fill="${color === PAL.cyan ? '#e8fbff' : '#f1f5ff'}">${esc(text)}</text>`;
  return svgDoc({ w, h: H, title: text, desc: `${text} link`, defs, css, body });
}

export function renderPills() {
  return {
    files: {
      'pill-enter.svg': pill({ text: 'ENTER THE CHRONOSPHERE', color: PAL.cyan, icon: true, glow: true }),
      'pill-repos.svg': pill({ text: 'REPOSITORIES', color: PAL.mint }),
      'pill-sponsor.svg': pill({ text: 'SPONSOR', color: PAL.pink }),
      'pill-music.svg': pill({ text: 'MUSIC', color: PAL.gold }),
    },
  };
}
