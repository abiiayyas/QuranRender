#!/usr/bin/env node
// Membangkitkan tabel pemetaan kata aligner cloud → kata dataset untuk ayat yang segmentasi katanya berbeda.
//
// Aligner cloud (HF Space hetchyy/quranic-universal-aligner) menomori kata menurut Digital Khatt v2
// (`digital_khatt_v2_script.json`, kunci "s:a:w"; kata terakhir tiap ayat adalah penanda nomor ayat "۝…" dan
// diabaikan). Dataset QuranRender (Kemenag, `build/dataset/quran.db` tabel `word`) memotong sebagian kecil
// ayat secara berbeda (mis. "لَّا شِيَةَ" vs "لَّاشِيَةَ", atau tanda waqaf "ەۙ" sebagai kata tersendiri).
// Untuk ayat yang jumlah katanya sama, pemetaannya 1:1 dan tidak dicatat. Untuk ayat lainnya, skrip ini
// menjajarkan kedua urutan kata dengan pemrograman dinamis atas kerangka huruf yang dinormalisasi
// (huruf dasar saja, tanpa alif/hamzah/harakat), lalu mencatat hanya kelompok yang bukan 1:1:
// (kata_aligner_pertama, jumlah_kata_aligner, kata_dataset_pertama, jumlah_kata_dataset), 1-based.
// Di luar kelompok, kata berpasangan 1:1 dengan selisih indeks yang terakumulasi.
//
// Pemakaian (Node ≥ 22.5, modul bawaan node:sqlite):
//   curl -L -o /tmp/digital_khatt_v2_script.json \
//     https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/resolve/main/data/digital_khatt_v2_script.json
//   node scripts/gen-cloud-aligner-word-map.mjs [/tmp/digital_khatt_v2_script.json] [build/dataset/quran.db]
// Keluaran: crates/qr-sources/src/cloud_aligner_word_map.rs (jangan disunting manual).

import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dkPath = process.argv[2] ?? "/tmp/digital_khatt_v2_script.json";
const dbPath = process.argv[3] ?? "build/dataset/quran.db";
const outPath = "crates/qr-sources/src/cloud_aligner_word_map.rs";

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

const entries = [];
for (const [k, { s, a, words }] of dataset) {
  const aw = aligner.get(k);
  if (!aw) throw new Error(`Ayat ${k} tidak ada di Digital Khatt`);
  if (!aw[aw.length - 1].startsWith("\u06dd")) throw new Error(`Ayat ${k}: kata terakhir bukan penanda ayat`);
  const aWords = aw.slice(0, -1);
  if (aWords.length === words.length) continue;
  const { groups, worst, total } = alignAyah(aWords, words);
  if (worst > 3) console.warn(`peringatan ${k}: jarak edit kelompok terburuk ${worst} (total ${total.toFixed(1)})`);
  entries.push({ s, a, ac: aWords.length, dc: words.length, groups });
}
if (dataset.size !== 6236) throw new Error(`Dataset memuat ${dataset.size} ayat, harus 6236`);

const lines = [
  "// @generated oleh scripts/gen-cloud-aligner-word-map.mjs — jangan disunting manual.",
  "//! Pemetaan kata aligner cloud (Digital Khatt v2, tanpa penanda ayat) → kata dataset, hanya untuk ayat",
  "//! yang jumlah katanya berbeda. Kelompok: (kata_aligner_pertama, jumlah, kata_dataset_pertama, jumlah),",
  "//! 1-based; kata di luar kelompok berpasangan 1:1.",
  "",
  "/// Kelompok non-1:1: (kata_aligner_pertama, jumlah, kata_dataset_pertama, jumlah).",
  "pub(crate) type WordGroup = (u16, u8, u16, u8);",
  "/// (surah, ayat, jumlah_kata_aligner, jumlah_kata_dataset, kelompok non-1:1).",
  "pub(crate) type WordMapEntry = (u16, u16, u16, u16, &'static [WordGroup]);",
  "",
  "/// Terurut menurut (surah, ayat).",
  "#[rustfmt::skip]",
  "pub(crate) static WORD_MAP: &[WordMapEntry] = &[",
];
for (const e of entries) {
  const g = e.groups.map((x) => `(${x.a}, ${x.ac}, ${x.d}, ${x.dc})`).join(", ");
  lines.push(`    (${e.s}, ${e.a}, ${e.ac}, ${e.dc}, &[${g}]),`);
}
lines.push("];", "");
writeFileSync(outPath, lines.join("\n"));
console.log(`${entries.length} ayat berbeda ditulis ke ${outPath}`);
