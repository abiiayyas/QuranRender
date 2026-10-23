// Generator galeri komponen QuranRender (tahap 2). Keluaran: ../system/gallery.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../system/gallery.html");
const LUCIDE = path.join(HERE, "node_modules/lucide-static/icons");

const I = (name, cls = "qr-ic") => {
  const raw = fs.readFileSync(path.join(LUCIDE, `${name}.svg`), "utf8");
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
};
const WAVE = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  let bars = "";
  for (let i = 0; i < 120; i++) bars += `<i style="height:${Math.max(10, Math.round((0.35 + 0.65 * Math.abs(Math.sin(i / 9))) * (0.45 + 0.55 * rnd()) * 100))}%"></i>`;
  return `<span class="qr-wave" aria-hidden="true">${bars}</span>`;
})();
const cap = (label, inner, extra = "") => `<figure class="sp ${extra}"><div class="sp__body">${inner}</div><figcaption>${label}</figcaption></figure>`;
const row = (...items) => `<div class="sp-row">${items.join("")}</div>`;

// Setiap komponen: id, judul, keterangan, aturan, dan fungsi spesimen (dipanggil sekali per tema).
const COMPONENTS = [
  {
    id: "tombol", title: "Tombol",
    desc: "Empat varian. Primer (nila) hanya untuk satu aksi utama per layar, yaitu Ekspor. Sekunder untuk aksi biasa, hantu untuk aksi di bilah alat, bahaya untuk aksi yang menghapus. Tinggi 24/28/32 px; 28 px adalah default di studio.",
    spec: () => [
      row(
        cap("Primer", `<button class="qr-btn qr-btn--primary">${I("file-output")}Ekspor</button>`),
        cap("Hover", `<button class="qr-btn qr-btn--primary is-hover">${I("file-output")}Ekspor</button>`),
        cap("Tekan", `<button class="qr-btn qr-btn--primary is-active">${I("file-output")}Ekspor</button>`),
        cap("Fokus", `<button class="qr-btn qr-btn--primary is-focus">${I("file-output")}Ekspor</button>`),
        cap("Memuat", `<button class="qr-btn qr-btn--primary is-loading" aria-busy="true"><span class="qr-spin"></span>Mengekspor…</button>`),
        cap("Nonaktif", `<button class="qr-btn qr-btn--primary" disabled>${I("file-output")}Ekspor</button>`),
      ),
      row(
        cap("Sekunder", `<button class="qr-btn qr-btn--secondary">${I("file-input")}Impor</button>`),
        cap("Hover", `<button class="qr-btn qr-btn--secondary is-hover">${I("file-input")}Impor</button>`),
        cap("Tekan", `<button class="qr-btn qr-btn--secondary is-active">${I("file-input")}Impor</button>`),
        cap("Fokus", `<button class="qr-btn qr-btn--secondary is-focus">${I("file-input")}Impor</button>`),
        cap("Nonaktif", `<button class="qr-btn qr-btn--secondary" disabled>${I("file-input")}Impor</button>`),
      ),
      row(
        cap("Hantu", `<button class="qr-btn qr-btn--ghost">${I("undo-2")}Urungkan</button>`),
        cap("Hover", `<button class="qr-btn qr-btn--ghost is-hover">${I("undo-2")}Urungkan</button>`),
        cap("Toggle aktif", `<button class="qr-btn qr-btn--ghost qr-btn--icon" aria-pressed="true" aria-label="Magnet">${I("magnet")}</button>`),
        cap("Bahaya", `<button class="qr-btn qr-btn--danger">${I("trash-2")}Hapus proyek</button>`),
        cap("Bahaya hover", `<button class="qr-btn qr-btn--danger is-hover">${I("trash-2")}Hapus proyek</button>`),
      ),
      row(
        cap("Kecil 24", `<button class="qr-btn qr-btn--secondary qr-btn--sm">Batal</button>`),
        cap("Sedang 28", `<button class="qr-btn qr-btn--secondary">Batal</button>`),
        cap("Besar 32", `<button class="qr-btn qr-btn--secondary qr-btn--lg">Batal</button>`),
        cap("Ikon 24 / 28 / 32", `<span class="inline">
          <button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Potong">${I("scissors", "qr-ic qr-ic--sm")}</button>
          <button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Potong">${I("scissors")}</button>
          <button class="qr-btn qr-btn--secondary qr-btn--icon qr-btn--lg" aria-label="Pengaturan">${I("settings-2")}</button></span>`),
      ),
    ].join(""),
  },
  {
    id: "segmen", title: "Kontrol segmen",
    desc: "Untuk memilih satu dari 2–4 pilihan yang setara, misalnya tema atau rasio. Pilihan terpilih dibuat netral (latar panel dan bayangan angkat), tidak nila, karena ini pengaturan, bukan seleksi konten.",
    spec: () => row(
      cap("Default", `<div class="qr-seg" role="radiogroup" aria-label="Tema"><button role="radio" aria-checked="true">Sistem</button><button role="radio" aria-checked="false">Terang</button><button role="radio" aria-checked="false">Gelap</button></div>`),
      cap("Hover", `<div class="qr-seg"><button aria-checked="false">9:16</button><button aria-checked="true">16:9</button><button class="is-hover" aria-checked="false">1:1</button></div>`),
      cap("Fokus & nonaktif", `<div class="qr-seg"><button aria-checked="true" class="is-focus">9:16</button><button aria-checked="false">16:9</button><button aria-checked="false" disabled>4:5</button></div>`),
    ),
  },
  {
    id: "isian", title: "Isian teks",
    desc: "Latar cekung dan batas kontrol (≥ 3 : 1). Fokus memakai cincin nila 1 px dan batas nila. Galat memakai merah sekaligus pesan yang menyebut cara memperbaiki. Label di atas isian, bantuan di bawah.",
    spec: () => [
      row(
        cap("Kosong", `<label class="qr-fieldset"><span class="qr-label">Cari ayat</span><span class="qr-field">${I("search")}<input placeholder="2:255 atau al-kahfi"></span></label>`),
        cap("Hover", `<label class="qr-fieldset"><span class="qr-label">Cari ayat</span><span class="qr-field is-hover">${I("search")}<input placeholder="2:255 atau al-kahfi"></span></label>`),
        cap("Fokus", `<label class="qr-fieldset"><span class="qr-label">Cari ayat</span><span class="qr-field is-focus">${I("search")}<input value="al-kahf"></span></label>`),
      ),
      row(
        cap("Terisi + bantuan", `<label class="qr-fieldset"><span class="qr-label">Nama proyek</span><span class="qr-field"><input value="Tarawih Malam 3"></span><span class="qr-help">Dipakai sebagai nama file ekspor.</span></label>`),
        cap("Galat", `<label class="qr-fieldset"><span class="qr-label">Mulai</span><span class="qr-field is-invalid"><input value="00:21:1" aria-invalid="true"></span><span class="qr-error">${I("circle-alert", "qr-ic qr-ic--sm")}Format waktu: jj:mm:dd:ff</span></label>`),
        cap("Nonaktif", `<label class="qr-fieldset"><span class="qr-label">Folder ekspor</span><span class="qr-field is-disabled"><input value="~/Movies/QuranRender" disabled></span></label>`),
      ),
    ].join(""),
  },
  {
    id: "stepper", title: "Stepper angka & waktu",
    desc: "Untuk waktu dan angka di inspector. Angka tabular rata kanan. Seret horizontal untuk menggeser nilai, panah atas/bawah untuk ±1 frame (Shift ±1 detik), atau ketik langsung.",
    spec: () => row(
      cap("Waktu", `<span class="qr-field qr-stepper"><input value="00:00:21:12" aria-label="Mulai"><span class="qr-stepper__btns"><button aria-label="Naik">${I("chevron-up")}</button><button aria-label="Turun">${I("chevron-down")}</button></span></span>`),
      cap("Fokus", `<span class="qr-field qr-stepper is-focus"><input value="00:00:29:24" aria-label="Selesai"><span class="qr-stepper__btns"><button aria-label="Naik">${I("chevron-up")}</button><button aria-label="Turun">${I("chevron-down")}</button></span></span>`),
      cap("Angka + satuan", `<span class="qr-field qr-stepper" style="width:96px"><input value="64" aria-label="Ukuran"><span class="qr-field__suffix">px</span><span class="qr-stepper__btns"><button aria-label="Naik">${I("chevron-up")}</button><button aria-label="Turun">${I("chevron-down")}</button></span></span>`),
      cap("Galat", `<span class="qr-field qr-stepper is-invalid"><input value="00:00:31:02" aria-invalid="true" aria-label="Selesai"><span class="qr-stepper__btns"><button aria-label="Naik">${I("chevron-up")}</button><button aria-label="Turun">${I("chevron-down")}</button></span></span>`),
    ),
  },
  {
    id: "menu", title: "Select & menu",
    desc: "Select tertutup bergaya isian. Menu adalah lapisan mengapung (bayangan pop). Item aktif memakai latar nila redup. Item yang tidak bisa dipilih tetap terlihat dan menyebut alasannya. Pintasan di kanan.",
    spec: () => row(
      cap("Tertutup", `<button class="qr-btn qr-select">LPMQ${I("chevron-down")}</button>`),
      cap("Hover", `<button class="qr-btn qr-select is-hover">LPMQ${I("chevron-down")}</button>`),
      cap("Terbuka", `<div class="stack"><button class="qr-btn qr-select" aria-expanded="true">LPMQ${I("chevron-down")}</button>
        <ul class="qr-menu" role="menu">
          <li class="qr-menu__label">Font ayat</li>
          <li class="qr-menu__item" role="menuitemradio" aria-checked="true"><span class="qr-check-mark">${I("check")}</span>LPMQ</li>
          <li class="qr-menu__item is-hover" role="menuitemradio" aria-checked="false"><span class="qr-check-mark"></span>IndoPak</li>
          <li class="qr-menu__item" role="menuitemradio" aria-disabled="true"><span class="qr-check-mark"></span>Amiri<span class="qr-menu__kbd qr-help">glyph tidak lengkap</span></li>
          <li class="qr-menu__sep" role="separator"></li>
          <li class="qr-menu__item" role="menuitem"><span class="qr-menu__icon">${I("folder-open", "qr-ic qr-ic--sm")}</span>Impor font…<span class="qr-menu__kbd qr-kbd">⌘O</span></li>
          <li class="qr-menu__item qr-menu__item--danger" role="menuitem"><span class="qr-menu__icon">${I("trash-2", "qr-ic qr-ic--sm")}</span>Hapus gaya klip</li>
        </ul></div>`, "sp--tall"),
    ),
  },
  {
    id: "pilihan", title: "Kotak centang, radio, sakelar",
    desc: "Kotak centang untuk pilihan bebas. Radio untuk satu dari beberapa pilihan. Sakelar untuk pengaturan yang langsung berlaku. Bagian aktif diberi nila karena menandai pilihan.",
    spec: () => [
      row(
        cap("Mati", `<label class="qr-choice"><input type="checkbox" class="qr-check">Sertakan nomor ayat</label>`),
        cap("Hidup", `<label class="qr-choice"><input type="checkbox" class="qr-check" checked>Sertakan nomor ayat</label>`),
        cap("Sebagian", `<label class="qr-choice"><input type="checkbox" class="qr-check" data-indeterminate>Semua terjemahan</label>`),
        cap("Fokus", `<label class="qr-choice"><input type="checkbox" class="qr-check is-focus">Sertakan nomor ayat</label>`),
        cap("Nonaktif", `<label class="qr-choice is-disabled"><input type="checkbox" class="qr-check" checked disabled>Atribusi (wajib)</label>`),
      ),
      row(
        cap("Radio", `<span class="inline col"><label class="qr-choice"><input type="radio" name="fmt-THEME" class="qr-radio" checked>SRT</label><label class="qr-choice"><input type="radio" name="fmt-THEME" class="qr-radio">VTT</label><label class="qr-choice is-disabled"><input type="radio" name="fmt-THEME" class="qr-radio" disabled>ASS (P1)</label></span>`),
        cap("Sakelar", `<span class="inline col"><label class="qr-choice"><input type="checkbox" role="switch" class="qr-switch">Notifikasi desktop</label><label class="qr-choice"><input type="checkbox" role="switch" class="qr-switch" checked>Ikuti tema sistem</label><label class="qr-choice is-disabled"><input type="checkbox" role="switch" class="qr-switch" disabled>Telemetri (belum tersedia)</label></span>`),
      ),
    ].join(""),
  },
  {
    id: "slider", title: "Slider",
    desc: "Rel 4 px berwarna garis tegas, isian nila, kenop 14 px. Selalu berpasangan dengan nilai angka tabular atau stepper agar nilai bisa diketik.",
    spec: () => row(
      cap("Default", `<span class="inline w220"><input type="range" class="qr-slider" style="--v:0.58" value="58" aria-label="Ukuran"><span class="qr-tc">64</span></span>`),
      cap("Hover", `<span class="inline w220"><input type="range" class="qr-slider is-hover" style="--v:0.3" value="30" aria-label="Ukuran"><span class="qr-tc">40</span></span>`),
      cap("Fokus", `<span class="inline w220"><input type="range" class="qr-slider is-focus" style="--v:0.8" value="80" aria-label="Ukuran"><span class="qr-tc">88</span></span>`),
      cap("Nonaktif", `<span class="inline w220"><input type="range" class="qr-slider" style="--v:0.5" value="50" disabled aria-label="Ukuran"><span class="qr-tc qr-tc--dim">56</span></span>`),
    ),
  },
  {
    id: "alur", title: "Alur kerja",
    desc: "Navigasi utama studio, di tengah header. Urutan dan status terlihat (selesai, berjalan, belum, terhalang). Bukan tab: setiap langkah membuka bagian studio yang sama, dan langkah yang belum boleh dilewati.",
    spec: () => [
      row(cap("Sedang sinkron", `<ol class="qr-flow" aria-label="Alur kerja">
        <li class="is-done"><span class="qr-flow__n">${I("check", "qr-ic qr-ic--sm")}</span>Sumber</li><li class="is-current" aria-current="step"><span class="qr-flow__sep" aria-hidden="true">${I("chevron-right", "qr-ic qr-ic--sm")}</span><span class="qr-flow__n">2</span>Sinkron</li><li><span class="qr-flow__sep" aria-hidden="true">${I("chevron-right", "qr-ic qr-ic--sm")}</span><span class="qr-flow__n">3</span>Tampilan</li><li><span class="qr-flow__sep" aria-hidden="true">${I("chevron-right", "qr-ic qr-ic--sm")}</span><span class="qr-flow__n">4</span>Ekspor</li></ol>`)),
      row(cap("Ekspor terhalang (3 segmen perlu ditinjau)", `<ol class="qr-flow" aria-label="Alur kerja">
        <li class="is-done"><span class="qr-flow__n">${I("check", "qr-ic qr-ic--sm")}</span>Sumber</li><li class="is-done"><span class="qr-flow__sep" aria-hidden="true">${I("chevron-right", "qr-ic qr-ic--sm")}</span><span class="qr-flow__n">${I("check", "qr-ic qr-ic--sm")}</span>Sinkron</li><li class="is-done"><span class="qr-flow__sep" aria-hidden="true">${I("chevron-right", "qr-ic qr-ic--sm")}</span><span class="qr-flow__n">${I("check", "qr-ic qr-ic--sm")}</span>Tampilan</li><li class="is-blocked is-current" aria-current="step"><span class="qr-flow__sep" aria-hidden="true">${I("chevron-right", "qr-ic qr-ic--sm")}</span><span class="qr-flow__n">!</span>Ekspor</li></ol>`)),
    ].join(""),
  },
  {
    id: "inspector", title: "Panel & inspector",
    desc: "Panel berlatar panel dengan hairline. Inspector terdiri dari grup yang bisa dilipat dan baris properti (label 88 px). Titik nila di label menandai nilai yang ditimpa di tingkat klip. Pil asal gaya menunjukkan lapisan teratas.",
    spec: () => row(cap("Segmen terpilih", `<aside class="qr-panel w300">
      <div class="qr-panel__head"><span class="qr-panel__title">Inspector</span><span class="qr-panel__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Kembalikan ke templat">${I("rotate-ccw", "qr-ic qr-ic--sm")}</button></span></div>
      <details class="qr-group" open><summary>${I("chevron-down", "qr-ic qr-ic--sm")}Segmen 1:5</summary>
        <div class="qr-prop"><span class="qr-prop__label">Mulai</span><span class="qr-field qr-stepper"><input value="00:00:21:12" aria-label="Mulai"><span class="qr-stepper__btns"><button aria-label="Naik">${I("chevron-up")}</button><button aria-label="Turun">${I("chevron-down")}</button></span></span></div>
        <div class="qr-prop"><span class="qr-prop__label">Kata</span><span>1–4 dari 4</span></div>
      </details>
      <details class="qr-group" open><summary>${I("chevron-down", "qr-ic qr-ic--sm")}Teks ayat</summary>
        <div class="qr-prop"><span class="qr-prop__label">Font</span><button class="qr-btn qr-select qr-btn--sm" style="min-width:120px">LPMQ${I("chevron-down", "qr-ic qr-ic--sm")}</button></div>
        <div class="qr-prop is-overridden"><span class="qr-prop__label">Ukuran</span><input type="range" class="qr-slider" style="--v:0.58;width:84px" value="58" aria-label="Ukuran"><span class="qr-tc">64</span><button class="qr-kf" aria-pressed="true" aria-label="Keyframe ukuran di playhead">${I("diamond", "qr-ic qr-ic--sm")}</button></div>
        <div class="qr-prop"><span class="qr-prop__label">Opasitas</span><input type="range" class="qr-slider" style="--v:1;width:84px" value="100" aria-label="Opasitas"><span class="qr-tc">100</span><button class="qr-kf" aria-pressed="false" aria-label="Tambah keyframe opasitas">${I("diamond", "qr-ic qr-ic--sm")}</button></div>
      </details>
      <details class="qr-group"><summary>${I("chevron-down", "qr-ic qr-ic--sm")}Animasi</summary></details>
      <details class="qr-group" open><summary>${I("chevron-down", "qr-ic qr-ic--sm")}Asal gaya</summary>
        <span class="qr-plies"><span class="qr-ply">Templat</span><span class="qr-ply">Proyek</span><span class="qr-ply is-top">Klip</span></span>
      </details></aside>`, "sp--tall")),
  },
  {
    id: "item", title: "Item daftar",
    desc: "Untuk aset proyek, antrean, dan hasil pencarian. Nama dipotong dengan elipsis, metadata angka tabular di kanan. File yang hilang tetap terlihat dengan tautan untuk menghubungkan ulang.",
    spec: () => row(cap("Semua state", `<div class="qr-panel w300" style="padding:6px">
      <div class="qr-item">${I("audio-waveform")}<span class="qr-item__name">fatihah-studio.m4a</span><span class="qr-item__meta">0:47</span></div>
      <div class="qr-item is-hover">${I("image")}<span class="qr-item__name">latar-subuh.mp4</span><span class="qr-item__meta">1:12</span></div>
      <div class="qr-item is-selected">${I("audio-waveform")}<span class="qr-item__name">tarawih-malam-3-imam.m4a</span><span class="qr-item__meta">41:08</span></div>
      <div class="qr-item is-missing">${I("triangle-alert")}<span class="qr-item__name">rekaman-lama.wav</span><a class="qr-link">Hubungkan ulang</a></div>
      <div class="qr-item is-dragover">${I("upload")}<span class="qr-item__name">Lepaskan untuk menambahkan</span></div></div>`, "sp--tall"),
      cap("Keterangan", `<dl class="legend"><dt>Baris 1</dt><dd>Default</dd><dt>Baris 2</dt><dd>Hover</dd><dt>Baris 3</dt><dd>Terpilih</dd><dt>Baris 4</dt><dd>File hilang</dd><dt>Baris 5</dt><dd>Seret masuk</dd></dl>`)),
  },
  {
    id: "lencana", title: "Lencana, pintasan, tooltip",
    desc: "Lencana menampilkan status dengan titik kecil. Warna status tidak pernah mengisi bidang. Tombol pintasan memakai font UI. Tooltip berlatar terbalik dan muncul setelah 500 ms.",
    spec: () => [
      row(
        cap("Status", `<span class="inline wrap"><span class="qr-badge qr-badge--success">Selesai</span><span class="qr-badge qr-badge--warning">Perlu ditinjau</span><span class="qr-badge qr-badge--danger">Ditolak</span><span class="qr-badge qr-badge--accent">Berjalan 42%</span><span class="qr-badge">Antre</span><span class="qr-badge qr-badge--plain">${I("wand-sparkles", "qr-ic qr-ic--sm")}Disunting AI</span><span class="qr-badge qr-badge--plain">Diubah pengguna</span></span>`),
      ),
      row(
        cap("Pintasan", `<span class="inline"><span class="qr-kbd">⌘</span><span class="qr-kbd">K</span><span class="sp-gap"></span><span class="qr-kbd">⇧</span><span class="qr-kbd">⌘</span><span class="qr-kbd">E</span><span class="sp-gap"></span><span class="qr-kbd">Spasi</span></span>`),
        cap("Tooltip", `<span class="qr-tip" role="tooltip">Belah klip di playhead<span class="qr-kbd">S</span></span>`),
      ),
    ].join(""),
  },
  {
    id: "peringatan", title: "Peringatan dalam halaman",
    desc: "Untuk keadaan yang perlu dibaca sebelum lanjut, termasuk penolakan kebijakan teks (CNT). Batasnya 1 px dengan warna status, dan setiap peringatan punya satu aksi yang menyelesaikan masalahnya. Tidak memakai garis tebal di sisi kiri.",
    spec: () => [
      row(cap("Info", `<div class="qr-alert qr-alert--info w520" role="status">${I("info")}<div class="qr-alert__content"><span class="qr-alert__title">Saheeh International belum terpasang</span><span class="qr-alert__body">Unduh dari Quran.com untuk memakainya. Atribusi masuk otomatis ke paket unggah.</span></div><span class="qr-alert__actions"><button class="qr-btn qr-btn--secondary qr-btn--sm">Unduh</button></span></div>`)),
      row(cap("Perlu ditinjau", `<div class="qr-alert qr-alert--warning w520" role="status">${I("triangle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">3 segmen perlu ditinjau</span><span class="qr-alert__body">Keyakinan sinkron rendah pada 1:7, 2:5, dan 2:6.</span></div><span class="qr-alert__actions"><button class="qr-btn qr-btn--secondary qr-btn--sm">Tinjau</button></span></div>`)),
      row(cap("Ekspor ditolak (CNT-1)", `<div class="qr-alert qr-alert--danger w520" role="alert">${I("circle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">Ekspor belum bisa dilanjutkan</span><span class="qr-alert__body">Segmen 2:255 memotong sebuah kata. Geser batas segmen ke batas kata terdekat.</span></div><span class="qr-alert__actions"><button class="qr-btn qr-btn--secondary qr-btn--sm">Tampilkan segmen</button></span></div>`)),
      row(cap("Berhasil", `<div class="qr-alert qr-alert--success w520" role="status">${I("circle-check")}<div class="qr-alert__content"><span class="qr-alert__title">Ayat sudah tersinkron</span><span class="qr-alert__body">Silakan periksa bagian yang ditandai sebelum mengekspor.</span></div></div>`)),
    ].join(""),
  },
  {
    id: "toast", title: "Toast",
    desc: "Kabar tentang pekerjaan latar (ekspor, unduhan) yang muncul di kanan bawah. Toast berhasil hilang setelah 6 detik. Toast galat tetap tampil sampai ditutup dan selalu menyebut apa yang sudah dilakukan aplikasi.",
    spec: () => [
      row(cap("Berhasil", `<div class="qr-toast qr-toast--success" role="status">${I("circle-check")}<div class="qr-toast__body">Ekspor selesai<small>Al-Fatihah (9:16).mp4 · 18 detik</small></div><button class="qr-btn qr-btn--ghost qr-btn--sm">Buka folder</button><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Tutup">${I("x", "qr-ic qr-ic--sm")}</button></div>`)),
      row(cap("Peringatan (sudah dipulihkan)", `<div class="qr-toast qr-toast--warning" role="status">${I("triangle-alert")}<div class="qr-toast__body">Encoder perangkat keras tidak tersedia<small>Ekspor dilanjutkan dengan encoder perangkat lunak (lebih lambat).</small></div><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Tutup">${I("x", "qr-ic qr-ic--sm")}</button></div>`)),
      row(cap("Galat", `<div class="qr-toast qr-toast--danger" role="alert">${I("circle-alert")}<div class="qr-toast__body">Ekspor Al-Kahfi 1–10 gagal<small>Ruang disk tidak cukup (perlu 1,2 GB). Kosongkan ruang lalu coba lagi.</small></div><button class="qr-btn qr-btn--secondary qr-btn--sm">Coba lagi</button><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Tutup">${I("x", "qr-ic qr-ic--sm")}</button></div>`)),
      row(cap("Progres", `<div class="qr-toast" role="status"><span class="qr-spin"></span><div class="qr-toast__body">Mengekspor 3 dari 12 klip<div class="qr-progress" style="--v:0.25"></div></div><button class="qr-btn qr-btn--ghost qr-btn--sm">Lihat antrean</button></div>`)),
    ].join(""),
  },
  {
    id: "dialog", title: "Dialog",
    desc: "Hanya untuk keputusan yang tidak bisa dibatalkan atau yang butuh fokus penuh. Judul berupa pertanyaan, isi menyebut akibatnya, dan aksi utama berada paling kanan. Esc menutup dialog, dan fokus terkunci di dalamnya.",
    spec: () => row(cap("Konfirmasi hapus", `<div class="qr-scrim w520"><div class="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-THEME">
      <div class="qr-dialog__head"><h3 class="qr-dialog__title" id="dlg-THEME">Hapus proyek “Tarawih Malam 3”?</h3></div>
      <div class="qr-dialog__body"><p>Proyek dan riwayat versinya akan dihapus. File media di komputer Anda tidak ikut terhapus.</p></div>
      <div class="qr-dialog__foot"><button class="qr-btn qr-btn--secondary is-focus">Batal</button><button class="qr-btn qr-btn--danger">${I("trash-2")}Hapus proyek</button></div>
    </div></div>`, "sp--tall")),
  },
  {
    id: "antrean", title: "Antrean & progres",
    desc: "Satu baris untuk setiap klip batch, dengan kode ayat sebagai identitas. Status dicap di baris itu. Job yang dibatalkan tidak hilang: ia tetap terlihat dengan judul dicoret dan bisa dijalankan ulang.",
    spec: () => row(cap("Antrean batch", `<div class="qr-panel qr-jobs w640">
      <div class="qr-job"><span class="qr-job__code">18:1–10</span><span class="qr-job__title"><span>Al-Kahfi 1–10 (9:16)</span><small>Menunggu giliran</small></span><span class="qr-job__state"><span class="qr-badge">Antre</span></span><span class="qr-job__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Batalkan">${I("x", "qr-ic qr-ic--sm")}</button></span></div>
      <div class="qr-job"><span class="qr-job__code">18:11–16</span><span class="qr-job__title"><span>Al-Kahfi 11–16 (9:16)</span><small>Encoder VideoToolbox · sisa ±40 detik</small></span><span class="qr-job__state"><span class="qr-badge qr-badge--accent">Berjalan 42%</span><span class="qr-progress" style="--v:0.42"></span></span><span class="qr-job__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Jeda">${I("pause", "qr-ic qr-ic--sm")}</button></span></div>
      <div class="qr-job"><span class="qr-job__code">18:17</span><span class="qr-job__title"><span>Al-Kahfi 17 (9:16)</span><small>Dijeda oleh pengguna</small></span><span class="qr-job__state"><span class="qr-badge">Dijeda 18%</span><span class="qr-progress is-paused" style="--v:0.18"></span></span><span class="qr-job__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Lanjutkan">${I("play", "qr-ic qr-ic--sm")}</button></span></div>
      <div class="qr-job"><span class="qr-job__code">1:1–7</span><span class="qr-job__title"><span>Al-Fatihah (9:16)</span><small>18 detik · 24 MB</small></span><span class="qr-job__state"><span class="qr-badge qr-badge--success">Selesai</span></span><span class="qr-job__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Buka folder">${I("folder-open", "qr-ic qr-ic--sm")}</button></span></div>
      <div class="qr-job"><span class="qr-job__code">2:255</span><span class="qr-job__title"><span>Ayat Kursi (16:9)</span><small>Segmen memotong kata (CNT-1)</small></span><span class="qr-job__state"><span class="qr-badge qr-badge--danger">Gagal</span></span><span class="qr-job__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Coba lagi">${I("rotate-ccw", "qr-ic qr-ic--sm")}</button></span></div>
      <div class="qr-job is-canceled"><span class="qr-job__code">36:1–12</span><span class="qr-job__title"><span>Yasin 1–12 (1:1)</span><small>Dibatalkan 21.04</small></span><span class="qr-job__state"><span class="qr-badge qr-badge--plain">Dibatalkan</span></span><span class="qr-job__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Jalankan ulang">${I("rotate-ccw", "qr-ic qr-ic--sm")}</button></span></div>
    </div>`, "sp--tall sp--full"),
      cap("Progres tak tentu", `<span class="w220 block"><span class="qr-progress is-indeterminate" style="display:block"></span></span>`)),
  },
  {
    id: "kosong", title: "Keadaan kosong & area lepas",
    desc: "Keadaan kosong menyebut langkah pertama. Area lepas menerima file tilawah dan memberi umpan balik nila saat file diseret masuk.",
    spec: () => row(
      cap("Beranda kosong", `<div class="qr-drop qr-empty w300">${I("file-input")}<span class="qr-empty__title">Belum ada proyek</span><span>Mulai dengan menyeret file tilawah ke sini, atau</span><button class="qr-btn qr-btn--primary qr-btn--sm">Pilih file…</button></div>`, "sp--tall"),
      cap("Seret masuk", `<div class="qr-drop qr-empty is-dragover w300">${I("upload")}<span class="qr-empty__title">Lepaskan untuk membuat proyek</span><span>fatihah-studio.m4a · 0:47</span></div>`, "sp--tall"),
    ),
  },
  {
    id: "timeline", title: "Timeline",
    desc: "Track berlabel 132 px dengan tombol tampil/kunci/bisu. Klip punya state default, hover, terpilih (dengan pegangan trim), perlu ditinjau (titik amber), dan terkunci. Klip terjemahan bergaris putus-putus, dan menjadi garis utuh setelah disunting. Playhead, garis snap, dan rentang masuk/keluar memakai nila karena menandai posisi sekarang.",
    spec: () => row(cap("Track & klip", `<div class="qr-tl w720">
      <div class="qr-tl__ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span></div>
      <div class="qr-track is-locked"><div class="qr-track__head"><span>Latar</span><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Tampilkan" aria-pressed="false">${I("eye", "qr-ic qr-ic--sm")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Kunci" aria-pressed="true">${I("lock", "qr-ic qr-ic--sm")}</button></div><div class="qr-lane"><div class="qr-clip is-locked" style="left:0;width:100%">${I("lock", "qr-ic qr-ic--sm")}<span class="qr-clip__label">latar-subuh.mp4</span></div></div></div>
      <div class="qr-track"><div class="qr-track__head"><span>Audio</span><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Bisukan" aria-pressed="false">${I("volume-2", "qr-ic qr-ic--sm")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Kunci" aria-pressed="false">${I("lock-open", "qr-ic qr-ic--sm")}</button></div><div class="qr-lane"><div class="qr-clip" style="left:0;width:100%">${WAVE}<span class="qr-clip__label qr-clip__chip">fatihah-studio.m4a</span></div></div></div>
      <div class="qr-track"><div class="qr-track__head"><span>Ayat</span><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Tampilkan" aria-pressed="false">${I("eye", "qr-ic qr-ic--sm")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Kunci" aria-pressed="false">${I("lock-open", "qr-ic qr-ic--sm")}</button></div><div class="qr-lane">
        <div class="qr-clip" style="left:0;width:13%"><span class="qr-clip__label">1:1</span></div>
        <div class="qr-clip is-hover" style="left:14%;width:11.5%"><span class="qr-clip__label">1:2</span></div>
        <div class="qr-clip is-locked" style="left:26.3%;width:9.3%">${I("lock", "qr-ic qr-ic--sm")}<span class="qr-clip__label">1:3</span></div>
        <div class="qr-clip" style="left:36.4%;width:7.8%"><span class="qr-clip__label">1:4</span></div>
        <div class="qr-clip is-selected" style="left:45%;width:17.7%"><span class="qr-clip__label">1:5</span></div>
        <div class="qr-clip is-trim" style="left:63.6%;width:9.3%"><span class="qr-clip__label">1:6</span></div>
        <div class="qr-clip is-review" style="left:73.7%;width:26.3%"><span class="qr-dot"></span><span class="qr-clip__label">1:7</span><span class="qr-clip__tag">62%</span></div>
      </div></div>
      <div class="qr-track"><div class="qr-track__head"><span>Terjemahan</span><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Tampilkan" aria-pressed="false">${I("eye", "qr-ic qr-ic--sm")}</button></div><div class="qr-lane">
        <div class="qr-clip qr-clip--tr" style="left:0;width:13%"><span class="qr-clip__label">Dengan nama Allah…</span></div>
        <div class="qr-clip qr-clip--tr is-edited" style="left:45%;width:17.7%"><span class="qr-clip__label">Hanya kepada Engkaulah…</span><span class="qr-clip__tag">diubah</span></div>
        <div class="qr-clip qr-clip--tr" style="left:73.7%;width:26.3%">${I("wand-sparkles", "qr-ic qr-ic--sm")}<span class="qr-clip__label">(yaitu) jalan orang-orang…</span></div>
      </div></div>
      <div class="tl-overlay"><div class="qr-range" style="left:45%;width:17.7%"></div><div class="qr-snap" style="left:62.7%"><span class="qr-snap__label">snap 1:5</span></div><div class="qr-marker" style="left:73.7%"></div><div class="qr-playhead" style="left:51%"><span class="qr-playhead__tc">00:24:09</span></div></div>
    </div>`, "sp--full")),
  },
  {
    id: "transport", title: "Transport",
    desc: "Kontrol putar di bawah kanvas. Tombol putar berbentuk lingkaran 32 px. Waktu berjalan memakai angka tabular, dan durasi total diredam.",
    spec: () => row(
      cap("Berhenti", `<span class="qr-transport"><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Ke awal">${I("skip-back")}</button><button class="qr-play" aria-label="Putar">${I("play")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Maju satu frame">${I("step-forward")}</button><span class="qr-tc">00:00:24:09</span><span class="qr-tc qr-tc--dim">/ 00:00:47:15</span></span>`),
      cap("Diputar, hover", `<span class="qr-transport"><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Ke awal">${I("skip-back")}</button><button class="qr-play is-hover" aria-label="Jeda">${I("pause")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Maju satu frame">${I("step-forward")}</button><span class="qr-tc">00:00:26:21</span><span class="qr-tc qr-tc--dim">/ 00:00:47:15</span></span>`),
    ),
  },
  {
    id: "palet", title: "Palet perintah",
    desc: "Dibuka dengan ⌘K / Ctrl+K dari mana saja. Bisa mencari perintah, langkah alur, dan ayat. Teks yang cocok ditandai nila, dan nama surah dalam Arab memakai Amiri. Enter menjalankan, Esc menutup.",
    spec: () => row(cap("Mencari “tamp”", `<div class="qr-cmdk" role="dialog" aria-label="Palet perintah">
      <div class="qr-cmdk__input">${I("search")}<span class="qr-cmdk__q">tamp<i class="qr-cmdk__caret"></i></span><span class="qr-kbd">Esc</span></div>
      <div class="qr-cmdk__list" role="listbox">
        <div class="qr-cmdk__group">Alur</div>
        <div class="qr-cmdk__item is-active" role="option" aria-selected="true">${I("type")}<span class="qr-cmdk__label">Buka langkah <mark>Tamp</mark>ilan</span><span class="qr-cmdk__keys"><span class="qr-kbd">3</span></span></div>
        <div class="qr-cmdk__group">Perintah</div>
        <div class="qr-cmdk__item" role="option">${I("eye")}<span class="qr-cmdk__label"><mark>Tamp</mark>ilkan area aman</span><span class="qr-cmdk__keys"><span class="qr-kbd">⇧</span><span class="qr-kbd">A</span></span></div>
        <div class="qr-cmdk__item" role="option">${I("languages")}<span class="qr-cmdk__label"><mark>Tamp</mark>ilkan terjemahan Saheeh</span></div>
        <div class="qr-cmdk__group">Ayat</div>
        <div class="qr-cmdk__item" role="option">${I("search")}<span class="qr-cmdk__label">Lompat ke Al-Baqarah 255</span><span class="ar" lang="ar" dir="rtl">البقرة</span></div>
      </div></div>`, "sp--tall")),
  },
];

