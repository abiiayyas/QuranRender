#!/usr/bin/env node
// Memeriksa katalog i18n (apps/desktop/src/i18n/messages/<area>.{id,en}.ts) dan pemakaiannya:
// kesamaan kunci/placeholder id vs en, kunci tidak dikenal/tidak terpakai, teks UI hardcoded,
// teks Arab yang diketik di kode, dan parameter t() yang kurang.
// Pengecualian teks hardcoded: komentar `i18n-ignore: alasan` pada baris yang sama/sebelumnya.
// Pemakaian: node scripts/check-i18n.mjs [--src <dir>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(join(root, "apps/desktop/package.json"))("typescript");
const argIdx = process.argv.indexOf("--src");
const srcDir = argIdx > 0 ? join(process.cwd(), process.argv[argIdx + 1]) : join(root, "apps/desktop/src");
const i18nDir = join(srcDir, "i18n");
const messagesDir = join(i18nDir, "messages");

const KEY_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LETTER_RE = /\p{L}/u;
const TEXT_ATTRS = new Set(["aria-label", "aria-description", "aria-valuetext", "aria-roledescription", "title", "alt", "placeholder", "label"]);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (f) => relative(root, f);
const problems = [];
const parse = (file, text) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const isStr = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const placeholders = (s) => new Set([...s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]));
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// ---- Katalog ----
// areas: Map<area, {id?: Map<key,{value,line}>, en?: ...}>
const areas = new Map();
const firstObject = (sf) => {
  let found = null;
  const v = (n) => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && n.initializer) {
      let e = n.initializer;
      while (ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isObjectLiteralExpression(e)) {
        found = e;
        return;
      }
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return found;
};

if (existsSync(messagesDir)) {
  for (const name of readdirSync(messagesDir)) {
    const m = name.match(/^(.+)\.(id|en)\.ts$/);
    if (!m) continue;
    const [, area, lang] = m;
    const file = join(messagesDir, name);
    const sf = parse(file, readFileSync(file, "utf8"));
    const obj = firstObject(sf);
    const entries = new Map();
    if (!obj) {
      problems.push(`${rel(file)}:1 tidak ada object literal katalog`);
    } else {
      for (const p of obj.properties) {
        const line = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
        if (!ts.isPropertyAssignment(p) || !(ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))) {
          problems.push(`${rel(file)}:${line} entri katalog harus berbentuk "kunci": "teks"`);
          continue;
        }
        const key = p.name.text;
        if (!isStr(p.initializer)) {
          problems.push(`${rel(file)}:${line} nilai ${key} harus string literal`);
          continue;
        }
        const value = p.initializer.text;
        if (!KEY_RE.test(key)) problems.push(`${rel(file)}:${line} format kunci tidak valid: ${key}`);
        if (value.trim() === "") problems.push(`${rel(file)}:${line} nilai kosong: ${key}`);
        if (entries.has(key)) problems.push(`${rel(file)}:${line} kunci ganda: ${key}`);
        entries.set(key, { value, line });
      }
    }
    if (!areas.has(area)) areas.set(area, {});
    areas.get(area)[lang] = { file, entries };
  }
}
if (areas.size === 0) problems.push(`${rel(messagesDir)}:1 tidak ada katalog <area>.id.ts / <area>.en.ts`);

const keyInfo = new Map(); // key -> {area, line, file, ph}
for (const [area, { id, en }] of areas) {
  if (!id || !en) {
    const have = id ?? en;
    problems.push(`${rel(have.file)}:1 area "${area}" tidak punya berkas pasangan (${id ? "en" : "id"})`);
    continue;
  }
  for (const [key, { line, value }] of id.entries) {
    if (!en.entries.has(key)) problems.push(`${rel(en.file)}:1 kunci hilang (ada di id): ${key}`);
    else if (!same(placeholders(value), placeholders(en.entries.get(key).value)))
      problems.push(`${rel(en.file)}:${en.entries.get(key).line} placeholder berbeda dari id: ${key}`);
    if (keyInfo.has(key)) {
      const o = keyInfo.get(key);
      problems.push(`${rel(id.file)}:${line} kunci sudah didefinisikan di area ${o.area}: ${key}`);
    } else keyInfo.set(key, { area, line, file: id.file, ph: placeholders(value) });
  }
  for (const [key, { line }] of en.entries) {
    if (!id.entries.has(key)) problems.push(`${rel(en.file)}:${line} kunci berlebih (tidak ada di id): ${key}`);
  }
}

