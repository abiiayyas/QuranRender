#!/usr/bin/env node
// Membangkitkan tabel pemetaan kata untuk ayat yang segmentasi katanya berbeda dari penomoran kanonik.
//
// Penomoran kanonik = kata Quran.com API v4 (`char_type_name === "word"`, penanda ayat diabaikan), sama
// dengan teks Uthmani/QPC yang dirender dan posisi kata timing QDC. Dua sumber lain memotong berbeda:
// - Dataset QuranRender (Kemenag, `resources/quran.db` tabel `word`), mis. "لَّا شِيَةَ" vs "لَّاشِيَةَ" atau
//   tanda waqaf "ەۙ" sebagai kata tersendiri → WORD_MAP.
// - Aligner cloud (HF Space hetchyy/quranic-universal-aligner) menomori kata menurut Digital Khatt v2
//   (`digital_khatt_v2_script.json`, kunci "s:a:w"; penanda nomor ayat "۝…" diabaikan), yang memisah
//   "بَعْدَ مَا" dan "إِلْ يَاسِينَ" di beberapa ayat → ALIGNER_MAP.
// Untuk ayat yang jumlah katanya sama, pemetaannya 1:1 dan tidak dicatat. Untuk ayat lainnya, skrip ini
// menjajarkan kedua urutan kata dengan pemrograman dinamis atas kerangka huruf yang dinormalisasi
// (huruf dasar saja, tanpa alif/hamzah/harakat), lalu mencatat hanya kelompok yang bukan 1:1:
// (kata_kanonik_pertama, jumlah_kata_kanonik, kata_sumber_pertama, jumlah_kata_sumber), 1-based.
// Di luar kelompok, kata berpasangan 1:1 dengan selisih indeks yang terakumulasi.
//
// Pemakaian (Node ≥ 22.5, modul bawaan node:sqlite; perlu internet untuk Quran.com):
//   curl -L -o /tmp/digital_khatt_v2_script.json \
//     https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/resolve/main/data/digital_khatt_v2_script.json
//   node scripts/gen-cloud-aligner-word-map.mjs [/tmp/digital_khatt_v2_script.json] [resources/quran.db]
// Keluaran: src/shared/wordMap.ts (jangan disunting manual).

import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dkPath = process.argv[2] ?? "/tmp/digital_khatt_v2_script.json";
const dbPath = process.argv[3] ?? "resources/quran.db";
const outPath = "src/shared/wordMap.ts";

/** Kerangka huruf: huruf dasar Arab, varian disatukan, alif/hamzah/ya-wau kecil dibuang. */
function skeleton(word) {
  let out = "";
  for (const ch of word) {
    const cp = ch.codePointAt(0);
    const isLetter =
      (cp >= 0x0621 && cp <= 0x064a) || (cp >= 0x066e && cp <= 0x066f) || (cp >= 0x0671 && cp <= 0x06d5);
    if (!isLetter) continue;
    switch (ch) {
      // alif dan hamzah dalam segala bentuk: ejaan rasm Utsmani vs Kemenag paling sering berbeda di sini
      case "ا": case "ٱ": case "أ": case "إ": case "آ": case "ء": case "ٲ": case "ٳ": case "ە":
        continue;
      case "ؤ": out += "و"; break;
      case "ئ": case "ى": case "ی": case "ې": out += "ي"; break;
      case "ة": out += "ه"; break;
      case "ک": out += "ك"; break;
      default: out += ch;
    }
  }
  return out;
}

function editDistance(a, b) {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

const MAX_GROUP = 3;
const EXTRA_WORD_PENALTY = 0.3;
const TIE_PENALTY = 0.01;

/** Penjajaran kelompok kata (1..3 : 1..3) dengan biaya jarak edit kerangka + penalti non-1:1. */
function alignAyah(aWords, dWords) {
  const aSk = aWords.map(skeleton);
  const dSk = dWords.map(skeleton);
  const n = aSk.length;
  const m = dSk.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (cost[i][j] === Infinity) continue;
      for (let di = 1; di <= MAX_GROUP && i + di <= n; di++) {
        for (let dj = 1; dj <= MAX_GROUP && j + dj <= m; dj++) {
          const a = aSk.slice(i, i + di).join("");
          const d = dSk.slice(j, j + dj).join("");
          // Kerangka kosong: tanda waqaf berdiri sendiri ("ەۙ") menempel ke kata sebelumnya, sedangkan
          // huruf lepas lain (alif "اَ" pada "اَ كَفَرْتُمْ") menempel ke kata sesudahnya.
          const isMark = (k) => dWords[k].includes("\u06d5");
          const leadingMark = dj > 1 && dSk[j] === "" && isMark(j) ? TIE_PENALTY : 0;
          const last = j + dj - 1;
          const trailingLoose = dj > 1 && dSk[last] === "" && !isMark(last) ? TIE_PENALTY : 0;
          const c =
            cost[i][j] +
            editDistance(a, d) +
            EXTRA_WORD_PENALTY * (di + dj - 2) +
            leadingMark +
            trailingLoose;
          if (c < cost[i + di][j + dj]) {
            cost[i + di][j + dj] = c;
            back[i + di][j + dj] = [di, dj, editDistance(a, d)];
          }
        }
      }
    }
  }
  const groups = [];
  let worst = 0;
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const [di, dj, dist] = back[i][j];
    groups.push({ a: i - di + 1, ac: di, d: j - dj + 1, dc: dj, dist });
    worst = Math.max(worst, dist);
    i -= di;
    j -= dj;
  }
  groups.reverse();
  return { groups: groups.filter((g) => g.ac !== 1 || g.dc !== 1), worst, total: cost[n][m] };
}

