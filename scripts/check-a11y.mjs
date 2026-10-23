#!/usr/bin/env node
// Memeriksa aksesibilitas dasar JSX di apps/desktop/src/**/*.tsx (nama tombol, label input, alt,
// peran ARIA, elemen klik non-native). Pengecualian: komentar `// a11y-ignore: alasan` pada baris
// sebelumnya (atau `{/* a11y-ignore: alasan */}`).
// Juga memeriksa kontras WCAG token di design/system/tokens.css (terang & gelap).
// Pemakaian: node scripts/check-a11y.mjs [--src <dir>] [--tokens <tokens.css>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(join(root, "apps/desktop/package.json"))("typescript");
const argIdx = process.argv.indexOf("--src");
const srcDir = argIdx > 0 ? resolve(process.cwd(), process.argv[argIdx + 1]) : join(root, "apps/desktop/src");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(srcDir).filter(
  (f) => f.endsWith(".tsx") && !f.endsWith("bindings.ts") && !f.endsWith(".d.ts")
);

const problems = [];
const ignores = [];

const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
const opening = (n) => (ts.isJsxElement(n) ? n.openingElement : n);
const childrenOf = (n) => (ts.isJsxElement(n) ? n.children : ts.isJsxFragment(n) ? n.children : []);

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split("\n");
  const rel = relative(root, file);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;

  const attrMap = (el) => {
    const map = new Map();
    let spread = false;
    for (const a of el.attributes.properties) {
      if (ts.isJsxSpreadAttribute(a)) spread = true;
      else map.set(a.name.getText(sf), a);
    }
    return { map, spread };
  };
  // Nilai string statis atau teks ekspresi (untuk perbandingan id/htmlFor).
  const attrText = (a) => {
    const init = a?.initializer;
    if (!init) return null;
    if (ts.isStringLiteral(init)) return `"${init.text}"`;
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return `"${e.text}"`;
      return e.getText(sf);
    }
    return null;
  };
  const attrString = (a) => {
    const t = attrText(a);
    return t && t.startsWith('"') ? t.slice(1, -1) : null;
  };
  const attrNumber = (a) => {
    const e = a?.initializer;
    if (e && ts.isJsxExpression(e) && e.expression) {
      const x = e.expression;
      if (ts.isNumericLiteral(x)) return Number(x.text);
      if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(x.operand))
        return -Number(x.operand.text);
    }
    return null;
  };

  const tagName = (n) => opening(n).tagName.getText(sf);

  // Kumpulkan htmlFor dari semua <label>.
  const labelFors = new Set();
  const collect = (n) => {
    if (isJsx(n) && tagName(n) === "label") {
      const t = attrText(attrMap(opening(n)).map.get("htmlFor"));
      if (t) labelFors.add(t);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const isIgnorable = (n) => {
    const l = lineOf(n);
    const prev = lines[l - 1] ?? "";
    const m = prev.match(/a11y-ignore:\s*(.*?)(\*\/\}?)?\s*$/);
    if (m) {
      ignores.push(`${rel}:${l + 1} ${m[1].trim()}`);
      return true;
    }
    return false;
  };

  const isSpinnerOnly = (el) => {
    const c = attrMap(el).map.get("className");
    return attrString(c)?.trim() === "qr-spin";
  };

  const hasName = (n) => {
    if (isJsx(n)) {
      const el = opening(n);
      const { map } = attrMap(el);
      if (map.has("aria-label") || map.has("aria-labelledby")) return true;
    }
    for (const c of childrenOf(n)) {
      if (ts.isJsxText(c)) {
        if (c.text.trim() !== "") return true;
      } else if (ts.isJsxExpression(c)) {
        if (c.expression) return true;
      } else if (ts.isJsxFragment(c)) {
        if (hasName(c)) return true;
      } else if (isJsx(c)) {
        const tn = tagName(c);
        if (tn === "Icon" || tn === "svg" || isSpinnerOnly(opening(c))) continue;
        if (hasName(c)) return true;
      }
    }
    return false;
  };

  const hasLabelAncestor = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxElement(p) && tagName(p) === "label") return true;
    }
    return false;
  };

  const check = (n) => {
    if (!isJsx(n)) return;
    const el = opening(n);
    const tn = tagName(n);
    if (/^[A-Z]/.test(tn) || tn.includes(".")) return;
    const { map, spread } = attrMap(el);
    const errs = [];
    const has = (name) => map.has(name);
    const named = has("aria-label") || has("aria-labelledby");
    const role = attrString(map.get("role"));
    const hasHref = has("href");
    const tabIdx = attrNumber(map.get("tabIndex"));

    if (tn === "button" && !hasName(n)) errs.push("<button> tanpa nama aksesibel (beri aria-label atau teks)");

    if (tn === "input" || tn === "select" || tn === "textarea") {
      const type = attrString(map.get("type"));
      if (!(tn === "input" && type === "hidden")) {
        const id = attrText(map.get("id"));
        const ok = named || (id && labelFors.has(id)) || hasLabelAncestor(n);
        if (!ok) errs.push(`<${tn}> tanpa label (aria-label, <label htmlFor> yang cocok, atau induk <label>)`);
      }
    }

    if (tn === "img") {
      if (!has("alt")) errs.push("<img> tanpa atribut alt");
      else if (attrString(map.get("alt")) === "" && !has("aria-hidden") && role !== "presentation" && role !== "none")
        errs.push('<img alt=""> harus disertai aria-hidden atau role="presentation"');
    }

    if (tn === "svg" && !has("aria-hidden") && !named) {
      const hasTitle = childrenOf(n).some((c) => isJsx(c) && tagName(c) === "title");
      if (!hasTitle) errs.push("<svg> tanpa aria-hidden, aria-label, atau <title>");
    }

    const native = ["button", "input", "select", "textarea", "summary", "label", "option"].includes(tn) ||
      (tn === "a" && hasHref);
    if (has("onClick") && !native) {
      if (!has("role")) errs.push("elemen onClick non-native tanpa role");
      if (!has("tabIndex")) errs.push("elemen onClick non-native tanpa tabIndex");
      if (!has("onKeyDown") && !has("onKeyUp")) errs.push("elemen onClick non-native tanpa onKeyDown/onKeyUp");
    }

    if (role === "dialog") {
      if (!spread && !named) errs.push('role="dialog" tanpa aria-label/aria-labelledby');
      if (!spread && !has("aria-modal")) errs.push('role="dialog" tanpa aria-modal');
    }
    if (["slider", "progressbar", "tablist", "radiogroup"].includes(role) && !named && !spread)
      errs.push(`role="${role}" tanpa aria-label/aria-labelledby`);
    if (role === "tab" && !has("aria-selected") && !spread) errs.push('role="tab" tanpa aria-selected');
    if (role === "radio" && !has("aria-checked") && !spread) errs.push('role="radio" tanpa aria-checked');
    if (tabIdx !== null && tabIdx > 0) errs.push("tabIndex > 0 tidak diperbolehkan");
    if (has("autoFocus")) errs.push("autoFocus tidak diperbolehkan (gunakan data-autofocus + Sheet)");

    if (has("aria-hidden") && attrString(map.get("aria-hidden")) !== "false") {
      const focusable =
        ["button", "input", "select", "textarea"].includes(tn) || (tn === "a" && hasHref) || (tabIdx !== null && tabIdx >= 0);
      if (focusable) errs.push("aria-hidden pada elemen yang dapat difokus");
    }

    if (errs.length > 0 && !isIgnorable(n)) {
      for (const e of errs) problems.push(`${rel}:${lineOf(n) + 1} ${e}`);
    }
  };

  const visit = (n) => {
    check(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ---- Kontras token (WCAG 2.x) ----
const tokIdx = process.argv.indexOf("--tokens");
const tokensFile = tokIdx > 0 ? resolve(process.cwd(), process.argv[tokIdx + 1]) : join(root, "design/system/tokens.css");
const TEXT_PAIRS = [
  ["--text", "--bg-panel"], ["--text", "--bg-app"], ["--text-2", "--bg-panel"], ["--text-3", "--bg-panel"],
  ["--text-3", "--bg-sunken"], ["--text-2", "--bg-sunken"], ["--text", "--accent-subtle"], ["--accent", "--bg-panel"],
  ["--accent", "--accent-subtle"], ["--warning", "--bg-panel"], ["--danger", "--bg-panel"], ["--success", "--bg-panel"],
  ["--on-accent", "--accent"],
  // --text-3 di atas --bg-hover (terang) = 4,4983:1: ditangani di index.css (meta item memakai --text-2 saat hover).
];
const NON_TEXT_PAIRS = [["--focus", "--bg-panel"], ["--border-control", "--bg-panel"]];

// Ambil deklarasi `--x: v;` dari aturan tingkat atas (lewati at-rule seperti @media).
const parseTokens = (css) => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const light = new Map();
  const dark = new Map();
  let depth = 0;
  let selStart = 0;
  let selector = "";
  let bodyStart = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") {
      if (depth === 0) {
        selector = clean.slice(selStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        if (!selector.startsWith("@")) {
          const target = /data-theme="dark"|\.t-dark/.test(selector) ? dark : light;
          const body = clean.slice(bodyStart, i);
          for (const m of body.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi)) {
            const line = clean.slice(0, bodyStart + m.index).split("\n").length;
            target.set(m[1], { value: m[2].trim(), line });
          }
        }
        selStart = i + 1;
      }
    }
  }
  return { light, dark };
};