const nav = COMPONENTS.map((c) => `<li><a href="#${c.id}">${c.title}</a></li>`).join("");
const sections = COMPONENTS.map((c) => `
  <section class="cmp" id="${c.id}" aria-labelledby="h-${c.id}">
    <h2 id="h-${c.id}">${c.title}</h2>
    <p class="lead">${c.desc}</p>
    <div class="themes">
      <div class="pane t-light" aria-label="Tema terang"><p class="pane__label">Terang</p>${c.spec().replaceAll("THEME", "l")}</div>
      <div class="pane t-dark" aria-label="Tema gelap"><p class="pane__label">Gelap</p>${c.spec().replaceAll("THEME", "d")}</div>
    </div>
  </section>`).join("");

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google" content="notranslate">
<title>QuranRender: Design System</title>
<link rel="icon" href="../brand/logo/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="components.css">
<link rel="stylesheet" href="gallery.css">
</head>
<body>
<header class="top">
  <span class="brand">
    <img class="only-light" src="../brand/logo/playhead-lockup-light.svg" alt="QuranRender" height="32">
    <img class="only-dark" src="../brand/logo/playhead-lockup-dark.svg" alt="QuranRender" height="32">
  </span>
  <div class="top-meta"><h1>Design system</h1><p>Tahap 2: token komponen dan semua state, terang dan gelap berdampingan.</p></div>
  <div class="qr-seg" role="radiogroup" aria-label="Tema halaman">
    <button role="radio" aria-checked="true" data-set-theme="system">Sistem</button>
    <button role="radio" aria-checked="false" data-set-theme="light">Terang</button>
    <button role="radio" aria-checked="false" data-set-theme="dark">Gelap</button>
  </div>
</header>
<div class="layout">
  <nav class="toc" aria-label="Daftar komponen"><ul>${nav}</ul></nav>
  <main>${sections}</main>
</div>
<script>
  document.querySelectorAll("[data-indeterminate]").forEach((el) => (el.indeterminate = true));
  const btns = document.querySelectorAll("[data-set-theme]");
  btns.forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.setTheme;
    if (m === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", m);
    btns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));
</script>
</body>
</html>
`;
fs.writeFileSync(OUT, html);
console.log("wrote", OUT, html.length, "components:", COMPONENTS.length);