const dk = JSON.parse(readFileSync(dkPath, "utf8"));
const aligner = new Map();
for (const [key, v] of Object.entries(dk)) {
  const [s, a, w] = key.split(":").map(Number);
  const k = `${s}:${a}`;
  if (!aligner.has(k)) aligner.set(k, []);
  aligner.get(k)[w - 1] = v.text;
}

const canonical = new Map();
for (let s = 1; s <= 114; s++) {
  const url = `https://api.quran.com/api/v4/verses/by_chapter/${s}?words=true&word_fields=text_uthmani&per_page=300`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Quran.com ${s}: HTTP ${res.status}`);
  for (const v of (await res.json()).verses) {
    canonical.set(v.verse_key, v.words.filter((w) => w.char_type_name === "word").map((w) => w.text_uthmani));
  }
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare(
    "SELECT a.surah_id AS s, a.number AS n, w.text AS t FROM word w JOIN ayah a ON a.id = w.ayah_id ORDER BY a.id, w.idx",
  )
  .all();
const dataset = new Map();
for (const r of rows) {
  const k = `${r.s}:${r.n}`;
  if (!dataset.has(k)) dataset.set(k, { s: r.s, a: r.n, words: [] });
  dataset.get(k).words.push(r.t);
}
if (dataset.size !== 6236) throw new Error(`Dataset memuat ${dataset.size} ayat, harus 6236`);
if (canonical.size !== 6236) throw new Error(`Quran.com memuat ${canonical.size} ayat, harus 6236`);

const wordMap = [];
const alignerMap = [];
for (const [k, { s, a, words }] of dataset) {
  const cWords = canonical.get(k);
  if (!cWords) throw new Error(`Ayat ${k} tidak ada di Quran.com`);
  const aw = aligner.get(k);
  if (!aw) throw new Error(`Ayat ${k} tidak ada di Digital Khatt`);
  if (!aw[aw.length - 1].startsWith("\u06dd")) throw new Error(`Ayat ${k}: kata terakhir bukan penanda ayat`);
  for (const [out, src] of [[wordMap, words], [alignerMap, aw.slice(0, -1)]]) {
    if (cWords.length === src.length) continue;
    const { groups, worst, total } = alignAyah(cWords, src);
    if (worst > 3) console.warn(`peringatan ${k}: jarak edit kelompok terburuk ${worst} (total ${total.toFixed(1)})`);
    out.push({ s, a, ac: cWords.length, dc: src.length, groups });
  }
}

const table = (name, doc, entries) => [
  `/** ${doc} Sorted by (surah, ayah). */`,
  `export const ${name}: readonly WordMapEntry[] = [`,
  ...entries.map((e) => {
    const g = e.groups.map((x) => `[${x.a}, ${x.ac}, ${x.d}, ${x.dc}]`).join(", ");
    return `  [${e.s}, ${e.a}, ${e.ac}, ${e.dc}, [${g}]],`;
  }),
  "]",
  "",
];
const lines = [
  "// @generated by scripts/gen-cloud-aligner-word-map.mjs — do not edit by hand.",
  "// Canonical word numbering = Quran.com API v4 words (= QPC/Uthmani rendering, QDC timings), ayah-end",
  "// marker excluded. Only ayahs whose word counts differ are listed; words outside the groups pair 1:1.",
  "",
  "/** Non-1:1 group, 1-based: [canonicalFirst, canonicalCount, sourceFirst, sourceCount]. */",
  "export type WordGroup = readonly [number, number, number, number]",
  "/** [surah, ayah, canonicalCount, sourceCount, groups]. */",
  "export type WordMapEntry = readonly [number, number, number, number, readonly WordGroup[]]",
  "",
  ...table("WORD_MAP", "Kemenag dataset words (resources/quran.db `word`) → canonical.", wordMap),
  ...table("ALIGNER_MAP", "Cloud aligner words (Digital Khatt v2) → canonical.", alignerMap),
];
writeFileSync(outPath, lines.join("\n"));
console.log(`${wordMap.length} ayat dataset dan ${alignerMap.length} ayat aligner berbeda ditulis ke ${outPath}`);
