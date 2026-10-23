import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const OUT = path.resolve(HERE, "../brand/brand-board.html");
const LUCIDE = path.join(HERE, "node_modules/lucide-static/icons");

function icon(name, cls = "ic") {
  const raw = fs.readFileSync(path.join(LUCIDE, `${name}.svg`), "utf8");
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

const ICONS = [
  ["file-input", "Impor"], ["audio-waveform", "Sinkron"], ["list-checks", "Tinjau"], ["type", "Teks"],
  ["layers", "Lapisan gaya"], ["languages", "Terjemahan"], ["scissors", "Potong"], ["play", "Putar"],
  ["pause", "Jeda"], ["undo-2", "Urungkan"], ["redo-2", "Ulangi"], ["search", "Cari ayat"],
  ["clock-3", "Waktu"], ["circle-check", "Selesai"], ["triangle-alert", "Perhatian"], ["file-output", "Ekspor"],
  ["keyboard", "Pintasan"], ["settings-2", "Pengaturan"],
];


// Ayat 1:5 dari dataset Kemenag (verbatim), dipecah per spasi.
const AYAH_1_5 = ["اِيَّاكَ", "نَعْبُدُ", "وَاِيَّاكَ", "نَسْتَعِيْنُۗ"];
// Data contoh: waktu (detik) segmen ayat dan batas kata di segmen 1:5.
const SEGMENTS = [
  ["1:1", 0, 6.2], ["1:2", 6.6, 12.1], ["1:3", 12.5, 16.9], ["1:4", 17.3, 21.0],
  ["1:5", 21.4, 29.8], ["1:6", 30.2, 34.6], ["1:7", 35.0, 47.5],
];
const WORD_TIMES_1_5 = [21.4, 23.0, 24.6, 27.1, 29.8];
const TOTAL = 47.5;
const START_T = 24.3;

const sizesStrip = (theme) => `
  <span class="sizes sizes-${theme}" aria-label="Uji ukuran kecil, latar ${theme === "light" ? "terang" : "gelap"}">
    <img src="logo/playhead-mark-${theme}.svg" alt="" width="32" height="32">
    <img src="logo/playhead-mark-${theme}.svg" alt="" width="24" height="24">
    <img src="logo/playhead-mark-${theme}.svg" alt="" width="16" height="16">
  </span>`;

const logoSection = `
  <section class="concept" aria-labelledby="c-final">
    <header class="concept-head">
      <h3 id="c-final">Playhead</h3>
      <p>Mangkuk huruf q dengan playhead editor sebagai batangnya: Qur'an dan alat edit dalam satu bentuk. Celah tipis memisahkan mangkuk dari playhead supaya tetap terbaca di 16 px.</p>
      <p class="spec">Ikon aplikasi resmi memakai ubin grafit gelap. Ubin terang tersedia sebagai alternatif.</p>
    </header>
    <div class="concept-tiles">
      <figure class="tile tile-light"><img src="logo/playhead-mark-light.svg" alt="Tanda Playhead, tema terang" width="96" height="96"></figure>
      <figure class="tile tile-dark"><img src="logo/playhead-mark-dark.svg" alt="Tanda Playhead, tema gelap" width="96" height="96"></figure>
      <figure class="tile tile-light wide"><img src="logo/playhead-lockup-light.svg" alt="Logo horizontal, tema terang" height="40"></figure>
      <figure class="tile tile-dark wide"><img src="logo/playhead-lockup-dark.svg" alt="Logo horizontal, tema gelap" height="40"></figure>
      <figure class="tile dock dock-light">
        <img src="logo/appicon.svg" alt="Ikon aplikasi resmi di dock terang" width="80" height="80">
        <img src="logo/appicon-light.svg" alt="Ikon aplikasi alternatif di dock terang" width="80" height="80">
        ${sizesStrip("light")}
      </figure>
      <figure class="tile dock dock-dark">
        <img src="logo/appicon.svg" alt="Ikon aplikasi resmi di dock gelap" width="80" height="80">
        <img src="logo/appicon-light.svg" alt="Ikon aplikasi alternatif di dock gelap" width="80" height="80">
        ${sizesStrip("dark")}
      </figure>
      <figure class="tile tile-light"><img src="logo/playhead-mark-mono-ink.svg" alt="Tanda satu warna, tinta" width="72" height="72"></figure>
      <figure class="tile tile-photo"><img src="logo/playhead-mark-mono-white.svg" alt="Tanda satu warna, putih di atas foto" width="72" height="72"></figure>
      <figure class="tile tile-light wide clear">
        <span class="clear-box"><img src="logo/playhead-mark-light.svg" alt="Ruang kosong minimum di sekeliling tanda" width="64" height="64"></span>
        <figcaption>Ruang kosong minimum = lebar kepala playhead. Tanda minimum 16 px, lockup minimum 96 px.</figcaption>
      </figure>
    </div>
  </section>`;

const iconGrid = ICONS.map(([n, label]) => `<li>${icon(n)}<span>${label}</span></li>`).join("");

const pct = (t) => (t / TOTAL) * 100;

function studio(theme) {
  const marks = `<img class="lm" src="logo/playhead-mark-${theme}.svg" alt="" width="20" height="20">`;
  const segs = SEGMENTS.map(([k, a, b], i) =>
    `<div class="seg${i === 4 ? " is-selected" : ""}${i === 6 ? " needs-review" : ""}" style="left:${pct(a)}%;width:${pct(b - a)}%">${k}</div>`).join("");
  const trs = SEGMENTS.map(([, a, b], i) =>
    `<div class="seg tr" style="left:${pct(a)}%;width:${pct(b - a)}%">${i === 4 ? "Hanya kepada Engkaulah kami menyembah…" : ""}</div>`).join("");
  const thumbs = [0, 1, 2, 3, 0, 1, 2, 3].map((n) => `<img src="media/latar-subuh-thumb-${n}.webp" alt="">`).join("");
  const words = AYAH_1_5.map((w, i) => `<span class="w" data-i="${i}">${w}</span>`).join(" ");
  return `
  <div class="studio-wrap"><div class="studio t-${theme}" data-studio role="group" aria-label="Pratinjau studio, tema ${theme === "light" ? "terang" : "gelap"}, berisi data contoh">
    <div class="st-bar">
      <span class="lm-slot" aria-hidden="true">${marks}</span>
      <span class="st-title">Al-Fatihah · Qari contoh</span>
      <ol class="st-flow" aria-label="Alur kerja">
        <li class="done"><span class="n">${icon("check", "ic ic-s")}</span>Sumber</li>
        <li class="sep" aria-hidden="true">${icon("chevron-right", "ic ic-s")}</li>
        <li class="cur" aria-current="step"><span class="n">2</span>Sinkron</li>
        <li class="sep" aria-hidden="true">${icon("chevron-right", "ic ic-s")}</li>
        <li><span class="n">3</span>Tampilan</li>
        <li class="sep" aria-hidden="true">${icon("chevron-right", "ic ic-s")}</li>
        <li><span class="n">4</span>Ekspor</li>
      </ol>
      <span class="st-export">${icon("file-output")}Ekspor</span>
    </div>
    <div class="st-body">
      <aside class="st-media">
        <p class="st-h">Aset proyek</p>
        <div class="st-item is-on">${icon("audio-waveform")}<span>fatihah-studio.m4a</span><em>0:47</em></div>
        <div class="st-item">${icon("image")}<span>latar-subuh.mp4</span><em>1:12</em></div>
        <p class="st-h">Perlu ditinjau</p>
        <div class="st-item warn">${icon("triangle-alert")}<span>Ayat 1:7</span><em>62%</em></div>
        <p class="st-note">Keyakinan rendah pada batas akhir. Periksa sebelum mengekspor.</p>
      </aside>
      <div class="st-viewer">
        <div class="vw-bar">
          <span class="vw-ctl">Pas layar · 64%${icon("chevron-down", "ic ic-s")}</span>
          <span class="vw-ctl">9:16 · 1080×1920${icon("chevron-down", "ic ic-s")}</span>
          <span class="vw-ctl is-on">${icon("scan", "ic ic-s")}Area aman</span>
        </div>
        <div class="frame">
          <div class="safe" aria-hidden="true"></div>
          <p class="ayah" dir="rtl" lang="ar">${words}</p>
          <p class="tr-line">Hanya kepada Engkaulah kami menyembah dan hanya kepada Engkaulah kami mohon pertolongan.</p>
          <p class="src">Al-Fatihah · 5</p>
        </div>
        <div class="transport">
          ${icon("skip-back")}
          <button type="button" class="play" data-play aria-label="Putar segmen 1:5">${icon("play", "ic i-play")}${icon("pause", "ic i-pause")}</button>
          <span class="tc" data-tc>00:00:24:09</span><span class="tc dim">/ 00:00:47:15</span>
        </div>
      </div>
      <aside class="st-insp">
        <details open><summary>${icon("chevron-down", "ic ic-s")}Segmen 1:5</summary>
          <div class="row"><span>Mulai</span><span class="step tc">00:00:21:12</span></div>
          <div class="row"><span>Selesai</span><span class="step tc">00:00:29:24</span></div>
          <div class="row"><span>Kata</span><span>1–4 dari 4</span></div>
        </details>
        <details open><summary>${icon("chevron-down", "ic ic-s")}Teks ayat</summary>
          <div class="row"><span>Font</span><span class="field">LPMQ${icon("chevron-down", "ic ic-s")}</span></div>
          <div class="row"><span>Ukuran</span><span class="slider"><i style="--v:0.58"></i></span><span class="tc val">64</span></div>
          <div class="row"><span>Sorotan kata</span><span class="field">Terang bertahap${icon("chevron-down", "ic ic-s")}</span></div>
        </details>
        <details open><summary>${icon("chevron-down", "ic ic-s")}Asal gaya</summary>
          <div class="plies"><span class="ply">Templat</span><span class="ply">Proyek</span><span class="ply is-top">Klip</span></div>
        </details>
      </aside>
    </div>
    <div class="st-tl">
      <div class="tl-bar">
        <span class="tool is-on" title="Pilih">${icon("mouse-pointer-2")}</span>
        <span class="tool" title="Potong">${icon("scissors")}</span>
        <span class="tool is-on" title="Magnet">${icon("magnet")}</span>
        <span class="tl-zoom">${icon("zoom-out", "ic ic-s")}<span class="slider"><i style="--v:0.4"></i></span>${icon("zoom-in", "ic ic-s")}</span>
      </div>
      <div class="ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span></div>
      <div class="track"><span class="lbl">Latar<span class="th">${icon("eye", "ic ic-s")}${icon("lock", "ic ic-s")}</span></span><div class="lane film">${thumbs}</div></div>
      <div class="track"><span class="lbl">Audio<span class="th">${icon("volume-2", "ic ic-s")}${icon("lock", "ic ic-s")}</span></span><div class="lane wave" data-wave></div></div>
      <div class="track"><span class="lbl">Ayat<span class="th">${icon("eye", "ic ic-s")}${icon("lock", "ic ic-s")}</span></span><div class="lane">${segs}</div></div>
      <div class="track"><span class="lbl">Terjemahan<span class="th">${icon("eye", "ic ic-s")}</span></span><div class="lane">${trs}</div></div>
      <div class="tl-lanes" aria-hidden="true"><div class="playhead" data-playhead style="left:${pct(START_T)}%"></div></div>
    </div>
  </div></div>`;
}

const VOICE = [
  ["Sinkron selesai", "Ayat sudah tersinkron. Silakan periksa 3 bagian yang ditandai.", "Sukses!!! Semua beres 🎉"],
  ["Ekspor ditolak (kebijakan teks)", "Ekspor belum bisa dilanjutkan: segmen 2:255 memotong sebuah kata. Geser batas segmen ke batas kata terdekat.", "Error: invalid word range"],
  ["Glyph tidak lengkap", "Font Amiri belum memiliki salah satu tanda waqaf yang dipakai di 554 ayat. Gunakan LPMQ untuk teks ayat.", "Font tidak didukung."],
  ["Beranda kosong", "Belum ada proyek. Mulai dengan menyeret file tilawah ke jendela ini.", "Nothing here."],
  ["Konfirmasi hapus", "Hapus proyek “Tarawih Malam 3”? File media di komputer Anda tidak ikut terhapus.", "Yakin? Tindakan ini tidak bisa dibatalkan!!"],
  ["Unduh terjemahan", "Saheeh International diunduh dari Quran.com dan disimpan di komputer ini. Atribusinya otomatis masuk ke paket unggah.", "Downloading resource 20…"],
];
const voiceRows = VOICE.map(([c, y, n]) =>
  `<tr><th scope="row" data-l="Konteks">${c}</th><td data-l="Kita menulis">${y}</td><td class="no" data-l="Kita hindari"><span class="x">${n}</span></td></tr>`).join("");

const TOKENS = [
  ["--bg-app", "Latar aplikasi"], ["--bg-panel", "Panel"], ["--bg-sunken", "Area cekung (timeline, input)"],
  ["--bg-hover", "Hover baris/tombol"], ["--border", "Garis panel"], ["--border-strong", "Garis pemisah tegas (dekoratif)"],
  ["--border-control", "Batas kontrol: input, checkbox, segmen (≥ 3 : 1)"],
  ["--text", "Teks utama"], ["--text-2", "Teks sekunder"], ["--text-3", "Teks redup, label"],
  ["--accent", "Seleksi, playhead, fokus, aksi utama"], ["--accent-subtle", "Latar seleksi"],
  ["--success", "Status selesai"], ["--warning", "Perlu ditinjau"], ["--danger", "Ditolak, error"],
];
const tokenRows = TOKENS.map(([t, u]) => `<tr data-token="${t}"><th scope="row"><code>${t}</code></th>
  <td data-l="Terang"><span class="sw t-light" style="background:var(${t})"></span><code class="hex" data-theme-of="light"></code></td>
  <td data-l="Gelap"><span class="sw t-dark" style="background:var(${t})"></span><code class="hex" data-theme-of="dark"></code></td>
  <td data-l="Dipakai untuk">${u}</td></tr>`).join("");

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google" content="notranslate">
<title>QuranRender: Identitas Visual</title>
<link rel="icon" href="logo/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../system/tokens.css">
<link rel="stylesheet" href="brand-board.css">
</head>
<body>
<header class="top">
  <span class="brand">
    <img class="only-light" src="logo/playhead-lockup-light.svg" alt="QuranRender" height="32">
    <img class="only-dark" src="logo/playhead-lockup-dark.svg" alt="QuranRender" height="32">
  </span>
  <div class="top-meta">
    <h1>Identitas visual</h1>
    <p>Tahap 1 selesai: logo Playhead, warna, tipografi, ikon, dan suara.</p>
  </div>
  <div class="ctls">
    <div class="seg-ctl" role="radiogroup" aria-label="Tema">
      <button role="radio" aria-checked="true" data-set-theme="system">Sistem</button>
      <button role="radio" aria-checked="false" data-set-theme="light">Terang</button>
      <button role="radio" aria-checked="false" data-set-theme="dark">Gelap</button>
    </div>
  </div>
</header>

<main>
  <section class="block" aria-labelledby="h-world">
    <h2 id="h-world">Dunia visual di dalam studio</h2>
    <p class="lead">Konvensi editor video profesional dikerjakan dengan tenang: grafit dingin, garis 1 px, dan satu aksen nila yang hanya menandai seleksi, playhead, fokus, dan aksi utama. Ayat di kanvas selalu menjadi elemen paling terang. Tekan tombol putar untuk melihat sorotan berpindah dari kata ke kata. Semua isi adalah data contoh.</p>
    <div class="studios">${studio("light")}${studio("dark")}</div>
    <p class="credit">Foto latar: “Sunrise 008” oleh Wikibongmon, CC BY-SA 4.0 (Wikimedia Commons), dipotong dan diperkecil.</p>
  </section>

  <section class="block" aria-labelledby="h-logo">
    <h2 id="h-logo">Logo</h2>
    <p class="lead">Geometri murni, tanpa huruf Arab, makhluk bernyawa, atau ikonografi musik. Wordmark dibuat dari Schibsted Grotesk SemiBold yang dikonversi menjadi outline. Set ikon untuk macOS, Windows, dan Linux ada di <code>design/brand/icons/tauri/</code>.</p>
    ${logoSection}
  </section>

  <section class="block" aria-labelledby="h-color">
    <h2 id="h-color">Warna</h2>
    <p class="lead">Strategi: netral dengan satu aksen. Netralnya grafit dingin, bukan krem, dan aksennya nila. Status (selesai, tinjau, ditolak) hanya muncul ketika ada status.</p>
    <div class="table-scroll"><table class="tokens">
      <thead><tr><th>Token</th><th>Terang</th><th>Gelap</th><th>Dipakai untuk</th></tr></thead>
      <tbody>${tokenRows}</tbody>
    </table></div>
    <h3 class="sub">Kontras terukur</h3>
    <div class="table-scroll"><table class="contrast" id="contrast"><thead><tr><th>Pasangan</th><th>Terang</th><th>Gelap</th><th>Syarat</th></tr></thead><tbody></tbody></table></div>
  </section>

  <section class="block" aria-labelledby="h-type">
    <h2 id="h-type">Tipografi</h2>
    <div class="type-grid">
      <div class="type-col">
        <h3 class="sub">Font sistem untuk UI: SF Pro di macOS, Segoe UI di Windows, Inter (dibundel) di Linux</h3>
        <p class="ts ts-20">Ayat sudah tersinkron</p>
        <p class="ts ts-16">Silakan periksa bagian yang ditandai sebelum mengekspor.</p>
        <p class="ts ts-14">Segmen 1:7 · keyakinan 62% · 14 kata</p>
        <p class="ts ts-13">Label panel, isi inspector, item daftar</p>
        <p class="ts ts-12 dim">Keterangan kecil dan tooltip</p>
        <h3 class="sub">Angka tabular untuk waktu dan ukuran</h3>
        <p class="ts mono">00:00:24:08 &nbsp; 1920 × 1080 &nbsp; 30 fps</p>
      </div>
      <div class="type-col">
        <h3 class="sub">LPMQ untuk ayat (font Mushaf Standar Indonesia)</h3>
        <p class="ayah-spec" dir="rtl" lang="ar">بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ</p>
        <p class="ts ts-13 dim">Al-Fatihah · 1, teks verbatim dari dataset Kemenag</p>
        <h3 class="sub">Amiri untuk nama surah dan teks Arab non-ayat</h3>
        <p class="surah-spec" dir="rtl" lang="ar">الفاتحة · البقرة · يٰسۤ · الملك</p>
      </div>
    </div>
  </section>

  <section class="block" aria-labelledby="h-icon">
    <h2 id="h-icon">Ikon</h2>
    <p class="lead">Lucide (lisensi ISC), garis 1,5 px di kisi 24, mengikuti warna teks. Waveform hanya dipakai sebagai alat edit audio. Tidak ada not balok, equalizer, atau bentuk makhluk bernyawa.</p>
    <ul class="icons">${iconGrid}</ul>
  </section>

  <section class="block" aria-labelledby="h-voice">
    <h2 id="h-voice">Suara dan bahasa</h2>
    <p class="lead">Hangat dan sopan, dalam bahasa baku ringan. Setiap pesan menyebut apa yang terjadi dan apa langkah berikutnya.</p>
    <table class="voice">
      <thead><tr><th>Konteks</th><th>Kita menulis</th><th>Kita hindari</th></tr></thead>
      <tbody>${voiceRows}</tbody>
    </table>
  </section>
</main>
<script>window.QR_DEMO = ${JSON.stringify({ total: TOTAL, start: START_T, words: WORD_TIMES_1_5, fps: 30 })};</script>
<script src="brand-board.js"></script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log("wrote", OUT, html.length);