// ---- Pemakaian ----
const files = walk(srcDir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith("bindings.ts") && !f.endsWith(".d.ts"));
const used = new Set();
const areaNames = [...areas.keys()];
const shapedPrefix = (s) => KEY_RE.test(s) && areaNames.some((a) => s.startsWith(a + "."));
const templatePrefixes = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const sf = parse(file, text);
  // Hanya katalog (messages/ dan id.ts/en.ts) yang dikecualikan; i18n/index.tsx ikut dihitung sebagai pemakai.
  const inI18n = file.startsWith(messagesDir + sep) || file === join(i18nDir, "id.ts") || file === join(i18nDir, "en.ts");
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line;
  const ignored = (l) => /i18n-ignore:/.test(lines[l] ?? "") || /i18n-ignore:/.test(lines[l - 1] ?? "");
  const at = (n) => `${rel(file)}:${lineOf(n.getStart(sf)) + 1}`;

  // Teks Arab
  lines.forEach((ln, i) => {
    if (ARABIC_RE.test(ln)) problems.push(`${rel(file)}:${i + 1} teks Arab tidak boleh diketik di UI`);
  });
  if (inI18n) continue;

  const reportedUnknown = new Set();
  const visit = (n) => {
    // t("kunci", {params})
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const callee = n.expression;
      const isT = (ts.isIdentifier(callee) && callee.text === "t") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "t");
      const a0 = n.arguments[0];
      if (isT && isStr(a0)) {
        const key = a0.text;
        reportedUnknown.add(a0);
        const info = keyInfo.get(key);
        if (!info) problems.push(`${at(a0)} kunci i18n tidak dikenal: ${key}`);
        else if (info.ph.size > 0) {
          const a1 = n.arguments[1];
          if (a1 && ts.isObjectLiteralExpression(a1) && !a1.properties.some(ts.isSpreadAssignment)) {
            const names = new Set(a1.properties.map((p) => p.name?.getText(sf).replace(/^["']|["']$/g, "")));
            for (const p of info.ph) if (!names.has(p)) problems.push(`${at(a0)} parameter {${p}} tidak diberikan untuk ${key}`);
          } else if (!a1) problems.push(`${at(a0)} ${key} butuh parameter: ${[...info.ph].join(", ")}`);
        }
      }
    }
    if (isStr(n)) {
      const s = n.text;
      if (keyInfo.has(s)) used.add(s);
      else if (!reportedUnknown.has(n) && shapedPrefix(s)) problems.push(`${at(n)} kunci i18n tidak dikenal: ${s}`);
    }
    if (ts.isTemplateExpression(n)) {
      const head = n.head.text;
      if (areaNames.some((a) => head.startsWith(a + "."))) templatePrefixes.push(head);
    }

    if (file.endsWith(".tsx")) {
      const flag = (pos, what) => {
        if (!ignored(lineOf(pos))) problems.push(`${rel(file)}:${lineOf(pos) + 1} teks UI hardcoded (${what}), gunakan t()`);
      };
      if (ts.isJsxText(n)) {
        const t = n.text;
        if (LETTER_RE.test(t.trim())) flag(n.getStart(sf) + t.length - t.trimStart().length, "JsxText");
      } else if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) {
        const e = n.expression;
        if (isStr(e) && LETTER_RE.test(e.text)) flag(e.getStart(sf), "ekspresi string");
        else if (ts.isTemplateExpression(e) && [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].some((x) => LETTER_RE.test(x)))
          flag(e.getStart(sf), "template string");
      } else if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer) {
        let v = n.initializer;
        if (ts.isJsxExpression(v) && v.expression) v = v.expression;
        const bad =
          isStr(v)
            ? LETTER_RE.test(v.text)
            : ts.isTemplateExpression(v) && [v.head.text, ...v.templateSpans.map((s) => s.literal.text)].some((x) => LETTER_RE.test(x));
        if (bad) flag(n.getStart(sf), `atribut ${n.name.getText(sf)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

for (const [key, info] of keyInfo) {
  if (used.has(key)) continue;
  if (templatePrefixes.some((p) => key.startsWith(p))) continue;
  problems.push(`${rel(info.file)}:${info.line} kunci tidak terpakai: ${key}`);
}

if (problems.length > 0) {
  console.error(`check-i18n: ${problems.length} masalah\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`check-i18n: OK (${files.length} berkas, ${areas.size} area, ${keyInfo.size} kunci)`);
