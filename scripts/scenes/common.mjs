// Shared palette + SVG helpers for the README scenes.
// Everything here must survive GitHub's image sandbox: no scripts, no external
// resources, system fonts only. Motion is CSS keyframes / SMIL, nothing else.

export const FONT = 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace';

export const PAL = {
  bg0: '#050810',
  bg1: '#0a1120',
  bg2: '#111c33',
  line: '#1c2a47',
  ink: '#dbe7ff',
  dim: '#7d8fb0',
  faint: '#46567a',
  cyan: '#46e0ff',
  mint: '#4ff0b4',
  gold: '#ffc857',
  violet: '#a287ff',
  pink: '#ff5f9e',
  orange: '#ff9f45',
};

/** Activity ramp (contribution levels 0..4) and the "clock" ramp the same days morph into. */
export const ACT = ['#15223b', '#0e4f3a', '#12805a', '#26c281', '#6dffb4'];
export const CLK = ['#3596c0', '#45bde3', '#72dff0', '#bdfbf2', '#fff3c2'];
export const GLOW = [0.34, 0.46, 0.62, 0.82, 1];

export const num = (n, d = 1) => {
  const f = 10 ** d;
  return String(Math.round(n * f) / f);
};

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Wrap scene content into a complete, accessible SVG document. */
export function svgDoc({ w, h, title, desc, defs = '', css = '', body }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">` +
    `<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>` +
    `<defs>${defs}</defs><style>${css}</style>${body}</svg>`
  );
}

/** Dark rounded card with a faint scanline texture; ids are namespaced by `p`. */
export function cardDefs(p) {
  return (
    `<linearGradient id="${p}bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${PAL.bg2}"/><stop offset="0.55" stop-color="${PAL.bg1}"/><stop offset="1" stop-color="${PAL.bg0}"/></linearGradient>` +
    `<pattern id="${p}scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#fff" opacity="0.028"/></pattern>`
  );
}

export function card(p, x, y, w, h, r = 14) {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${p}bg)"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${p}scan)"/>` +
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" fill="none" stroke="${PAL.line}"/>`
  );
}

/** Small uppercase mono label. */
export function label(x, y, text, { size = 10, fill = PAL.dim, anchor = 'start', spacing = 0.16, weight = 600, cls = '' } = {}) {
  return (
    `<text x="${num(x, 1)}" y="${num(y, 1)}" font-family='${FONT}' font-size="${size}" font-weight="${weight}" ` +
    `letter-spacing="${spacing}em" text-anchor="${anchor}" fill="${fill}"${cls ? ` class="${cls}"` : ''}>${esc(text)}</text>`
  );
}

/** Tiny clock glyph used as the section mark. */
export function clockMark(cx, cy, r, color = PAL.cyan) {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="1.4"/>` +
    `<path d="M${cx} ${cy - r * 0.6}V${cy}L${cx + r * 0.5} ${cy + r * 0.3}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

export const ago = (iso, now) => {
  const s = Math.max(0, (now - new Date(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}M`;
  if (s < 86400) return `${Math.round(s / 3600)}H`;
  return `${Math.round(s / 86400)}D`;
};
