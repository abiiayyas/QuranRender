// Menyusun design/prototype/index.html: menyuntikkan sprite ikon Lucide untuk setiap ikon yang disebut di app.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(HERE, "../prototype");
const LUCIDE = path.join(HERE, "node_modules/lucide-static/icons");
const available = new Set(fs.readdirSync(LUCIDE).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));

const js = fs.readFileSync(path.join(PROTO, "app.js"), "utf8");
const used = new Set();
for (const m of js.matchAll(/["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)["'`]/g)) if (available.has(m[1])) used.add(m[1]);
// Ikon yang dipanggil lewat ic("nama") wajib ada.
const missing = [...js.matchAll(/\bic\(\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1]).filter((n) => !available.has(n));
if (missing.length) { console.error("Ikon tidak ditemukan:", [...new Set(missing)].join(", ")); process.exit(1); }

const symbols = [...used].sort().map((n) => {
  const raw = fs.readFileSync(path.join(LUCIDE, `${n}.svg`), "utf8");
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/\s*\n\s*/g, "").trim();
  return `<symbol id="i-${n}" viewBox="0 0 24 24">${inner}</symbol>`;
}).join("");
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`;
const html = fs.readFileSync(path.join(PROTO, "index.src.html"), "utf8").replace("<!--SPRITE-->", sprite);
fs.writeFileSync(path.join(PROTO, "index.html"), html);
console.log("index.html:", html.length, "bytes,", used.size, "ikon");
