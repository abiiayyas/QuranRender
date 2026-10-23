// Generator logo QuranRender (konsep final: Playhead).
// Keluaran ke ../logo: tanda, lockup, wordmark, ikon aplikasi, dan favicon.
import opentype from "opentype.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../brand/logo");
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".svg")) fs.rmSync(path.join(OUT, f));

const THEMES = {
  light: { ink: "#15171C", accent: "#4652C8", tile: "#F4F5F7", tileEdge: "#E2E4E9" },
  dark: { ink: "#E9EAEE", accent: "#8E97F2", tile: "#17191D", tileEdge: "#2A2E35" },
  "mono-ink": { ink: "#15171C", accent: "#15171C" },
  "mono-white": { ink: "#FFFFFF", accent: "#FFFFFF" },
};

// Tanda pada kisi 64×64: mangkuk huruf q dan playhead sebagai batangnya.
// Celah tipis memisahkan mangkuk dari playhead agar tetap terbaca di 16 px.
const mark = (t, id = "qr-gap") => `
  <defs>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" fill="#fff"/>
      <rect x="40.5" y="20" width="13" height="14" rx="4" fill="#000"/>
      <path d="M47 32v23" stroke="#000" stroke-width="9.5" stroke-linecap="round"/>
    </mask>
  </defs>
  <circle cx="31" cy="27" r="18" fill="none" stroke="${t.ink}" stroke-width="6.5" mask="url(#${id})"/>
  <path d="M47 33v22" stroke="${t.accent}" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M42.5 23.5a2.5 2.5 0 0 1 2.5-2.5h4a2.5 2.5 0 0 1 2.5 2.5v6l-4.5 4-4.5-4z" fill="${t.accent}"/>`;

const fontBuf = fs.readFileSync(path.join(HERE, "node_modules/@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff"));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

function wordmark(fill, x, baseline, size) {
  const tracking = -0.015 * size;
  let cursor = x;
  let d = "";
  for (const glyph of font.stringToGlyphs("QuranRender")) {
    d += glyph.getPath(cursor, baseline, size).toPathData(2);
    cursor += (glyph.advanceWidth / font.unitsPerEm) * size + tracking;
  }
  return { svg: `<path d="${d}" fill="${fill}"/>`, width: cursor - x - tracking };
}

const write = (name, body) => fs.writeFileSync(path.join(OUT, name), body.replace(/\n\s*/g, "\n").trim() + "\n");
const svg = (w, h, body, vb = `0 0 ${w} ${h}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">${body}</svg>`;

for (const [name, t] of Object.entries(THEMES)) {
  write(`playhead-mark-${name}.svg`, svg(64, 64, mark(t)));
  const wm = wordmark(t.ink, 78, 44, 34);
  const w = Math.ceil(78 + wm.width + 4);
  write(`playhead-lockup-${name}.svg`, svg(w, 64, `<g>${mark(t)}</g>${wm.svg}`));
  const only = wordmark(t.ink, 0, 34, 34);
  write(`wordmark-${name}.svg`, svg(Math.ceil(only.width + 2), 46, only.svg, `0 -2 ${Math.ceil(only.width + 2)} 46`));
}

// Ikon aplikasi 1024 px: kotak bersudut 824 px (radius 185) di tengah kanvas.
const appIcon = (t) => svg(1024, 1024, `
  <rect x="100" y="100" width="824" height="824" rx="185" fill="${t.tile}" stroke="${t.tileEdge}" stroke-width="4"/>
  <g transform="translate(232 232) scale(8.75)">${mark(t)}</g>`);
write("appicon.svg", appIcon(THEMES.dark)); // ikon resmi: ubin grafit gelap
write("appicon-light.svg", appIcon(THEMES.light)); // alternatif ubin terang

// Favicon: mengikuti tema browser.
write("favicon.svg", svg(64, 64, `
  <style>.i{stroke:#15171C}.a{stroke:#4652C8;fill:#4652C8}
  @media (prefers-color-scheme: dark){.i{stroke:#E9EAEE}.a{stroke:#8E97F2;fill:#8E97F2}}</style>
  <defs><mask id="g" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
    <rect width="64" height="64" fill="#fff"/>
    <rect x="40.5" y="20" width="13" height="14" rx="4" fill="#000"/>
    <path d="M47 32v23" stroke="#000" stroke-width="9.5" stroke-linecap="round"/></mask></defs>
  <circle class="i" cx="31" cy="27" r="18" fill="none" stroke-width="6.5" mask="url(#g)"/>
  <path class="a" d="M47 33v22" stroke-width="6.5" stroke-linecap="round" fill="none"/>
  <path class="a" d="M42.5 23.5a2.5 2.5 0 0 1 2.5-2.5h4a2.5 2.5 0 0 1 2.5 2.5v6l-4.5 4-4.5-4z" stroke="none"/>`));

console.log(fs.readdirSync(OUT).sort().join("\n"));
