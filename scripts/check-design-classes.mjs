#!/usr/bin/env node
// Memeriksa bahwa semua kelas `qr-*` dan `var(--token)` di src/renderer/src dan src/remotion terdefinisi di
// design/system/{tokens,components}.css atau src/renderer/src/styles.css.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src/renderer/src");
const definitionFiles = [
  join(root, "design/system/tokens.css"),
  join(root, "design/system/components.css"),
  join(srcDir, "styles.css"),
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const definedClasses = new Set();
const definedVars = new Set();
for (const f of definitionFiles) {
  const css = stripCssComments(readFileSync(f, "utf8"));
  for (const m of css.matchAll(/\.(qr-[a-z0-9_-]+)/g)) definedClasses.add(m[1]);
  for (const m of css.matchAll(/(--[a-z0-9_-]+)\s*:/g)) definedVars.add(m[1]);
}

const files = walk(srcDir).filter(
  (f) => /\.(tsx|ts|css)$/.test(f) && !f.endsWith("bindings.ts") && !f.endsWith(".d.ts")
);

const problems = [];
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const text = f.endsWith(".css") ? stripCssComments(raw) : raw;
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/qr-[a-z0-9_-]+/g)) {
      if (!definedClasses.has(m[0])) {
        problems.push(`${relative(root, f)}:${i + 1} kelas tidak terdefinisi: ${m[0]}`);
      }
    }
    for (const m of line.matchAll(/var\(\s*(--[a-z0-9_-]+)/g)) {
      if (!definedVars.has(m[1])) {
        problems.push(`${relative(root, f)}:${i + 1} variabel CSS tidak terdefinisi: ${m[1]}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`check-design-classes: ${problems.length} masalah\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(
  `check-design-classes: OK (${files.length} berkas, ${definedClasses.size} kelas, ${definedVars.size} token)`
);