const parseHex = (v) => {
  const m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
};
const luminance = ([r, g, b]) => {
  const f = (x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let contrastPairs = 0;
let contrastMin = Infinity;
let contrastChecked = 0;
if (!existsSync(tokensFile)) {
  problems.push(`${relative(root, tokensFile)}:1 berkas token tidak ditemukan`);
} else {
  const { light, dark } = parseTokens(readFileSync(tokensFile, "utf8"));
  const tokRel = relative(root, tokensFile);
  const themes = [["terang", light, light], ["gelap", dark, new Map([...light, ...dark])]];
  const resolve = (name, own, all, seen = new Set()) => {
    if (seen.has(name)) return null;
    seen.add(name);
    const entry = own.get(name) ?? all.get(name);
    if (!entry) return null;
    const m = entry.value.match(/^var\(\s*(--[a-z0-9_-]+)\s*(?:,[^)]*)?\)$/i);
    if (m) return resolve(m[1], all, all, seen);
    return parseHex(entry.value);
  };
  contrastPairs = TEXT_PAIRS.length + NON_TEXT_PAIRS.length;
  for (const [theme, own, all] of themes) {
    for (const [pairs, min] of [[TEXT_PAIRS, 4.5], [NON_TEXT_PAIRS, 3]]) {
      for (const [fg, bg] of pairs) {
        const a = resolve(fg, own, all);
        const b = resolve(bg, own, all);
        const line = (own.get(fg) ?? all.get(fg))?.line ?? 1;
        if (!a || !b) {
          problems.push(`${tokRel}:${line} tema ${theme}: ${fg}/${bg} tidak dapat di-resolve ke warna hex`);
          continue;
        }
        const ratio = contrast(a, b);
        contrastChecked++;
        contrastMin = Math.min(contrastMin, ratio);
        if (ratio < min) {
          problems.push(`${tokRel}:${line} kontras tema ${theme}: ${fg} pada ${bg} = ${ratio.toFixed(4)}:1 (min ${min}:1)`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`check-a11y: ${problems.length} masalah\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(
  `check-a11y: OK (${files.length} berkas, ${ignores.length} a11y-ignore; kontras: ${contrastPairs} pasangan x 2 tema, min ${contrastMin.toFixed(2)})`
);
for (const i of ignores) console.log(`  a11y-ignore: ${i}`);
