// Prototipe interaktif QuranRender (tahap 4). Semua data adalah contoh; teks ayat dari dataset Kemenag.
(() => {
"use strict";
const D = window.QR_DATA;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ic = (n, c = "") => `<svg class="qr-ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const badge = (k, t) => `<span class="qr-badge${k ? " qr-badge--" + k : ""}">${t}</span>`;
const kbd = (...k) => k.map((x) => `<span class="qr-kbd">${x}</span>`).join("");
const ayahEl = (t, cls = "") => `<span class="${cls}" lang="ar" dir="rtl">${esc(t)}</span>`;
const IS_MAC = /Mac/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

/* ——— Data ——— */
const tok = (t) => {
  const out = [];
  for (const x of t.trim().split(/\s+/)) {
    if (!/\p{L}/u.test(x) && out.length) out[out.length - 1] += " " + x;
    else out.push(x);
  }
  return out;
};
const T = [[0, 6.2], [6.6, 12.1], [12.5, 16.9], [17.3, 21.0], [21.4, 29.8], [30.2, 34.6], [35.0, 47.5]];
const CONF = [0.97, 0.95, 0.78, 0.96, 0.91, 0.74, 0.62];
const TOTAL = 47.5;
const SEGS = D.fatihah.map((v, i) => ({ i, code: `1:${v.a}`, a: v.a, start: T[i][0], end: T[i][1], ar: v.ar, id: v.id, words: tok(v.ar), conf: CONF[i] }));
const fmt = (t) => {
  const p = (n) => String(n).padStart(2, "0");
  return `00:${p(Math.floor(t / 60))}:${p(Math.floor(t % 60))}:${p(Math.floor((t % 1) * 30))}`;
};
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const pct = (t) => (t / TOTAL) * 100;
const firstWords = (s, n = 3) => tok(s).slice(0, n).join(" ");

const PROJECTS = [
  { id: "fatihah", name: "Al-Fatihah", qari: "Qari contoh", dur: "00:47", range: "1:1–7", status: "ready", date: "Hari ini, 20.41", cat: "Studio", ar: firstWords(D.fatihah[0].ar), pos: "50% 25%" },
  { id: "tarawih", name: "Tarawih Malam 3", qari: "Imam masjid contoh", dur: "41:08", range: "Belum disinkron", status: "draft", date: "Hari ini, 17.05", cat: "Tarawih", ar: "", pos: "" },
  { id: "kahfi", name: "Al-Kahfi 1–10", qari: "Qari contoh", dur: "02:14", range: "18:1–10", status: "ready", date: "Kemarin", cat: "Studio", ar: firstWords(D.kahf1.ar), pos: "50% 70%" },
  { id: "kursi", name: "Ayat Kursi", qari: "Qari contoh", dur: "00:38", range: "2:255", status: "pub", date: "18 Okt", cat: "Studio", ar: firstWords(D.kursi.ar), pos: "30% 40%" },
  { id: "yasin", name: "Yasin 1–12", qari: "Imam masjid contoh", dur: "01:21", range: "36:1–12", status: "draft", date: "16 Okt", cat: "Tarawih", ar: firstWords(D.yasin1.ar, 1), pos: "70% 55%" },
  { id: "mulk", name: "Al-Mulk 1–5", qari: "Qari contoh", dur: "00:52", range: "67:1–5", status: "ready", date: "12 Okt", cat: "Studio", ar: firstWords(D.mulk1.ar), pos: "40% 10%" },
  { id: "lama", name: "Rekaman lama", qari: "", dur: "", range: "", status: "draft", date: "Folder tidak ditemukan", cat: "Rekaman lama", missing: true },
];
const STATUS = { draft: ["", "Draf"], ready: ["success", "Siap"], pub: ["accent", "Terbit"] };

const TEMPLATES = [
  { id: "subuh", name: "Subuh", meta: "Foto latar · terjemahan" },
  { id: "hening", name: "Hening", meta: "Polos grafit" },
  { id: "terang", name: "Terang", meta: "Kertas terang" },
  { id: "besar", name: "Besar", meta: "Ayat besar, tanpa terjemahan" },
];
const PRESETS = [
  { id: "shorts", name: "YouTube Shorts", meta: "9:16 · maks 60 dtk", max: 60, ar: "9:16" },
  { id: "reels", name: "Instagram Reels", meta: "9:16 · maks 90 dtk", max: 90, ar: "9:16" },
  { id: "tiktok", name: "TikTok", meta: "9:16 · maks 180 dtk", max: 180, ar: "9:16" },
  { id: "yt", name: "YouTube", meta: "16:9 · tanpa batas", max: 9999, ar: "16:9" },
];

const JOBS0 = () => [
  { id: 1, code: "18:1–10", title: "Al-Kahfi 1–10 (9:16)", sub: "Menunggu giliran", state: "wait", pct: 0 },
  { id: 2, code: "18:11–16", title: "Al-Kahfi 11–16 (9:16)", sub: "Encoder VideoToolbox · sisa ±40 detik", state: "run", pct: 42 },
  { id: 3, code: "18:17", title: "Al-Kahfi 17 (9:16)", sub: "Dijeda oleh pengguna", state: "pause", pct: 18 },
  { id: 4, code: "67:1–5", title: "Al-Mulk 1–5 (9:16)", sub: "52 detik · 17 MB", state: "done", pct: 100 },
  { id: 5, code: "2:255", title: "Ayat Kursi (16:9)", sub: "Segmen memotong sebuah kata", state: "fail", pct: 0 },
  { id: 6, code: "36:1–12", title: "Yasin 1–12 (persegi)", sub: "Dibatalkan 21.04", state: "cancel", pct: 0 },
];
const JOB_ACT = {
  wait: [["cancel", "x", "Batalkan"]], run: [["pause", "pause", "Jeda"]], pause: [["resume", "play", "Lanjutkan"]],
  done: [["upload", "clipboard-check", "Siap unggah"], ["folder", "folder-open", "Buka folder"]], fail: [["retry", "rotate-ccw", "Coba lagi"]], cancel: [["rerun", "rotate-ccw", "Jalankan ulang"]],
};

/* ——— State ——— */
const defaults = () => ({
  space: "home", layer: null, homeView: "grid", filter: "all", q: "", menu: null,
  step: 2, sel: 4, t: SEGS[4].start + 0.01 + 2.9, playing: false, synced: true, syncRun: false, syncPct: 0, missing: false,
  accepted: {}, conflict: false, guide: true, template: "subuh", layers: { ayat: true, tr: true, surah: false, qari: false }, safe: true,
  preset: "shorts", batch: { step: 1, method: "n", n: 2, dur: 30, pick: [1, 1, 1, 0, 0, 0, 0] }, settingsTab: "data",
  saheeh: "none", saheehPct: 0, first: 1, gain: 3, cmdq: "", cmdi: 0, relinkFound: false,
});
const S = Object.assign(defaults(), { theme: "system", jobs: JOBS0(), empty: false });

const SCEN = [
  ["home", "Beranda", () => ({})],
  ["home-empty", "Beranda · kosong", () => ({ empty: true })],
  ["home-list", "Beranda · daftar", () => ({ homeView: "list" })],
  ["new", "Proyek baru", () => ({ layer: "new" })],
  ["studio-source", "Studio · Sumber (belum sinkron)", () => ({ space: "studio", step: 1, synced: false, sel: 0, t: 0.01 })],
  ["studio-missing", "Studio · Sumber (aset hilang)", () => ({ space: "studio", step: 1, synced: false, missing: true, guide: false, sel: 0, t: 0.01 })],
  ["relink", "Hubungkan ulang aset", () => ({ space: "studio", step: 1, synced: false, missing: true, layer: "relink", sel: 0, t: 0.01 })],
  ["studio-syncing", "Studio · Sinkron berjalan", () => ({ space: "studio", step: 2, synced: false, syncRun: true, syncPct: 40, guide: false, sel: 0, t: 0.01 })],
  ["studio-review", "Studio · Sinkron / tinjau", () => ({ space: "studio", step: 2 })],
  ["studio-style", "Studio · Tampilan", () => ({ space: "studio", step: 3, guide: false, layers: { ayat: true, tr: true, surah: true, qari: true } })],
  ["studio-export", "Studio · Ekspor", () => ({ space: "studio", step: 4, guide: false })],
  ["export-pass", "Ekspor · lolos", () => ({ space: "studio", step: 4, guide: false, layer: "export", accepted: { 2: 1, 5: 1, 6: 1 } })],
  ["export-blocked", "Ekspor · ditolak kebijakan teks", () => ({ space: "studio", step: 4, guide: false, layer: "export", conflict: true })],
  ["upload", "Siap unggah", () => ({ space: "studio", step: 4, guide: false, layer: "upload", accepted: { 2: 1, 5: 1, 6: 1 } })],
  ["batch", "Pecah menjadi klip", () => ({ space: "studio", step: 4, guide: false, layer: "batch" })],
  ["queue", "Antrean", () => ({ space: "studio", step: 2, guide: false, layer: "queue" })],
  ["templates", "Galeri templat", () => ({ space: "studio", step: 3, guide: false, layer: "templates" })],
  ["first-run", "Pertama kali jalan", () => ({ empty: true, layer: "first" })],
  ["diagnostics", "Diagnostik", () => ({ space: "studio", step: 4, guide: false, layer: "diag" })],
  ["settings-data", "Pengaturan · Data & model", () => ({ layer: "settings", settingsTab: "data" })],
  ["settings-fonts", "Pengaturan · Font", () => ({ layer: "settings", settingsTab: "font" })],
  ["history", "Riwayat versi", () => ({ space: "studio", step: 2, guide: false, layer: "history" })],
  ["cmdk", "Palet perintah", () => ({ space: "studio", step: 2, guide: false, layer: "cmdk", cmdq: "tamp" })],
];

/* ——— Utilitas keadaan ——— */
const canExport = () => S.synced && !S.syncRun && !S.missing;
function openExport() {
  if (!canExport()) { toast({ kind: "warning", title: "Ekspor belum bisa dilakukan", small: S.missing ? "Hubungkan ulang aset dulu." : "Sinkronkan ayat dulu." }); return; }
  S.layer = "export";
}
const needsReview = (s) => s.conf < 0.8 && !S.accepted[s.i];
const reviewCount = () => SEGS.filter(needsReview).length;
const segAt = (t) => SEGS.findIndex((s) => t >= s.start && t < s.end);
const wordAt = (s, t) => (t >= s.start && t < s.end ? Math.min(s.words.length - 1, Math.floor(((t - s.start) / (s.end - s.start)) * s.words.length)) : -1);
const activeJobs = () => S.jobs.filter((j) => j.state === "run" || j.state === "wait").length;
const timers = { sync: 0, jobs: 0, saheeh: 0 };

function applyScenario(id) {
  const sc = SCEN.find((x) => x[0] === id) || SCEN[0];
  stopPlay();
  clearInterval(timers.sync);
  const keep = { theme: S.theme, jobs: S.jobs };
  Object.assign(S, defaults(), { empty: false }, keep, sc[2]());
  if (S.syncRun) startSync();
  if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  $("#scenario").value = id;
  render();
}

/* ——— Toast ——— */
let toastId = 0;
function toast({ kind = "success", title, small = "", actions = [], sticky = false }) {
  const id = ++toastId;
  const icon = { success: "circle-check", warning: "triangle-alert", danger: "circle-alert", info: "info" }[kind] || "circle-check";
  const el = document.createElement("div");
  el.className = `qr-toast qr-toast--${kind === "info" ? "success" : kind}`;
  el.setAttribute("role", kind === "danger" ? "alert" : "status");
  el.innerHTML = `${ic(icon)}<div class="qr-toast__body">${title}${small ? `<small>${small}</small>` : ""}</div>${actions.map((a) => `<button class="qr-btn qr-btn--${a.primary ? "secondary" : "ghost"} qr-btn--sm" data-act="${a.act}"${a.arg ? ` data-arg="${a.arg}"` : ""}>${a.label}</button>`).join("")}<button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" data-act="toast-x" aria-label="Tutup">${ic("x", "qr-ic--sm")}</button>`;
  $("#toasts").append(el);
  while ($("#toasts").children.length > 3) $("#toasts").firstChild.remove();
  if (!sticky && kind !== "danger") setTimeout(() => el.remove(), 6000);
  return id;
}
const todo = (what) => toast({ kind: "info", title: what, small: "Belum dibuat di prototipe ini." });

/* ——— Beranda ——— */
function filteredProjects() {
  const q = S.q.trim().toLowerCase();
  return PROJECTS.filter((p) => {
    const f = S.filter;
    const okF = f === "all" || p.status === f || f === "cat:" + p.cat;
    return okF && (!q || (p.name + " " + p.qari + " " + p.range).toLowerCase().includes(q));
  });
}
const thumbBg = (p) => p.missing ? "" : p.ar ? `linear-gradient(180deg, rgb(8 9 12 / 0.4), rgb(8 9 12 / 0.6)), url('../brand/media/latar-subuh-9x16.webp') ${p.pos} / 180% auto no-repeat #0b0c0e` : "linear-gradient(180deg, #17191d, #0b0c0e)";
function card(p) {
  const [bk, bt] = STATUS[p.status];
  if (p.missing) {
    return `<div class="qr-card is-missing" role="group" aria-label="${esc(p.name)}"><span class="qr-card__thumb">${ic("triangle-alert")}</span><span class="qr-card__body"><span class="qr-card__title">${esc(p.name)}</span><span class="qr-card__meta">Folder tidak ditemukan</span><span class="qr-card__foot"><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Temukan folder proyek">Temukan…</button><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Hapus dari daftar">Hapus dari daftar</button></span></span></div>`;
  }
  return `<div class="card-wrap"><button class="qr-card" data-act="open-project" data-arg="${p.id}" style="width:100%">
    <span class="qr-card__thumb" style="--thumb-bg:${thumbBg(p)}">${p.ar ? ayahEl(p.ar, "ayah") : ic("audio-waveform")}<span class="qr-card__dur">${p.dur}</span></span>
    <span class="qr-card__body"><span class="qr-card__title">${esc(p.name)}</span><span class="qr-card__meta">${esc(p.qari)} · ${esc(p.range)}</span>
    <span class="qr-card__foot">${badge(bk, bt)}<span>${p.date}</span></span></span></button>
    <button class="qr-btn qr-btn--icon qr-btn--sm" data-act="menu" data-arg="${p.id}" aria-label="Menu ${esc(p.name)}" aria-haspopup="menu">${ic("ellipsis")}</button>
    ${S.menu === p.id ? cardMenu(p) : ""}</div>`;
}
function cardMenu(p) {
  const it = (t, i, cls = "") => `<li class="qr-menu__item ${cls}" role="menuitem" tabindex="-1" data-act="noop" data-arg="${t}"><span class="qr-menu__icon">${ic(i, "qr-ic--sm")}</span>${t}</li>`;
  return `<ul class="qr-menu menu-pop" role="menu" style="top:36px;right:6px;min-width:208px" aria-label="Menu proyek">${it("Buka", "folder-open")}${it("Duplikat", "copy")}${it("Ganti nama", "type")}${it("Pindahkan ke kategori", "layers")}${it("Tampilkan di " + (IS_MAC ? "Finder" : "penjelajah berkas"), "folder-search")}<li class="qr-menu__sep" role="separator"></li>${it("Hapus", "trash-2", "qr-menu__item--danger")}</ul>`;
}
function listRow(p) {
  if (p.missing) return `<div class="list-row" style="cursor:default"><span class="th" style="--thumb-bg:var(--bg-sunken);display:grid;place-items:center;color:var(--warning)">${ic("triangle-alert", "qr-ic--sm")}</span><span><span class="nm">${esc(p.name)}</span><span class="sub" style="display:block">Folder tidak ditemukan</span></span><span></span><span></span><span></span><span></span><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Temukan folder proyek">Temukan…</button></div>`;
  const [bk, bt] = STATUS[p.status];
  return `<button class="list-row" data-act="open-project" data-arg="${p.id}"><span class="th" style="--thumb-bg:${thumbBg(p)}"></span><span><span class="nm">${esc(p.name)}</span><span class="sub" style="display:block">${esc(p.qari)}</span></span><span class="sub">${esc(p.range)}</span><span class="tc sub">${p.dur}</span><span class="sub">${p.date}</span><span>${badge(bk, bt)}</span><span></span></button>`;
}
function homeMain() {
  if (S.empty) return `<div class="home-empty"><div class="qr-drop qr-empty">${ic("file-input")}<span class="qr-empty__title">Belum ada proyek</span><span>Mulai dengan menyeret file tilawah ke jendela ini, atau</span><button class="qr-btn qr-btn--primary" data-act="new">${ic("plus")}Buat proyek</button></div></div>`;
  const list = filteredProjects();
  const titles = { all: "Semua proyek", draft: "Draf", ready: "Siap", pub: "Terbit" };
  const title = S.filter.startsWith("cat:") ? S.filter.slice(4) : titles[S.filter];
  return `<div class="home-bar"><h1>${title}</h1><button class="qr-btn qr-btn--primary" data-act="new">${ic("plus")}Buat proyek</button><button class="qr-btn qr-btn--secondary" data-act="noop" data-arg="Buka proyek dari folder">${ic("folder-open")}Buka…</button><span class="spacer"></span>
    <span class="qr-field" style="width:212px;justify-content:space-between"><span class="muted">Urut:</span><select aria-label="Urutkan"><option>Terakhir diubah</option><option>Nama</option><option>Status</option></select></span>
    <div class="qr-seg" role="radiogroup" aria-label="Tampilan"><button role="radio" aria-checked="${S.homeView === "grid"}" data-act="view" data-arg="grid" aria-label="Kisi" title="Kisi">${ic("layout-grid")}</button><button role="radio" aria-checked="${S.homeView === "list"}" data-act="view" data-arg="list" aria-label="Daftar" title="Daftar">${ic("layout-list")}</button></div></div>
    ${list.length ? (S.homeView === "grid" ? `<div class="grid">${list.map(card).join("")}</div>` : `<div class="list">${list.map(listRow).join("")}</div>`)
      : `<div class="qr-empty">${ic("search")}<span class="qr-empty__title">Tidak ada proyek yang cocok</span><span>Coba kata kunci lain atau hapus filter.</span></div>`}`;
}
function viewHome() {
  const count = (f) => PROJECTS.filter((p) => !p.missing || f === "all").filter((p) => f === "all" || p.status === f).length;
  const nav = (f, icon, label, n) => `<button class="qr-rail__item" data-act="filter" data-arg="${f}" aria-current="${S.filter === f}">${ic(icon)}${label}${n != null ? `<em>${n}</em>` : ""}</button>`;
  const cats = ["Studio", "Tarawih", "Rekaman lama"];
  return `<div class="home"><header class="app-hd">${logo()}
    <label class="qr-field"><span class="qr-sr" hidden>Cari</span>${ic("search")}<input id="q" placeholder="Cari proyek, qari, atau ayat" value="${esc(S.q)}" autocomplete="off">${kbd(MOD, "F")}</label>
    <span class="spacer"></span>${queueBtn()}<button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="settings" aria-label="Pengaturan">${ic("settings-2")}</button></header>
    <div class="home-body"><nav class="home-rail" aria-label="Filter proyek"><div class="qr-rail">
      ${nav("all", "layout-grid", "Semua proyek", S.empty ? 0 : PROJECTS.length)}${nav("draft", "pencil-line", "Draf", S.empty ? 0 : count("draft"))}${nav("ready", "circle-check", "Siap", S.empty ? 0 : count("ready"))}${nav("pub", "star", "Terbit", S.empty ? 0 : count("pub"))}
      <div class="qr-rail__label">Kategori</div>${cats.map((c) => nav("cat:" + c, "folder-open", c, S.empty ? 0 : PROJECTS.filter((p) => p.cat === c).length)).join("")}
      <div class="qr-rail__sep"></div><button class="qr-rail__item" data-act="templates">${ic("layout-template")}Templat</button></div></nav>
      <main class="home-main" id="home-main">${homeMain()}</main></div></div>`;
}
const logo = () => `<span class="brand"><img class="only-light" src="../brand/logo/playhead-lockup-light.svg" alt="QuranRender" height="28"><img class="only-dark" src="../brand/logo/playhead-lockup-dark.svg" alt="QuranRender" height="28"></span>`;
const queueBtn = () => { const n = activeJobs(); return `<button class="qr-btn qr-btn--ghost" data-act="queue">${ic("list-checks")}Antrean${n ? ` ${badge("accent", n)}` : ""}</button>`; };

/* ——— Studio ——— */
const STEPS = ["Sumber", "Sinkron", "Tampilan", "Ekspor"];
function flow() {
  const blocked = S.conflict && S.step === 4;
  const done = (n) => (n === 1 ? true : n === 2 ? S.synced && !S.syncRun : n === 3 ? S.synced : false) && n < S.step;
  return `<ol class="qr-flow" aria-label="Alur kerja">${STEPS.map((n, i) => {
    const k = i + 1, cur = k === S.step, d = !cur && done(k) || (!cur && k < S.step);
    const sep = i ? `<span class="qr-flow__sep" aria-hidden="true">${ic("chevron-right", "qr-ic--sm")}</span>` : "";
    const num = d ? `<span class="qr-flow__n">${ic("check", "qr-ic--sm")}</span>` : `<span class="qr-flow__n">${blocked && cur ? "!" : k}</span>`;
    return `<li class="${cur ? "is-current" : d ? "is-done" : ""}${blocked && cur ? " is-blocked" : ""}"${cur ? ' aria-current="step"' : ""}>${sep}<button data-act="step" data-arg="${k}">${num}<span class="lbl-t">${n}</span></button></li>`;
  }).join("")}</ol>`;
}
function viewStudio() {
  const p = PROJECTS[0];
  return `<div class="studio">
    <header class="st-hd"><div class="l"><button class="qr-btn qr-btn--ghost" data-act="home">${ic("chevron-left")}Beranda</button><span class="st-name">${p.name}<small>${p.qari}</small></span><span class="save">${ic("check")}Tersimpan</span></div>
      ${flow()}<div class="r">${queueBtn()}<button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="history" aria-label="Riwayat versi">${ic("history")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="cmdk" aria-label="Palet perintah">${ic("search")}</button><span class="tip-wrap"><button class="qr-btn qr-btn--primary${canExport() ? "" : " is-disabled"}" data-act="export"${canExport() ? "" : ' aria-disabled="true" aria-describedby="tip-export"'}>${ic("file-output")}Ekspor</button>${canExport() ? "" : `<span class="qr-tip" role="tooltip" id="tip-export">${S.missing ? "Hubungkan ulang aset dulu" : "Sinkronkan ayat dulu, baru bisa diekspor"}</span>`}</span></div></header>
    ${S.syncRun ? `<div class="sync-bar" role="status"><span class="qr-spin"></span><span>${S.syncPct < 35 ? "Mengubah audio" : S.syncPct < 70 ? "Mengenali ayat" : "Menyelaraskan kata"}… <span class="tc">${Math.round(S.syncPct)}%</span></span><span class="qr-progress" style="--v:${S.syncPct / 100}"></span><span class="muted">Anda tetap bisa bekerja.</span><span class="spacer"></span><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="sync-cancel">Batal</button></div>` : "<div></div>"}
    <div class="st-body"><aside class="st-left" aria-label="Panel kiri">${leftPanel()}</aside>${viewer()}<aside class="st-insp" aria-label="Inspector">${inspector()}</aside></div>
    <div class="st-tl">${timeline()}</div></div>`;
}

/* panel kiri */
function leftPanel() {
  const guide = (txt, ttl) => S.guide ? `<div class="qr-guide" style="bottom:calc(100% - 4px);left:12px" role="note"><span class="qr-guide__title">${ttl}</span><span>${txt}</span><span class="qr-guide__actions"><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="guide-off">Matikan panduan</button></span></div>` : "";
  if (S.step === 1) {
    const item = (n, i, m, sel) => S.missing ? `<div class="qr-item is-missing">${ic("triangle-alert")}<span class="qr-item__name">${n}</span><span class="qr-item__meta">Hilang</span></div>` : `<div class="qr-item${sel ? " is-selected" : ""}">${ic(i)}<span class="qr-item__name">${n}</span><span class="qr-item__meta">${m}</span></div>`;
    return `<div class="st-left__body">${S.missing ? `<div class="qr-alert qr-alert--warning" role="status" style="margin-bottom:8px">${ic("triangle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">2 aset tidak ditemukan</span><span class="qr-alert__body">Berkas dipindah atau drive tidak terpasang.</span></div><span class="qr-alert__actions" style="margin-left:0"><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="relink">Hubungkan ulang</button></span></div>` : ""}
      <p class="pn-h">Aset proyek</p>${item("fatihah-studio.m4a", "audio-waveform", "0:47", true)}${item("latar-subuh.mp4", "image", "1:12")}
      <div class="qr-drop qr-empty" style="margin-top:8px;padding:16px 8px">${ic("upload")}<span>Seret file untuk menambah aset</span></div></div>
      <div class="st-left__foot">${S.syncRun || S.missing ? "" : !S.synced ? guide("Ayat dikenali dan diberi waktu otomatis. Anda tetap bisa bekerja sambil menunggu.", "Mulai dengan Sinkronkan") : ""}
      ${S.syncRun ? `<button class="qr-btn qr-btn--secondary" data-act="sync-cancel">Batalkan sinkron</button>` : `<button class="qr-btn qr-btn--secondary" data-act="sync"${S.missing ? " disabled" : ""}>${ic("audio-waveform")}${S.synced ? "Sinkronkan ulang…" : "Sinkronkan"}</button>`}${S.missing ? `<span class="pn-note" style="margin:0">Hubungkan ulang aset dulu.</span>` : ""}</div>`;
  }
  if (S.step === 2) {
    const n = reviewCount(), ok = SEGS.length - n;
    const row = (s) => `<button class="qr-item${S.sel === s.i ? " is-selected" : ""}" style="width:100%;border:0;background:${S.sel === s.i ? "" : "transparent"};font:inherit;font-size:var(--fs-13);text-align:left;cursor:pointer" data-act="sel" data-arg="${s.i}">${needsReview(s) ? `<span class="qr-dot"></span>` : S.accepted[s.i] ? ic("check", "qr-ic--sm") : `<span style="width:7px"></span>`}<span class="qr-item__name"><b style="font-weight:600" class="tc">${s.code}</b> <span class="muted">${esc(firstWords(s.id, 3))}…</span></span><span class="qr-item__meta">${Math.round(s.conf * 100)}%</span></button>`;
    return `<div class="st-left__body">${S.synced ? `<p class="pn-h">${n ? `${n} dari ${SEGS.length} perlu ditinjau` : "Semua segmen sudah ditinjau"}</p><span class="qr-progress" style="--v:${ok / SEGS.length};margin:0 6px 8px"></span>` : `<p class="pn-h">Segmen</p>`}
      ${S.syncRun ? `<div class="qr-empty" style="padding:24px 8px"><span class="qr-spin"></span><span>Menunggu hasil sinkron…</span></div>` : !S.synced ? `<div class="qr-empty" style="padding:24px 8px">${ic("audio-waveform")}<span>Belum ada segmen. Tekan Sinkronkan di langkah Sumber.</span></div>` : SEGS.map(row).join("")}
      <details class="qr-group" style="padding:0;border:0;margin-top:8px"><summary style="padding:6px">${ic("chevron-down", "qr-ic--sm")}Pengaturan deteksi</summary><div class="qr-prop" style="padding:0 6px"><span class="qr-prop__label" style="width:auto;flex:1">Kunci rentang ayat</span><input type="checkbox" role="switch" class="qr-switch" aria-label="Kunci rentang ayat"></div><div class="qr-prop" style="padding:0 6px"><span class="qr-prop__label" style="width:auto;flex:1">Tingkat model</span><span class="qr-field" style="height:24px"><select aria-label="Tingkat model"><option>Standar</option><option>Akurat</option></select></span></div></details></div>
      <div class="st-left__foot">${S.guide && S.synced && n ? `<div class="qr-guide" style="bottom:calc(100% - 4px);left:12px" role="note"><span class="qr-guide__title">Mulai dari yang ragu</span><span>Tekan N untuk lompat ke segmen berkeyakinan rendah, lalu Enter bila sudah benar.</span><span class="qr-guide__actions"><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="guide-off">Matikan panduan</button></span></div>` : ""}
      <div class="grid-2"><button class="qr-btn qr-btn--secondary" data-act="accept"${S.synced && !S.syncRun ? "" : " disabled"}>Terima ${kbd("↵")}</button><button class="qr-btn qr-btn--secondary" data-act="next-review"${n ? "" : " disabled"}>Berikutnya ${kbd("N")}</button></div></div>`;
  }
  if (S.step === 3) {
    const lay = (k, nm, i) => `<div class="layer-row">${ic(i)}<span class="nm">${nm}</span><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" data-act="layer" data-arg="${k}" aria-pressed="${S.layers[k]}" aria-label="${S.layers[k] ? "Sembunyikan" : "Tampilkan"} ${nm}">${ic(S.layers[k] ? "eye" : "eye-off", "qr-ic--sm")}</button></div>`;
    return `<div class="st-left__body"><p class="pn-h" style="display:flex;justify-content:space-between;align-items:center">Templat<button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="templates">Lihat semua…</button></p><div class="tpl-mini">${TEMPLATES.map(tplCard).join("")}</div>
      <p class="pn-h">Lapisan</p>${lay("ayat", "Ayat", "type")}${lay("tr", "Terjemahan Kemenag", "languages")}${lay("surah", "Nama surah", "book-open")}${lay("qari", "Nama qari", "type")}</div>
      <div class="st-left__foot"><button class="qr-btn qr-btn--secondary" data-act="noop" data-arg="Terapkan gaya ke semua klip">Terapkan ke semua klip</button></div>`;
  }
  return `<div class="st-left__body"><p class="pn-h">Preset platform</p>${PRESETS.map((p) => `<label class="qr-opt" style="margin-bottom:6px"><input type="radio" name="preset" class="qr-radio" value="${p.id}" data-bind="preset"${S.preset === p.id ? " checked" : ""}><span>${p.name}<small>${p.meta}</small></span></label>`).join("")}
    ${presetWarn()}<p class="pn-h">Paket unggah</p><div class="qr-item">${ic("file-output")}<span class="qr-item__name">…credits.txt</span></div><div class="qr-item">${ic("file-output")}<span class="qr-item__name">…upload.txt</span></div><p class="pn-note">Dibuat otomatis di samping video. Atribusi tidak bisa dimatikan.</p></div>`;
}
function presetWarn() {
  const p = PRESETS.find((x) => x.id === S.preset);
  if (p.ar !== "9:16") return `<div class="qr-alert qr-alert--warning" role="status" style="margin-top:6px">${ic("triangle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">Rasio berbeda</span><span class="qr-alert__body">Proyek berukuran 9:16, preset ini 16:9. Tambahkan rasio 16:9 di langkah Tampilan.</span></div></div>`;
  return TOTAL > p.max ? `<div class="qr-alert qr-alert--warning" role="status">${ic("triangle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">Durasi melebihi batas</span></div></div>` : "";
}
function tplCard(t) {
  return `<button class="qr-tpl" data-act="tpl" data-arg="${t.id}" aria-pressed="${S.template === t.id}" aria-label="${t.name}: ${t.meta}" title="${t.name}"><div class="cv cv-prev tpl-${t.id}" aria-hidden="true">${cvInner(SEGS[4], -1, { prev: true })}</div><span><span class="qr-tpl__name">${t.name}</span><span class="qr-tpl__meta">${t.meta}</span></span></button>`;
}

/* kanvas */
function cvInner(seg, wi, o = {}) {
  return `<div class="cv-in">${cvBody(seg, wi, o)}</div>`;
}
function cvBody(seg, wi, o = {}) {
  if (!seg) return `<span class="blank">${S.synced || o.prev ? "Tidak ada ayat di posisi ini" : "Ayat tampil setelah sinkron"}</span>${S.safe && !o.prev ? `<div class="safe" aria-hidden="true"></div>` : ""}`;
  const L = S.layers;
  const words = seg.words.map((w, k) => `<span class="w${k === wi ? " on" : ""}">${esc(w)}</span>`).join(" ");
  return `${L.surah ? `<span class="surah" lang="ar" dir="rtl">الفاتحة</span>` : ""}${L.ayat ? `<p class="ayah" lang="ar" dir="rtl">${words}</p>` : ""}${L.tr ? `<p class="tr">${esc(seg.id)}</p>` : ""}<p class="src">Al-Fatihah · ${seg.a}</p>${L.qari ? `<span class="qari">Qari contoh</span>` : ""}${S.safe && !o.prev ? `<div class="safe" aria-hidden="true"></div>` : ""}`;
}
function paintCanvas() {
  const el = $(".cv.in-viewer");
  if (!el) return;
  const i = S.synced ? segAt(S.t) : -1;
  el.innerHTML = cvInner(SEGS[i], i >= 0 ? wordAt(SEGS[i], S.t) : -1);
}
function viewer() {
  const i = S.synced ? segAt(S.t) : -1, seg = SEGS[i];
  return `<section class="st-viewer" aria-label="Pratinjau">
    <div class="vw-bar"><span class="vw-ctl">Pas layar · 64%${ic("chevron-down", "qr-ic--sm")}</span><span class="vw-ctl">9:16 · 1080×1920</span><span class="spacer"></span><button class="vw-ctl" data-act="safe" aria-pressed="${S.safe}">${ic("scan", "qr-ic--sm")}Area aman</button></div>
    <div class="cv in-viewer tpl-${S.template}${S.missing ? " no-media" : ""}" role="img" aria-label="Pratinjau video, ayat ${seg ? seg.code : ""}">${cvInner(seg, seg ? wordAt(seg, S.t) : -1)}</div>
    <div class="transport-row"><span class="qr-transport"><button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="seek0" aria-label="Ke awal">${ic("skip-back")}</button><button class="qr-play" data-act="play" aria-label="${S.playing ? "Jeda" : "Putar"}">${ic(S.playing ? "pause" : "play")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="frame" aria-label="Maju satu frame">${ic("step-forward")}</button><span class="qr-tc" data-tc>${fmt(S.t)}</span><span class="qr-tc qr-tc--dim">/ ${fmt(TOTAL)}</span></span></div></section>`;
}

/* inspector */
const stepper = (v, lbl) => `<span class="qr-field qr-stepper" style="width:100%;max-width:136px;height:24px"><input value="${v}" aria-label="${lbl}"><span class="qr-stepper__btns"><button aria-label="Naik">${ic("chevron-up")}</button><button aria-label="Turun">${ic("chevron-down")}</button></span></span>`;
const group = (t, body, open = true) => `<details class="qr-group"${open ? " open" : ""}><summary>${ic("chevron-down", "qr-ic--sm")}${t}</summary>${body}</details>`;
const prop = (l, c, cls = "") => `<div class="qr-prop ${cls}"><span class="qr-prop__label">${l}</span>${c}</div>`;
function inspector() {
  const s = SEGS[S.sel];
  if (S.step === 1) return `<div class="qr-panel__head" style="border-radius:0"><span class="qr-panel__title">Aset: fatihah-studio.m4a</span></div>
    ${group("Potong", prop("Masuk", stepper("00:00:00:00", "Masuk")) + prop("Keluar", stepper("00:00:47:15", "Keluar")))}
    ${group("Suara", prop("Penguatan", `<input type="range" class="qr-slider" min="-60" max="12" value="${S.gain}" style="--v:${(S.gain + 60) / 72};width:96px" data-bind="gain" aria-label="Penguatan"><span class="qr-tc" data-gainv style="width:44px;text-align:right">${S.gain > 0 ? "+" : ""}${S.gain} dB</span>`, "is-overridden") + prop("Normalisasi", `<input type="checkbox" role="switch" class="qr-switch" checked aria-label="Normalisasi loudness">`) + prop("Target", `<span class="qr-field" style="height:24px"><select aria-label="Target loudness"><option>−16 LUFS</option><option>−14 LUFS</option></select></span>`) + prop("Fade masuk", stepper("00:00:00:10", "Fade masuk")) + prop("Fade keluar", stepper("00:00:00:15", "Fade keluar")))}`;
  if (S.step === 2) {
    if (!S.synced) return `<div class="insp-empty">${S.syncRun ? "Hasil sinkron akan muncul di sini." : "Belum ada segmen untuk diperiksa."}</div>`;
    const danger = S.conflict && S.sel === 6;
    return `<div class="qr-panel__head" style="border-radius:0"><span class="qr-panel__title">Segmen ${s.code}</span><span class="qr-panel__actions">${needsReview(s) ? badge("warning", `Keyakinan ${Math.round(s.conf * 100)}%`) : badge("success", S.accepted[s.i] ? "Diterima" : `Keyakinan ${Math.round(s.conf * 100)}%`)}</span></div>
    ${danger ? `<div class="qr-alert qr-alert--danger" role="alert" style="margin:12px">${ic("circle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">Segmen ini memotong kata</span><span class="qr-alert__body">Berakhir di tengah ${ayahEl((s.words[3] || s.words[2]).split(" ")[0], "ayah-inline")}. Ekspor ditolak sampai batasnya dibetulkan.</span></div><span class="qr-alert__actions" style="margin-left:0"><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="fix">Geser akhir ke batas kata</button></span></div>` : ""}
    ${group("Waktu", prop("Mulai", stepper(fmt(s.start), "Mulai")) + prop("Selesai", stepper(fmt(s.end), "Selesai")))}
    ${group("Ayat", prop("Surah", `<span class="qr-field" style="height:24px"><span>Al-Fatihah ${s.a}</span></span>`) + prop("Kata", `<span>1–${s.words.length} dari ${s.words.length}</span>`) + prop("Jenis", `<span class="qr-field" style="height:24px"><select aria-label="Jenis segmen"><option>Ayat</option><option>Basmalah</option><option>Isti'adzah</option><option>Takbir</option></select></span>`) + `<div class="verse-box" style="margin-top:6px"><span class="ayah" lang="ar" dir="rtl">${esc(s.ar)}</span><span class="tr">${esc(s.id)}</span><span class="qr-help">${ic("lock", "qr-ic--sm")}Teks Arab dari dataset tidak bisa diketik ulang.</span></div><div style="display:flex;gap:6px;margin-top:8px"><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Ganti ayat lewat pencarian">Ganti ayat…</button><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Belah segmen di batas kata">Belah ${kbd("S")}</button></div>`)}`;
  }
  if (S.step === 3) return `<div class="qr-panel__head" style="border-radius:0"><span class="qr-panel__title">Gaya segmen ${s.code}</span><span class="qr-panel__actions"><button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label="Kembalikan ke templat" data-act="noop" data-arg="Kembalikan ke templat">${ic("rotate-ccw", "qr-ic--sm")}</button></span></div>
    ${group("Teks ayat", prop("Font", `<span class="qr-field" style="height:24px"><select aria-label="Font ayat"><option>LPMQ</option><option disabled>Amiri (glyph tidak lengkap)</option></select></span>`) + prop("Ukuran", `<input type="range" class="qr-slider" style="--v:0.58;width:84px" value="58" aria-label="Ukuran"><span class="qr-tc">64</span><button class="qr-kf" aria-pressed="false" aria-label="Tambah keyframe ukuran">${ic("diamond", "qr-ic--sm")}</button>`, "is-overridden") + prop("Sorotan kata", `<span class="qr-field" style="height:24px"><select aria-label="Sorotan kata"><option>Bertahap</option><option>Garis bawah</option><option>Latar</option></select></span>`))}
    ${group("Animasi", prop("Masuk", `<span class="qr-field" style="height:24px"><select aria-label="Animasi masuk"><option>Pudar</option><option>Geser</option><option>Skala</option></select></span>`) + prop("Durasi", stepper("320 ms", "Durasi animasi")))}
    ${group("Tampilan", prop("Area aman", `<input type="checkbox" role="switch" class="qr-switch" ${S.safe ? "checked" : ""} data-act="safe" aria-label="Area aman">`) + prop("Peredup latar", `<input type="range" class="qr-slider" style="--v:0.6;width:84px" value="60" aria-label="Peredup latar"><span class="qr-tc">60%</span>`))}
    ${group("Asal gaya", `<span class="qr-plies"><span class="qr-ply">Templat</span><span class="qr-ply">Proyek</span><span class="qr-ply is-top">Klip</span></span>`)}`;
  const pr = PRESETS.find((x) => x.id === S.preset);
  return `<div class="qr-panel__head" style="border-radius:0"><span class="qr-panel__title">Ringkasan keluaran</span></div>
    ${group("Keluaran", `<dl class="sum" style="padding:4px 0"><dt>Preset</dt><dd>${pr.name}</dd><dt>Ukuran</dt><dd>1080 × 1920 · 30 fps</dd><dt>Durasi</dt><dd>${mmss(TOTAL)}</dd><dt>Perkiraan</dt><dd>±14 MB</dd></dl>`)}
    ${group("Atribusi (otomatis)", `<ul class="attrib"><li>Teks: Kemenag RI, Mushaf Standar Indonesia</li><li>Terjemahan: Kemenag RI</li><li>Font: LPMQ</li></ul>`)}
    <div style="padding:12px"><button class="qr-btn qr-btn--secondary" style="width:100%" data-act="export">Buka lembar ekspor</button></div>${S.conflict ? `<div class="qr-alert qr-alert--danger" role="alert" style="margin:0 12px 12px">${ic("circle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">1 masalah menghalangi ekspor</span></div></div>` : ""}`;
}

/* timeline */
function timeline() {
  const L = (cls, name, ic1, ic2, body, focus) => `<div class="qr-track ${cls}${focus ? " is-hot" : ""}"><div class="qr-track__head"><span>${name}</span>${ic1}${ic2}</div><div class="qr-lane">${body}</div></div>`;
  const eye = `<button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Tampilkan" aria-pressed="false">${ic("eye", "qr-ic--sm")}</button>`, lock = `<button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Kunci" aria-pressed="false">${ic("lock-open", "qr-ic--sm")}</button>`, vol = `<button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Bisukan" aria-pressed="false">${ic("volume-2", "qr-ic--sm")}</button>`;
  const hint = (t) => `<div class="lane-hint">${t}</div>`;
  const segs = !S.synced ? hint(S.syncRun ? "Mengenali ayat…" : "Belum disinkron. Tekan Sinkronkan di langkah Sumber.") : SEGS.map((s) => `<button class="qr-clip${S.sel === s.i ? " is-selected" : ""}${needsReview(s) ? " is-review" : ""}${S.conflict && s.i === 6 ? " is-danger is-review" : ""}${S.syncRun ? " is-locked" : ""}" data-act="sel" data-arg="${s.i}" style="--words:${s.words.length};left:${pct(s.start)}%;width:${pct(s.end - s.start)}%" aria-label="Segmen ${s.code}${needsReview(s) ? ", perlu ditinjau" : ""}">${needsReview(s) || (S.conflict && s.i === 6) ? `<span class="qr-dot"></span>` : ""}<span class="qr-clip__label">${s.code}</span>${S.sel === s.i && !needsReview(s) ? s.words.slice(1).map((_, k) => `<i class="qr-wdiv" aria-hidden="true" style="left:${((k + 1) / s.words.length) * 100}%"></i>`).join("") : ""}${needsReview(s) ? `<span class="qr-clip__tag">${Math.round(s.conf * 100)}%</span>` : ""}</button>`).join("");
  const trs = !S.synced ? "" : SEGS.map((s) => `<div class="qr-clip qr-clip--tr" style="left:${pct(s.start)}%;width:${pct(s.end - s.start)}%"><span class="qr-clip__label">${esc(firstWords(s.id, 4))}…</span></div>`).join("");
  const wave = (() => { let seed = 7, b = ""; const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280); for (let i = 0; i < 120; i++) b += `<i style="height:${Math.max(10, Math.round((0.35 + 0.65 * Math.abs(Math.sin(i / 9))) * (0.45 + 0.55 * r()) * 100))}%"></i>`; return `<span class="qr-wave" aria-hidden="true">${b}</span>`; })();
  const f2 = S.step === 2 || S.step === 3;
  return `<div class="qr-tl" data-step="${S.step}"><div class="tl-bar"><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-pressed="true" aria-label="Pilih">${ic("mouse-pointer-2")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-label="Potong" data-act="noop" data-arg="Alat potong">${ic("scissors")}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" aria-pressed="true" aria-label="Magnet">${ic("magnet")}</button>
    <span class="tl-zoom">${ic("zoom-out", "qr-ic--sm")}<input type="range" class="qr-slider" style="--v:0.4;width:100%" value="40" aria-label="Zoom timeline">${ic("zoom-in", "qr-ic--sm")}</span></div>
    <div class="tl-body"><div class="qr-tl__ruler" data-act="seek" role="slider" aria-label="Posisi" aria-valuemin="0" aria-valuemax="${TOTAL}" aria-valuenow="${S.t.toFixed(1)}"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span></div>
      ${L("", "Latar", eye, lock, S.missing ? `<div class="qr-clip is-missing" style="left:0;width:100%">${ic("triangle-alert", "qr-ic--sm")}<span class="qr-clip__label">latar-subuh.mp4 · tidak ditemukan</span></div>` : `<div class="qr-clip qr-clip--film" style="left:0;width:100%"><span class="qr-clip__label qr-clip__chip">latar-subuh.mp4</span></div>`, S.step === 1)}
      ${L("", "Audio", vol, lock, S.missing ? `<div class="qr-clip is-missing" style="left:0;width:100%">${ic("triangle-alert", "qr-ic--sm")}<span class="qr-clip__label">fatihah-studio.m4a · tidak ditemukan</span></div>` : `<div class="qr-clip${S.step === 1 ? " is-selected" : ""}" style="left:0;width:100%">${wave}<span class="qr-clip__label qr-clip__chip">fatihah-studio.m4a</span></div>`, S.step === 1)}
      ${L("", "Ayat", eye, lock, segs, f2)}${L("", "Terjemahan", eye, "", trs, f2)}
      ${L("", "Overlay", eye, lock, S.layers.qari ? `<div class="qr-clip" style="left:0;width:100%"><span class="qr-clip__label">Nama qari · Qari contoh</span></div>` : "", S.step === 3)}
      <div class="tl-lanes" aria-hidden="true"><div class="qr-playhead" data-playhead style="left:${pct(S.t)}%"><span class="qr-playhead__tc" data-pht>${fmt(S.t).slice(3)}</span></div></div></div></div>`;
}

/* ——— Lapisan (lembar, panel geser) ——— */
const sheet = (title, body, foot, { w = 560, split = false } = {}) =>
  `<div class="qr-scrim-fixed" data-scrim><div class="qr-sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title" style="--sheet-w:${w}px"><div class="qr-sheet__head"><h2 class="qr-sheet__title" id="sh-title">${title}</h2><button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="close" aria-label="Tutup">${ic("x")}</button></div>${body}<div class="qr-sheet__foot">${foot}</div></div></div>`;
const body = (h) => `<div class="qr-sheet__body">${h}</div>`;
const field = (v, ph = "", extra = "") => `<span class="qr-field"><input value="${esc(v)}" placeholder="${esc(ph)}" ${extra}></span>`;
const sel = (opts, cur) => `<span class="qr-field"><select>${opts.map((o) => `<option${o === cur ? " selected" : ""}>${o}</option>`).join("")}</select></span>`;
const frow = (l, c, cls = "") => `<div class="field-row ${cls}"><span class="lbl">${l}</span>${c}</div>`;
const check = (st, title, detail, act = "", code = "") => `<div class="qr-check-row is-${st}"${code ? ` title="Dasar: ${code}"` : ""}>${ic(st === "ok" ? "circle-check" : st === "warn" ? "triangle-alert" : "circle-alert")}<div><span class="qr-check-row__title">${title}</span><span class="qr-check-row__detail" style="display:block">${detail}</span></div>${act}</div>`;

function layerNew() {
  return sheet("Proyek baru", body(`
    <div class="file-chip">${ic("audio-waveform")}<span><span class="nm">fatihah-studio.m4a</span><span class="muted" style="display:block;font-size:var(--fs-12)">0:47 · 12 MB · terdeteksi ±1 qari</span></span><span class="spacer"></span><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Ganti file">Ganti</button></div>
    ${frow("Nama", field("Al-Fatihah"))}${frow("Qari", field("Qari contoh", "Nama qari (untuk atribusi)"))}
    ${frow("Rentang ayat", `<div class="stack-8"><div class="qr-seg" role="radiogroup" aria-label="Rentang ayat"><button role="radio" aria-checked="true">Deteksi otomatis</button><button role="radio" aria-checked="false">Kunci rentang</button></div><span class="qr-help">Kosongkan bila belum tahu. Mengunci rentang membuat sinkron lebih akurat.</span></div>`, "top")}
    ${frow("Rasio", `<div class="qr-seg" role="radiogroup" aria-label="Rasio"><button role="radio" aria-checked="true">9:16</button><button role="radio" aria-checked="false">16:9</button><button role="radio" aria-checked="false">1:1</button><button role="radio" aria-checked="false">4:5</button></div>`)}
    ${frow("Templat", sel(["Subuh", "Hening", "Terang", "Besar"], "Subuh"))}
    ${frow("Terjemahan", `<div class="stack-8"><label class="qr-choice"><input type="checkbox" class="qr-check" checked>Terjemahan Kemenag RI</label><label class="qr-choice ${S.saheeh === "done" ? "" : "is-disabled"}"><input type="checkbox" class="qr-check" ${S.saheeh === "done" ? "" : "disabled"}>Saheeh International ${S.saheeh === "done" ? "" : `<span class="muted">(belum terpasang)</span>`}</label></div>`, "top")}
    ${frow("Folder", `<span class="qr-field"><input value="~/QuranRender/Projects" aria-label="Folder"><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Pilih folder">Ubah…</button></span>`)}`),
    `<button class="qr-btn qr-btn--secondary" data-act="close">Batal</button><button class="qr-btn qr-btn--secondary" data-act="create-only">Buat tanpa sinkron</button><button class="qr-btn qr-btn--primary" data-act="create-sync" data-autofocus>Buat dan sinkronkan</button>`, { w: 560 });
}

function layerExport() {
  const n = reviewCount(), blocked = S.conflict, pr = PRESETS.find((p) => p.id === S.preset);
  const checks = check("ok", "Data Al-Qur'an terverifikasi", "Kemenag, Mushaf Standar Indonesia v1.0.0 · checksum cocok", "", "CNT-2")
    + check("ok", "Semua aset ditemukan", "2 berkas, hash sesuai")
    + (blocked ? check("fail", "Segmen 1:7 memotong sebuah kata", `Berakhir di tengah ${ayahEl(SEGS[6].words[3].split(" ")[0], "ayah-inline")}. Geser batas ke batas kata terdekat.`, `<button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="fix-issues">Tampilkan segmen</button>`) : check("ok", "Teks Arab utuh per kata", "Semua segmen berupa rentang kata yang utuh", "", "CNT-1"))
    + check("ok", "Font mencakup semua glyph", "LPMQ · 74 dari 74 karakter dataset", "", "CNT-5")
    + check("ok", "Atribusi lengkap", "Teks Qur'an, terjemahan Kemenag, qari, font", "", "CNT-3")
    + (n ? check("warn", `${n} segmen belum ditinjau`, "Keyakinan sinkron rendah. Tidak memblokir ekspor.", `<button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="fix-issues" data-arg="review">Tinjau</button>`) : "");
  return sheet("Ekspor", body(`
    <section class="qr-section"><h3 class="qr-section__title">Pemeriksaan</h3><div>${checks}</div></section>
    <section class="qr-section"><h3 class="qr-section__title">Keluaran</h3>${frow("Preset", `<span class="qr-field"><select data-bind="preset" aria-label="Preset">${PRESETS.map((p) => `<option value="${p.id}"${S.preset === p.id ? " selected" : ""}>${p.name} · ${p.meta}</option>`).join("")}</select></span>`)}
      ${pr.ar !== "9:16" ? `<div class="qr-alert qr-alert--warning" role="status">${ic("triangle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">Rasio berbeda dari proyek</span><span class="qr-alert__body">Proyek 9:16, preset 16:9. Video akan diberi bingkai.</span></div></div>` : ""}
      <div class="grid-2">${frow("Resolusi", sel(["1080 × 1920", "720 × 1280", "1440 × 2560"], "1080 × 1920"), "")}${frow("Frame rate", sel(["30 fps", "24 fps", "60 fps"], "30 fps"))}</div>
      ${frow("Encoder", `<span class="qr-field is-disabled" style="background:var(--bg-sunken)"><span>H.264 · VideoToolbox (otomatis, cadangan: software)</span></span>`)}
      ${frow("Nama berkas", field("Al-Fatihah (Qari contoh) - 1.1-7"))}${frow("Folder", `<span class="qr-field"><input value="~/Movies/QuranRender" aria-label="Folder"><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Pilih folder">Ubah…</button></span>`)}
      <div style="display:flex;gap:20px;flex-wrap:wrap"><label class="qr-choice"><input type="checkbox" class="qr-check" checked>Subtitle SRT</label><label class="qr-choice"><input type="checkbox" class="qr-check">Subtitle VTT</label><label class="qr-choice"><input type="checkbox" class="qr-check">Latar transparan</label></div></section>
    <section class="qr-section"><h3 class="qr-section__title">Ringkasan</h3><dl class="sum"><dt>Durasi</dt><dd>${mmss(TOTAL)}</dd><dt>Perkiraan ukuran</dt><dd>±14 MB</dd><dt>Atribusi ditulis ke</dt><dd>…credits.txt, …upload.txt</dd></dl></section>`),
    `<span class="qr-sheet__note">${blocked ? "Ekspor belum bisa dilanjutkan sampai masalah ini diperbaiki." : "Atribusi dibuat otomatis dan tidak bisa dimatikan."}</span><button class="qr-btn qr-btn--secondary" data-act="close">Batal</button>${blocked ? `<button class="qr-btn qr-btn--primary" data-act="fix-issues" data-autofocus>Perbaiki masalah</button>` : `<button class="qr-btn qr-btn--primary" data-act="export-go" data-autofocus>${ic("file-output")}Ekspor</button>`}`, { w: 600 });
}

const copyBox = (id, label, text) => `<div class="qr-copy"><span class="qr-label">${label}</span><div class="qr-copy__box"><pre class="qr-copy__text" id="cp-${id}">${esc(text)}</pre><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="copy" data-arg="${id}">${ic("copy", "qr-ic--sm")}Salin</button></div></div>`;
function layerUpload() {
  const pr = PRESETS.find((p) => p.id === S.preset);
  return sheet("Siap unggah", body(`
    <div class="file-chip">${ic("film")}<span><span class="nm">Al-Fatihah (Qari contoh) - 1.1-7.mp4</span><span class="muted" style="display:block;font-size:var(--fs-12)">${mmss(TOTAL)} · 1080 × 1920 · 14 MB</span></span><span class="spacer"></span><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Buka folder">${ic("folder-open", "qr-ic--sm")}Buka folder</button><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Putar video">${ic("play", "qr-ic--sm")}Putar</button></div>
    <div class="qr-alert qr-alert--success" role="status">${ic("circle-check")}<div class="qr-alert__content"><span class="qr-alert__title">Durasi sesuai batas ${pr.name}</span><span class="qr-alert__body">${Math.floor(TOTAL)} detik dari maksimal ${pr.max} detik.</span></div></div>
    <p class="muted" style="margin:0">Unggah file ini dari akun Anda. Teks di bawah sudah siap ditempel.</p>
    ${copyBox("t", "Judul", "Al-Fatihah 1–7 | Qari contoh | Tilawah dengan terjemahan")}
    ${copyBox("d", "Deskripsi", "Al-Fatihah ayat 1–7, dibacakan oleh Qari contoh.\n\nTeks Al-Qur'an: Kemenag RI, Mushaf Standar Indonesia.\nTerjemahan: Terjemahan Kemenag RI.\nFont: LPMQ.")}
    ${copyBox("h", "Tagar", "#Quran #AlFatihah #Tilawah")}
    ${copyBox("c", "Bab YouTube", "00:00 Al-Fatihah 1–7")}`),
    `<button class="qr-btn qr-btn--primary" data-act="close" data-autofocus>Selesai</button>`, { w: 620 });
}

/* pecah klip */
function batchGroups() {
  const b = S.batch, g = [];
  const push = (a, z) => { const s0 = SEGS[a], s1 = SEGS[z]; g.push({ a, z, start: s0.start, end: s1.end, dur: s1.end - s0.start, label: a === z ? `1:${a + 1}` : `1:${a + 1}–${z + 1}`, title: `Al-Fatihah ${a === z ? a + 1 : `${a + 1}–${z + 1}`}`, bad: S.conflict && z === 6, warn: SEGS.slice(a, z + 1).some(needsReview) }); };
  if (b.method === "n") for (let i = 0; i < 7; i += b.n) push(i, Math.min(6, i + b.n - 1));
  else if (b.method === "dur") { let a = 0; for (let i = 0; i < 7; i++) { if (SEGS[i].end - SEGS[a].start > b.dur && i > a) { push(a, i - 1); a = i; } } push(a, 6); }
  else if (b.method === "mark") { push(0, 2); push(3, 4); push(5, 6); }
  else { let a = -1; b.pick.forEach((p, i) => { if (p && a < 0) a = i; if ((!p || i === 6) && a >= 0) { push(a, p ? i : i - 1); a = -1; } }); }
  return g;
}
function layerBatch() {
  const b = S.batch, g = batchGroups(), steps = ["Cara memecah", "Daftar klip", "Keluaran", "Mulai"];
  const stepper2 = `<div class="batch-steps"><ol class="qr-flow" aria-label="Langkah">${steps.map((n, i) => `<li class="${i + 1 === b.step ? "is-current" : i + 1 < b.step ? "is-done" : ""}"${i + 1 === b.step ? ' aria-current="step"' : ""}>${i ? `<span class="qr-flow__sep" aria-hidden="true">${ic("chevron-right", "qr-ic--sm")}</span>` : ""}<span class="qr-flow__n">${i + 1 < b.step ? ic("check", "qr-ic--sm") : i + 1}</span>${n}</li>`).join("")}</ol></div>`;
  const prev = `<div class="range-prev" aria-label="Pratinjau pembagian">${g.map((x) => `<i style="left:${pct(x.start)}%;width:${pct(x.dur)}%" class="tc">${x.label}</i>`).join("")}</div>`;
  let main = "";
  if (b.step === 1) main = `<div class="qr-section">${[["n", "Per jumlah ayat", `<span class="qr-field" style="width:84px;height:24px"><select data-bind="batch.n" aria-label="Jumlah ayat">${[1, 2, 3, 4].map((x) => `<option${b.n === x ? " selected" : ""}>${x}</option>`).join("")}</select></span>`], ["dur", "Per durasi maksimum", `<span class="qr-field" style="width:96px;height:24px"><select data-bind="batch.dur" aria-label="Durasi">${[15, 30, 45, 60].map((x) => `<option value="${x}"${b.dur === x ? " selected" : ""}>${x} dtk</option>`).join("")}</select></span>`], ["mark", "Per penanda", `<span class="muted tc">2 penanda</span>`], ["manual", "Pilih manual", `<span class="muted">${b.pick.filter(Boolean).length} segmen dipilih</span>`]].map(([id, l, x]) => `<label class="qr-opt"><input type="radio" name="bm" class="qr-radio" value="${id}" data-bind="batch.method"${b.method === id ? " checked" : ""}><span>${l}</span>${x}</label>`).join("")}</div>
    ${b.method === "manual" ? `<div class="chips">${SEGS.map((s, i) => `<label class="qr-choice"><input type="checkbox" class="qr-check" data-bind="batch.pick.${i}"${b.pick[i] ? " checked" : ""}>${s.code}</label>`).join("")}</div>` : ""}<div class="qr-section"><h3 class="qr-section__title">Pratinjau di timeline</h3>${prev}</div>`;
  if (b.step === 2) main = `<div class="qr-section"><label class="qr-label" for="ttl">Pola judul</label>${field("{surah_name} {ayah_range} ({reciter})", "", 'id="ttl"')}<span class="qr-help">Variabel: {surah_name} {ayah_range} {reciter} {translation_credit}</span></div>
    <table class="qr-tbl"><thead><tr><th>#</th><th>Judul</th><th>Rentang</th><th class="num">Durasi</th><th></th></tr></thead><tbody>${g.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${x.title} (Qari contoh)</td><td class="num">${x.label}</td><td class="num">${mmss(x.dur)}</td><td>${x.bad ? badge("danger", "Perlu diperbaiki") : x.warn ? badge("warning", "Belum ditinjau") : ""}</td></tr>`).join("")}</tbody></table>`;
  if (b.step === 3) main = `${frow("Templat", sel(["Subuh", "Hening", "Terang", "Besar"], "Subuh"))}${frow("Preset", sel(PRESETS.map((p) => p.name), "YouTube Shorts"))}${frow("Rasio", `<div class="qr-seg" role="radiogroup" aria-label="Rasio"><button role="radio" aria-checked="true">9:16</button><button role="radio" aria-checked="false">1:1</button></div>`)}${frow("Folder", field("~/Movies/QuranRender/Al-Fatihah"))}<span class="qr-help">Satu pengaturan berlaku untuk semua klip. Atribusi dibuat per klip.</span>`;
  if (b.step === 4) { const ok = g.filter((x) => !x.bad); main = `<div class="qr-alert qr-alert--${g.some((x) => x.bad) ? "warning" : "info"}" role="status">${ic(g.some((x) => x.bad) ? "triangle-alert" : "info")}<div class="qr-alert__content"><span class="qr-alert__title">${ok.length} klip akan masuk antrean</span><span class="qr-alert__body">${g.some((x) => x.bad) ? "1 klip memuat masalah pada teks dan dilewati. Klip lain tidak terpengaruh." : "Klip yang gagal tidak menghentikan antrean."}</span></div></div><ul class="attrib">${g.map((x) => `<li${x.bad ? ' style="text-decoration:line-through"' : ""}>${x.title} · ${mmss(x.dur)}</li>`).join("")}</ul>`; }
  const ok = g.filter((x) => !x.bad).length;
  return sheet("Pecah menjadi klip", body(`${stepper2}${main}`), `${b.step > 1 ? `<button class="qr-btn qr-btn--secondary" data-act="batch-prev">Kembali</button>` : `<button class="qr-btn qr-btn--secondary" data-act="close">Batal</button>`}${b.step < 4 ? `<button class="qr-btn qr-btn--primary" data-act="batch-next" data-autofocus>Lanjut</button>` : `<button class="qr-btn qr-btn--primary" data-act="batch-go" data-autofocus>Mulai ${ok} klip</button>`}`, { w: 640 });
}

/* antrean */
function jobRow(j) {
  const st = { wait: badge("", "Menunggu"), run: badge("accent", `Berjalan ${j.pct}%`) + `<span class="qr-progress" style="--v:${j.pct / 100}"></span>`, pause: badge("", `Dijeda ${j.pct}%`) + `<span class="qr-progress is-paused" style="--v:${j.pct / 100}"></span>`, done: badge("success", "Selesai"), fail: badge("danger", "Gagal"), cancel: badge("plain", "Dibatalkan") }[j.state];
  return `<div class="qr-job${j.state === "cancel" ? " is-canceled" : ""}"><span class="qr-job__code">${j.code}</span><span class="qr-job__title"><span>${j.title}</span><small>${j.sub}</small></span><span class="qr-job__state">${st}</span><span class="qr-job__actions">${JOB_ACT[j.state].map(([op, i, l]) => `<button class="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" data-act="job" data-op="${op}" data-arg="${j.id}" aria-label="${l}" title="${l}">${ic(i, "qr-ic--sm")}</button>`).join("")}</span></div>`;
}
function layerQueue() {
  const grp = (t, st) => { const l = S.jobs.filter((j) => st.includes(j.state)); return l.length ? `<div class="qr-group-label">${t}</div><div class="qr-jobs">${l.map(jobRow).join("")}</div>` : ""; };
  const anyRun = S.jobs.some((j) => j.state === "run");
  return `<aside class="qr-drawer" style="--drawer-top:var(--bar-h)" role="complementary" aria-label="Antrean"><div class="qr-drawer__head"><h2 class="qr-drawer__title">Antrean</h2><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="${anyRun ? "Jeda semua" : "Lanjutkan semua"}">${anyRun ? "Jeda semua" : "Lanjutkan semua"}</button><button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="close" aria-label="Tutup" data-autofocus>${ic("x")}</button></div>
    <div class="qr-drawer__body">${grp("Berjalan", ["run", "pause"])}${grp("Menunggu", ["wait"])}${grp("Selesai", ["done"])}${grp("Gagal dan dibatalkan", ["fail", "cancel"])}</div>
    <div class="qr-drawer__foot"><span class="muted">Antrean tetap tersimpan bila aplikasi ditutup.</span><span class="spacer"></span><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="clear-done">Hapus yang selesai</button></div></aside>`;
}
function layerHistory() {
  const row = (t, s, cur) => `<div class="qr-item${cur ? " is-selected" : ""}" style="height:auto;padding:8px 10px"><span class="qr-item__name"><b style="font-weight:600">${t}</b><span class="muted" style="display:block;font-size:var(--fs-12)">${s}</span></span>${cur ? badge("accent", "Sekarang") : `<button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="restore">Pulihkan</button>`}</div>`;
  return `<aside class="qr-drawer" style="--drawer-top:var(--bar-h);--drawer-w:360px" role="complementary" aria-label="Riwayat versi"><div class="qr-drawer__head"><h2 class="qr-drawer__title">Riwayat versi</h2><button class="qr-btn qr-btn--ghost qr-btn--icon" data-act="close" aria-label="Tutup" data-autofocus>${ic("x")}</button></div>
    <div class="qr-drawer__body" style="padding:8px">${row("Versi sekarang", "7 segmen · diubah beberapa detik lalu", true)}${row("14 menit lalu", "7 segmen · sebelum menggeser batas 1:6")}${row("Hari ini, 19.02", "7 segmen · setelah sinkron selesai")}${row("Hari ini, 18.40", "0 segmen · proyek dibuat")}</div>
    <div class="qr-drawer__foot"><span class="muted">20 versi terakhir disimpan otomatis. Memulihkan membuat versi baru lebih dulu.</span></div></aside>`;
}

/* templat */
function layerTemplates() {
  const rail = (l, a) => `<button class="qr-rail__item" aria-current="${!!a}">${l}</button>`;
  return sheet("Galeri templat", `<div class="qr-split"><nav class="qr-rail" aria-label="Filter templat"><div class="qr-rail__label">Rasio</div>${rail("Semua", 1)}${rail("9:16")}${rail("16:9")}${rail("1:1")}<div class="qr-rail__sep"></div>${rail("Milik saya")}</nav>
    <div class="qr-sheet__body"><div class="tpl-grid">${TEMPLATES.map(tplCard).join("")}
    <button class="qr-tpl" data-act="noop" data-arg="Templat butuh font Noto Naskh"><div class="cv cv-prev tpl-hening" aria-hidden="true">${cvInner(SEGS[4], -1, { prev: true })}</div><span><span class="qr-tpl__name">Papan siaran</span><span class="qr-tpl__meta">${badge("warning", "Font hilang")}</span></span></button>
    <button class="qr-drop qr-empty" data-act="noop" data-arg="Impor templat" style="font:inherit;color:var(--text-2);cursor:pointer">${ic("upload")}<span>Impor .qrtemplate</span></button></div></div></div>`,
    `<span class="qr-sheet__note">Pratinjau memakai Al-Fatihah ayat 5.</span><button class="qr-btn qr-btn--secondary" data-act="noop" data-arg="Duplikat templat">Duplikat</button><button class="qr-btn qr-btn--secondary" data-act="noop" data-arg="Ekspor templat">Ekspor…</button><button class="qr-btn qr-btn--primary" data-act="close" data-autofocus>Terapkan</button>`, { w: 880 });
}

/* pengaturan */
const STABS = [["umum", "settings-2", "Umum"], ["pintasan", "keyboard", "Pintasan"], ["sinkron", "audio-waveform", "Sinkron"], ["ekspor", "file-output", "Ekspor"], ["data", "hard-drive", "Data dan model"], ["font", "type", "Font"], ["kunci", "key-round", "Kunci dan layanan"], ["privasi", "shield-check", "Privasi"], ["tentang", "info", "Tentang"]];
function settingsBody() {
  const t = S.settingsTab, sw = (l, on = false, dis = false) => `<div class="qr-prop"><span class="qr-prop__label" style="width:auto;flex:1">${l}</span><input type="checkbox" role="switch" class="qr-switch" ${on ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${l}"></div>`;
  if (t === "umum") return `<section class="qr-section"><h3 class="qr-section__title">Tampilan</h3>${frow("Bahasa", sel(["Bahasa Indonesia", "English"], "Bahasa Indonesia"))}${frow("Tema", `<div class="qr-seg" role="radiogroup" aria-label="Tema">${[["system", "Sistem"], ["light", "Terang"], ["dark", "Gelap"]].map(([k, l]) => `<button role="radio" aria-checked="${S.theme === k}" data-theme-set="${k}">${l}</button>`).join("")}</div>`)}${frow("Skala UI", `<span class="inline"><input type="range" class="qr-slider" style="--v:0.33;width:160px" value="33" aria-label="Skala UI"><span class="qr-tc">100%</span></span>`)}</section><section class="qr-section"><h3 class="qr-section__title">Proyek</h3>${frow("Folder proyek", `<span class="qr-field"><input value="~/QuranRender/Projects" aria-label="Folder proyek"><button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="noop" data-arg="Pilih folder">Ubah…</button></span>`)}</section>`;
  if (t === "pintasan") return `<table class="qr-tbl"><thead><tr><th>Aksi</th><th style="text-align:right">Pintasan</th></tr></thead><tbody>${[["Putar / jeda", ["Spasi"]], ["Mundur / jeda / maju", ["J", "K", "L"]], ["Belah di playhead", ["S"]], ["Berikutnya perlu ditinjau", ["N"]], ["Terima segmen", ["↵"]], ["Langkah 1–4", [MOD, "1–4"]], ["Palet perintah", [MOD, "K"]], ["Pengaturan", [MOD, ","]], ["Ekspor", ["⇧", MOD, "E"]], ["Antrean", ["⌥", MOD, "Q"]]].map(([a, k]) => `<tr><td>${a}</td><td><span class="shortcut-row">${kbd(...k)}</span></td></tr>`).join("")}</tbody></table>`;
  if (t === "sinkron") return `<section class="qr-section"><h3 class="qr-section__title">Model sinkron</h3>${[["Standar", "Bawaan · aktif", true], ["Akurat", "Lebih lambat, perlu diunduh (ukuran contoh: 640 MB)", false]].map(([n, m, on]) => `<label class="qr-opt"><input type="radio" name="tier" class="qr-radio"${on ? " checked" : ""}><span>${n}<small>${m}</small></span>${on ? badge("success", "Terpasang") : `<button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Unduh model Akurat">Unduh</button>`}</label>`).join("")}</section><section class="qr-section"><h3 class="qr-section__title">Peninjauan</h3>${frow("Ambang tinjau", `<span class="inline"><input type="range" class="qr-slider" style="--v:0.8;width:160px" value="80" aria-label="Ambang"><span class="qr-tc">80%</span></span>`)}<span class="qr-help">Segmen di bawah ambang ditandai untuk ditinjau.</span></section><section class="qr-section"><h3 class="qr-section__title">Server sinkron (opsional)</h3>${frow("Endpoint", field("", "Tidak dikonfigurasi"))}<span class="qr-help">Audio hanya dikirim bila Anda mengisi endpoint sendiri.</span></section>`;
  if (t === "ekspor") return `<section class="qr-section"><h3 class="qr-section__title">Default</h3>${frow("Folder", field("~/Movies/QuranRender"))}${frow("Pola nama", field("{project_name} ({reciter}) - {verse_range}"))}</section><section class="qr-section"><h3 class="qr-section__title">Encoder</h3>${[["H.264 · VideoToolbox", "success", "Tersedia"], ["H.265 · VideoToolbox", "success", "Tersedia"], ["H.264 · libx264 (cadangan)", "success", "Tersedia"]].map(([n, k, v]) => `<div class="edition-row"><span>${n}</span>${badge(k, v)}</div>`).join("")}<button class="qr-btn qr-btn--secondary qr-btn--sm" style="justify-self:start" data-act="noop" data-arg="Uji ulang encoder">Uji ulang</button></section>`;
  if (t === "data") {
    const sa = S.saheeh;
    return `<section class="qr-section"><h3 class="qr-section__title">Data Al-Qur'an</h3><div class="edition-row"><span>Kemenag RI, Mushaf Standar Indonesia<small class="muted" style="display:block;font-size:var(--fs-12)">v1.0.0 · 6.236 ayat · 77.511 kata · checksum cocok</small></span>${badge("success", "Terverifikasi")}</div></section>
    <section class="qr-section"><h3 class="qr-section__title">Edisi terjemahan</h3>
      <div class="edition-row"><span>Terjemahan Kemenag RI<small class="muted" style="display:block;font-size:var(--fs-12)">Indonesia · sudah ada di aplikasi · izin penyertaan sudah diberikan</small></span>${badge("success", "Terpasang")}</div>
      <div class="edition-row"><span>Saheeh International<small class="muted" style="display:block;font-size:var(--fs-12)">Inggris · dari Quran.com · ${sa === "done" ? "6.236 ayat · 1.903 catatan kaki" : sa === "loading" ? `mengunduh ${Math.round(S.saheehPct)}%` : "diunduh atas permintaan Anda"}</small>${sa === "loading" ? `<span class="qr-progress" style="--v:${S.saheehPct / 100};margin-top:6px"></span>` : ""}</span>${sa === "done" ? `<span class="inline">${badge("success", "Terpasang")}<button class="qr-btn qr-btn--ghost qr-btn--sm" data-act="saheeh-del">Hapus</button></span>` : sa === "loading" ? `<button class="qr-btn qr-btn--ghost qr-btn--sm" disabled>Mengunduh…</button>` : `<button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="saheeh-dl">${ic("download", "qr-ic--sm")}Unduh</button>`}</div>
      ${sa === "none" ? `<span class="qr-help">Atribusi (Saheeh International, via Quran.com) otomatis masuk ke paket unggah.</span>` : ""}</section>
    <section class="qr-section"><h3 class="qr-section__title">Penyimpanan</h3><div class="edition-row"><span>Cache pratinjau dan waveform<small class="muted" style="display:block;font-size:var(--fs-12)">Contoh: 1,2 GB. Aman dihapus.</small></span><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Bersihkan cache">Bersihkan</button></div></section>`;
  }
  if (t === "font") return `<p class="muted" style="margin:0">Cakupan dihitung terhadap 74 karakter yang dipakai dataset Kemenag.</p>${[["LPMQ", "Ayat (default)", "Lengkap", "success", `<span class="sample" lang="ar">${esc(SEGS[0].ar)}</span>`], ["Amiri", "Nama surah, Arab di UI", "1 karakter hilang (U+08D6)", "warning", `<span class="sample" style="font-family:var(--font-ar-ui)" lang="ar">الفاتحة · البقرة</span>`], ["me_quran (Uthmanic)", "Cadangan dataset Uthmani", "5 karakter hilang", "warning", ""], ["IndoPak", "Gaya IndoPak, non-ayat", "3 karakter hilang", "warning", ""]].map(([n, r, v, k, s]) => `<div class="font-row"><span>${n}<small class="muted" style="display:block;font-size:var(--fs-12)">${r}</small>${s}</span>${badge(k, v)}<span class="muted">${k === "success" ? "Boleh untuk ayat" : "Tidak untuk ayat"}</span></div>`).join("")}<button class="qr-btn qr-btn--secondary qr-btn--sm" style="justify-self:start" data-act="noop" data-arg="Impor font">${ic("upload", "qr-ic--sm")}Impor font…</button>`;
  if (t === "kunci") return `<p class="muted" style="margin:0">Disimpan di ${IS_MAC ? "Keychain macOS" : "penyimpan kredensial sistem"} dan tidak pernah ditampilkan.</p>${[["Kunci API model bahasa", "Belum diatur"], ["Pexels (stok media)", "Belum diatur"], ["Pixabay (stok media)", "Belum diatur"], ["Hugging Face", "Belum diatur"]].map(([n, v]) => `<div class="edition-row"><span>${n}<small class="muted" style="display:block;font-size:var(--fs-12)">${v}</small></span><button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Tambah kunci">Tambah</button></div>`).join("")}`;
  if (t === "privasi") return `<section class="qr-section">${sw("Kirim laporan crash")}${sw("Kirim statistik pemakaian anonim")}${sw("Telemetri jarak jauh (belum tersedia)", false, true)}</section><p class="muted" style="margin:0">Semuanya mati secara default. Audio dan teks Anda tidak pernah dikirim ke mana pun kecuali ke endpoint yang Anda isi sendiri.</p><button class="qr-btn qr-btn--ghost qr-btn--sm" style="justify-self:start" data-act="noop" data-arg="Pratinjau data yang dikirim">Lihat data yang akan dikirim</button>`;
  return `<section class="qr-section"><dl class="sum"><dt>Versi</dt><dd>0.0.0 (prototipe)</dd><dt>Kanal pembaruan</dt><dd><div class="qr-seg" role="radiogroup" aria-label="Kanal"><button role="radio" aria-checked="true">Stabil</button><button role="radio" aria-checked="false">Beta</button></div></dd><dt>Lisensi</dt><dd>MIT</dd></dl><button class="qr-btn qr-btn--secondary qr-btn--sm" style="justify-self:start" data-act="noop" data-arg="Periksa pembaruan">Periksa pembaruan</button></section><section class="qr-section"><h3 class="qr-section__title">Atribusi</h3><ul class="attrib"><li>Teks dan terjemahan: Kemenag RI, Mushaf Standar Indonesia</li><li>Font: LPMQ, Amiri (SIL OFL), Inter (SIL OFL), Lucide (ISC)</li><li>Foto contoh: “Sunrise 008”, Wikibongmon, CC BY-SA 4.0</li></ul></section>`;
}
function layerSettings() {
  return sheet("Pengaturan", `<div class="qr-split"><nav class="qr-rail" aria-label="Bagian pengaturan">${STABS.map(([k, i, l]) => `<button class="qr-rail__item" data-act="stab" data-arg="${k}" aria-current="${S.settingsTab === k}">${ic(i)}${l}</button>`).join("")}</nav><div class="qr-sheet__body" style="height:460px">${settingsBody()}</div></div>`, `<button class="qr-btn qr-btn--primary" data-act="close" data-autofocus>Selesai</button>`, { w: 820 });
}

/* hubungkan ulang */
function layerRelink() {
  const rows = [["fatihah-studio.m4a", "a3f1…9c2e", "/Volumes/Arsip/Tilawah/", "match"], ["latar-subuh.mp4", "77b0…d41a", "~/Movies/Latar/", "diff"]];
  return sheet("Hubungkan ulang aset", body(`<p class="muted" style="margin:0">Berkas dicocokkan lewat isinya (hash), jadi nama boleh berbeda.</p><table class="qr-tbl"><thead><tr><th>Aset</th><th>Terakhir di</th><th>Hasil</th></tr></thead><tbody>${rows.map(([n, h, p, r]) => `<tr><td>${n}<small class="muted tc" style="display:block">${h}</small></td><td class="muted">${p}</td><td>${S.relinkFound ? (r === "match" ? badge("success", "Cocok") : badge("warning", "Isi berbeda")) : `<button class="qr-btn qr-btn--secondary qr-btn--sm" data-act="noop" data-arg="Pilih berkas">Pilih file…</button>`}</td></tr>`).join("")}</tbody></table>${S.relinkFound ? `<div class="qr-alert qr-alert--warning" role="status">${ic("triangle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">1 berkas berbeda isi</span><span class="qr-alert__body">Waktu sinkron mungkin tidak berlaku untuk berkas ini. Periksa ulang setelah dihubungkan.</span></div></div>` : ""}`),
    `<button class="qr-btn qr-btn--secondary" data-act="close">Batal</button>${S.relinkFound ? `<button class="qr-btn qr-btn--primary" data-act="relink-apply" data-autofocus>Terapkan</button>` : `<button class="qr-btn qr-btn--primary" data-act="relink-find" data-autofocus>${ic("folder-search")}Cari di folder…</button>`}`, { w: 600 });
}

/* pertama kali jalan (S0) dan diagnostik (S15) */
function layerFirst() {
  const st = S.first;
  const b1 = `<p style="margin:0;font-size:var(--fs-14)">Tidak ada akun yang perlu dibuat, dan semuanya berjalan di komputer Anda.</p>
    ${frow("Bahasa", sel(["Otomatis (Bahasa Indonesia)", "Bahasa Indonesia", "English"], "Otomatis (Bahasa Indonesia)"))}
    <div class="qr-alert qr-alert--success" role="status">${ic("circle-check")}<div class="qr-alert__content"><span class="qr-alert__title">Model sinkron Standar sudah terpasang</span><span class="qr-alert__body">Tidak ada yang wajib diunduh. Sinkron bisa langsung dipakai.</span></div></div>
    <div class="qr-alert qr-alert--success" role="status">${ic("circle-check")}<div class="qr-alert__content"><span class="qr-alert__title">Data Al-Qur'an terverifikasi</span><span class="qr-alert__body">Kemenag RI, Mushaf Standar Indonesia v1.0.0 · 6.236 ayat · checksum cocok.</span></div></div>`;
  const b2 = `<p style="margin:0;font-size:var(--fs-14)">Terjemahan Kemenag RI sudah tersedia. Bila Anda juga ingin terjemahan bahasa Inggris, Anda bisa mengunduhnya sekarang atau nanti di Pengaturan.</p>
    <div class="edition-row"><span>Saheeh International<small class="muted" style="display:block;font-size:var(--fs-12)">Inggris · 6.236 ayat · dengan catatan kaki</small></span>${badge("", "Opsional")}</div>
    <p class="qr-help" style="margin:0">Diunduh langsung dari Quran.com atas permintaan Anda. Atribusi (Saheeh International, via Quran.com) otomatis masuk ke paket unggah.</p>`;
  return sheet(st === 1 ? "Selamat datang di QuranRender" : "Terjemahan tambahan", body(st === 1 ? b1 : b2),
    `<span class="qr-sheet__note">Langkah ${st} dari 2</span>${st === 1 ? `<button class="qr-btn qr-btn--ghost" data-act="close">Lewati</button><button class="qr-btn qr-btn--primary" data-act="first-next" data-autofocus>Lanjut</button>` : `<button class="qr-btn qr-btn--secondary" data-act="close">Lewati</button><button class="qr-btn qr-btn--primary" data-act="first-dl" data-autofocus>${ic("download")}Unduh Saheeh International</button>`}`, { w: 520 });
}
function layerDiag() {
  const txt = "QuranRender 0.0.0 (prototipe)\n" + (IS_MAC ? "macOS" : "Sistem operasi") + " · GPU: contoh\nEncoder: H.264 VideoToolbox, gagal (kode -12902)\nProyek: skema 1, 7 segmen, tanpa teks ayat\nLog: 200 baris terakhir, tanpa teks ayat dan tanpa rahasia";
  return sheet("Diagnostik", body(`<div class="qr-alert qr-alert--danger" role="alert">${ic("circle-alert")}<div class="qr-alert__content"><span class="qr-alert__title">Ekspor berhenti: encoder tidak merespons</span><span class="qr-alert__body">Kode <span class="qr-code">E-ENC-104</span>. Proyek Anda aman dan tidak berubah.</span></div></div>
    <section class="qr-section"><h3 class="qr-section__title">Yang bisa dicoba</h3><ol class="attrib" style="padding-left:20px;list-style:decimal"><li>Ekspor ulang dengan encoder software (cadangan) di lembar Ekspor.</li><li>Tutup aplikasi lain yang memakai GPU, lalu coba lagi.</li><li>Bila tetap gagal, salin diagnostik di bawah dan lampirkan di halaman isu.</li></ol></section>
    ${copyBox("g", "Diagnostik (aman dibagikan)", txt)}`),
    `<button class="qr-btn qr-btn--ghost" data-act="noop" data-arg="Buka halaman isu proyek">${ic("external-link")}Buka halaman isu</button><span class="spacer"></span><button class="qr-btn qr-btn--secondary" data-act="close">Tutup</button><button class="qr-btn qr-btn--primary" data-act="copy" data-arg="g" data-autofocus>${ic("copy")}Salin diagnostik</button>`, { w: 560 });
}

/* palet perintah */
function cmds() {
  const go = (n) => () => { S.space = "studio"; S.step = n; };
  const list = [
    ["Alur", "Buka langkah Sumber", "file-input", [MOD, "1"], go(1)], ["Alur", "Buka langkah Sinkron", "audio-waveform", [MOD, "2"], go(2)], ["Alur", "Buka langkah Tampilan", "type", [MOD, "3"], go(3)], ["Alur", "Buka langkah Ekspor", "file-output", [MOD, "4"], go(4)],
    ["Perintah", "Tampilkan antrean", "list-checks", ["⌥", MOD, "Q"], () => (S.layer = "queue")], ["Perintah", "Tampilkan galeri templat", "layout-template", [], () => (S.layer = "templates")], ["Perintah", "Tampilkan area aman", "scan", ["⇧", "A"], () => { S.safe = true; }],
    ["Perintah", "Pecah menjadi klip…", "scissors", [], () => { S.space = "studio"; S.layer = "batch"; S.batch.step = 1; }], ["Perintah", "Ekspor…", "file-output", ["⇧", MOD, "E"], () => { S.space = "studio"; openExport(); }], ["Perintah", "Pengaturan…", "settings-2", [MOD, ","], () => (S.layer = "settings")],
    ["Perintah", "Hubungkan ulang aset…", "link-2", [], () => { S.layer = "relink"; }], ["Perintah", "Riwayat versi", "history", [], () => (S.layer = "history")], ["Perintah", "Buka diagnostik", "bug", [], () => (S.layer = "diag")], ["Perintah", "Kembali ke Beranda", "chevron-left", [], () => { S.space = "home"; }],
  ];
  const items = list.map(([g, t, i, k, run]) => ({ g, t, i, k, run }));
  Object.values(D.surahs).forEach((s) => items.push({ g: "Ayat", t: `Lompat ke ${s.lat} (${s.n} ayat)`, i: "search", ar: s.ar, run: () => { S.space = "studio"; } }));
  const m = S.cmdq.match(/^(\d+):(\d+)$/);
  if (m) items.unshift({ g: "Ayat", t: `Lompat ke ayat ${m[1]}:${m[2]}`, i: "search", run: () => { S.space = "studio"; if (m[1] === "1" && SEGS[m[2] - 1]) { S.step = 2; selectSeg(m[2] - 1); } } });
  const q = S.cmdq.trim().toLowerCase();
  return q ? items.filter((x) => x.t.toLowerCase().includes(q)) : items.slice(0, 9);
}
function cmdList() {
  const l = cmds();
  S.cmdi = Math.min(S.cmdi, Math.max(0, l.length - 1));
  const q = S.cmdq.trim();
  const hl = (t) => { if (!q) return esc(t); const i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`; };
  let g = "";
  return l.length ? l.map((x, n) => `${x.g !== g ? `<div class="qr-cmdk__group">${(g = x.g)}</div>` : ""}<div class="qr-cmdk__item${n === S.cmdi ? " is-active" : ""}" role="option" aria-selected="${n === S.cmdi}" data-act="cmd" data-arg="${n}">${ic(x.i)}<span class="qr-cmdk__label">${hl(x.t)}</span>${x.ar ? `<span class="ar" lang="ar" dir="rtl" style="font-family:var(--font-ar-ui);font-size:var(--fs-16);color:var(--text-2)">${x.ar}</span>` : x.k && x.k.length ? `<span class="qr-cmdk__keys">${kbd(...x.k)}</span>` : ""}</div>`).join("") : `<div class="qr-empty" style="padding:24px">${ic("search")}<span>Tidak ada hasil untuk “${esc(q)}”.</span></div>`;
}
const layerCmdk = () => `<div class="cmdk-wrap" data-scrim><div class="qr-cmdk" role="dialog" aria-modal="true" aria-label="Palet perintah"><div class="qr-cmdk__input">${ic("search")}<input id="cmdq" value="${esc(S.cmdq)}" placeholder="Cari perintah, langkah, atau ayat (mis. 1:5)" autocomplete="off" style="flex:1;border:0;outline:0;background:transparent;color:inherit;font:inherit" data-autofocus aria-label="Cari">${kbd("Esc")}</div><div class="qr-cmdk__list" id="cmdlist" role="listbox">${cmdList()}</div></div></div>`;

/* ——— Render ——— */
let lastLayer = null, noAnim = false;
function render() {
  document.documentElement.dataset.theme = S.theme === "system" ? "" : S.theme;
  if (S.theme === "system") document.documentElement.removeAttribute("data-theme");
  $$("[data-theme-set]", $(".proto-bar")).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeSet === S.theme)));
  const keep = $("#app");
  keep.innerHTML = S.space === "home" ? viewHome() : viewStudio();
  const L = { new: layerNew, export: layerExport, upload: layerUpload, batch: layerBatch, queue: layerQueue, history: layerHistory, templates: layerTemplates, settings: layerSettings, relink: layerRelink, cmdk: layerCmdk, first: layerFirst, diag: layerDiag }[S.layer];
  $("#layer").classList.toggle("no-anim", noAnim); noAnim = false;
  $("#layer").innerHTML = L ? L() : "";
  if (S.layer !== lastLayer) {
    const t = $("#layer [data-autofocus]") || $("#layer .qr-sheet");
    if (t) { if (!t.hasAttribute("tabindex") && t.tagName === "DIV") t.tabIndex = -1; t.focus({ preventScroll: true }); if (t.id === "cmdq") t.setSelectionRange(t.value.length, t.value.length); }
  }
  lastLayer = S.layer;
  $$("input:indeterminate").forEach((x) => (x.indeterminate = false));
}
const layerRerender = () => {
  const keepScroll = $("#layer .qr-sheet__body, #layer .qr-drawer__body");
  const top = keepScroll ? keepScroll.scrollTop : 0;
  const was = lastLayer; lastLayer = "__keep__"; noAnim = true;
  render(); lastLayer = was;
  const b = $("#layer .qr-sheet__body:last-of-type, #layer .qr-drawer__body"); if (b) b.scrollTop = top;
};

/* ——— Logika ——— */
function selectSeg(i) { S.sel = i; S.t = SEGS[i].start + 0.01; }
function nextReview(from = S.sel) {
  for (let k = 1; k <= SEGS.length; k++) { const i = (from + k) % SEGS.length; if (needsReview(SEGS[i])) return i; }
  return -1;
}
function startSync() {
  clearInterval(timers.sync);
  S.syncRun = true;
  timers.sync = setInterval(() => {
    S.syncPct = Math.min(100, S.syncPct + 2.5);
    if (S.syncPct >= 100) {
      clearInterval(timers.sync); S.syncRun = false; S.synced = true; S.sel = 6; S.t = SEGS[6].start + 0.01;
      toast({ kind: "success", title: "Ayat sudah tersinkron", small: `Silakan periksa ${reviewCount()} bagian yang ditandai.`, actions: [{ label: "Tinjau", act: "next-review" }] });
    }
    if (S.space === "studio" && !S.layer) rerenderStudioLive();
  }, 200);
}
function rerenderStudioLive() {
  const bar = $(".sync-bar");
  if (!S.syncRun || !bar) { render(); return; }
  $(".qr-progress", bar).style.setProperty("--v", S.syncPct / 100);
  $(".tc", bar).textContent = Math.round(S.syncPct) + "%";
}
function enqueue(title, code) {
  const j = { id: Date.now() + Math.random(), code, title, sub: "Encoder VideoToolbox", state: "run", pct: 0, own: true };
  S.jobs.unshift(j);
  if (!timers.jobs) timers.jobs = setInterval(tickJobs, 300);
  return j;
}
function tickJobs() {
  let any = false;
  S.jobs.filter((j) => j.own && j.state === "run").forEach((j) => {
    any = true; j.pct = Math.min(100, j.pct + 4 + Math.random() * 4 | 0);
    if (j.pct >= 100) { j.state = "done"; j.sub = "47 detik · 14 MB"; toast({ kind: "success", title: "Ekspor selesai", small: `${j.title} · 18 detik`, actions: [{ label: "Siap unggah", act: "upload" }] }); }
  });
  if (!any) { clearInterval(timers.jobs); timers.jobs = 0; }
  if (S.layer === "queue") layerRerender();
  else $$("[data-act=queue]").forEach((b) => { const n = activeJobs(); b.innerHTML = `${ic("list-checks")}Antrean${n ? ` ${badge("accent", n)}` : ""}`; });
}
let raf = 0, last = 0;
function loop(now) {
  if (!S.playing) return;
  S.t = Math.min(TOTAL, S.t + (now - last) / 1000); last = now;
  const ph = $("[data-playhead]"); if (ph) { ph.style.left = pct(S.t) + "%"; $("[data-pht]").textContent = fmt(S.t).slice(3); $("[data-tc]").textContent = fmt(S.t); }
  paintCanvas();
  if (S.t >= TOTAL) stopPlay(); else raf = requestAnimationFrame(loop);
}
function startPlay() { if (S.t >= TOTAL - 0.05) S.t = 0; S.playing = true; last = performance.now(); raf = requestAnimationFrame(loop); const b = $("[data-act=play]"); if (b) { b.innerHTML = ic("pause"); b.setAttribute("aria-label", "Jeda"); } }
function stopPlay() { S.playing = false; cancelAnimationFrame(raf); const b = $("[data-act=play]"); if (b) { b.innerHTML = ic("play"); b.setAttribute("aria-label", "Putar"); } }
const closeLayer = () => { S.layer = null; render(); };
const setPath = (path, v) => { const p = path.split("."); let o = S; while (p.length > 1) o = o[p.shift()]; o[p[0]] = v; };

document.addEventListener("click", (e) => {
  if (S.menu && !e.target.closest(".menu-pop") && !e.target.closest("[data-act=menu]")) { S.menu = null; render(); }
  const th = e.target.closest("[data-theme-set]");
  if (th) { S.theme = th.dataset.themeSet; if (S.layer === "settings") layerRerender(); else render(); return; }
  const sc = e.target.closest("[data-scrim]");
  if (sc && e.target === sc) { closeLayer(); return; }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const a = el.dataset.act, arg = el.dataset.arg;
  switch (a) {
    case "noop": todo(arg || "Aksi ini"); break;
    case "toast-x": el.closest(".qr-toast").remove(); break;
    case "close": closeLayer(); break;
    case "home": stopPlay(); S.space = "home"; S.layer = null; render(); break;
    case "filter": S.filter = arg; render(); break;
    case "view": S.homeView = arg; render(); break;
    case "menu": S.menu = S.menu === arg ? null : arg; render(); break;
    case "open-project": if (arg === "fatihah") { S.space = "studio"; S.step = 2; S.guide = false; render(); } else todo("Membuka proyek " + PROJECTS.find((p) => p.id === arg).name); break;
    case "new": S.layer = "new"; render(); break;
    case "create-only": S.layer = null; S.space = "studio"; S.step = 1; S.synced = false; S.sel = 0; S.t = 0.01; S.guide = true; render(); break;
    case "create-sync": S.layer = null; S.space = "studio"; S.step = 2; S.synced = false; S.sel = 0; S.t = 0.01; S.syncPct = 0; startSync(); render(); break;
    case "step": stopPlay(); S.step = +arg; render(); break;
    case "sel": selectSeg(+arg); render(); break;
    case "next-review": { S.space = "studio"; S.step = 2; const n = nextReview(); if (n < 0) toast({ kind: "success", title: "Semua segmen sudah ditinjau" }); else selectSeg(n); S.layer = null; render(); break; }
    case "accept": { if (needsReview(SEGS[S.sel])) S.accepted[S.sel] = 1; const n = nextReview(); if (n >= 0) selectSeg(n); else toast({ kind: "success", title: "Semua segmen sudah ditinjau" }); render(); break; }
    case "fix": S.conflict = false; toast({ kind: "success", title: "Batas segmen 1:7 digeser ke batas kata", small: "Ekspor sekarang bisa dilanjutkan." }); render(); break;
    case "play": S.playing ? stopPlay() : startPlay(); break;
    case "seek0": S.t = 0; stopPlay(); render(); break;
    case "frame": S.t = Math.min(TOTAL, S.t + 1 / 30); render(); break;
    case "seek": { const lanes = $(".tl-lanes"); const r = lanes.getBoundingClientRect(); S.t = Math.max(0, Math.min(TOTAL, ((e.clientX - r.left) / r.width) * TOTAL)); { const i = segAt(S.t); if (i >= 0) S.sel = i; } render(); break; }
    case "safe": if (el.type === "checkbox") S.safe = el.checked; else S.safe = !S.safe; render(); break;
    case "layer": S.layers[arg] = !S.layers[arg]; render(); break;
    case "guide-off": S.guide = false; render(); break;
    case "sync": S.syncPct = 0; S.synced = false; S.step = 2; startSync(); render(); break;
    case "sync-cancel": clearInterval(timers.sync); S.syncRun = false; S.syncPct = 0; toast({ kind: "info", title: "Sinkron dibatalkan" }); render(); break;
    case "relink": S.layer = "relink"; S.relinkFound = false; render(); break;
    case "relink-find": S.relinkFound = true; layerRerender(); break;
    case "relink-apply": S.missing = false; S.layer = null; toast({ kind: "warning", title: "1 aset terhubung, 1 berbeda isi", small: "Periksa ulang waktu sinkron setelah ini." }); render(); break;
    case "queue": S.layer = S.layer === "queue" ? null : "queue"; render(); break;
    case "history": S.layer = "history"; render(); break;
    case "restore": toast({ kind: "success", title: "Versi dipulihkan", small: "Versi sebelumnya disimpan lebih dulu." }); closeLayer(); break;
    case "export": openExport(); render(); break;
    case "fix-issues": S.layer = null; S.step = 2; if (arg === "review") { const n = nextReview(-1); selectSeg(n < 0 ? 0 : n); } else selectSeg(6); render(); break;
    case "export-go": { const pr = PRESETS.find((p) => p.id === S.preset); S.layer = null; enqueue(`Al-Fatihah (${pr.ar})`, "1:1–7"); toast({ kind: "success", title: "Ekspor ditambahkan ke antrean", small: "Berjalan di latar. Anda bisa terus bekerja.", actions: [{ label: "Lihat antrean", act: "queue" }] }); render(); break; }
    case "upload": S.layer = "upload"; render(); break;
    case "copy": { const txt = $("#cp-" + arg).textContent; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).catch(() => {}); el.innerHTML = `${ic("check", "qr-ic--sm")}Tersalin`; setTimeout(() => (el.innerHTML = `${ic("copy", "qr-ic--sm")}Salin`), 1500); break; }
    case "batch": S.batch.step = 1; S.layer = "batch"; render(); break;
    case "batch-next": S.batch.step++; layerRerender(); break;
    case "batch-prev": S.batch.step--; layerRerender(); break;
    case "batch-go": { const g = batchGroups().filter((x) => !x.bad); g.forEach((x) => enqueue(`${x.title} (9:16)`, x.label)); S.layer = null; toast({ kind: "success", title: `${g.length} klip masuk antrean`, small: batchGroups().some((x) => x.bad) ? "1 klip dilewati karena ada masalah pada teks." : "", actions: [{ label: "Lihat antrean", act: "queue" }] }); render(); break; }
    case "templates": S.layer = "templates"; render(); break;
    case "tpl": S.template = arg; S.layer === "templates" ? layerRerenderWithStudio() : render(); break;
    case "settings": S.layer = "settings"; render(); break;
    case "stab": S.settingsTab = arg; layerRerender(); break;
    case "saheeh-dl": startSaheeh(); layerRerender(); break;
    case "first-next": S.first = 2; layerRerender(); break;
    case "first-dl": startSaheeh(); S.layer = null; toast({ kind: "info", title: "Mengunduh Saheeh International", small: "Berjalan di latar. Anda bisa langsung mulai." }); render(); break;
    case "saheeh-del": S.saheeh = "none"; layerRerender(); break;
    case "job": jobOp(el.dataset.op, +arg); break;
    case "clear-done": S.jobs = S.jobs.filter((j) => j.state !== "done"); layerRerender(); break;
    case "cmdk": S.layer = "cmdk"; S.cmdq = ""; S.cmdi = 0; render(); break;
    case "cmd": runCmd(+arg); break;
  }
});
function layerRerenderWithStudio() { render(); }
function startSaheeh() {
  S.saheeh = "loading"; S.saheehPct = 0; clearInterval(timers.saheeh);
  timers.saheeh = setInterval(() => {
    S.saheehPct += 6;
    if (S.saheehPct >= 100) { clearInterval(timers.saheeh); S.saheeh = "done"; toast({ kind: "success", title: "Saheeh International terpasang", small: "6.236 ayat · 1.903 catatan kaki. Atribusi otomatis masuk ke paket unggah." }); }
    if (S.layer === "settings") layerRerender();
  }, 150);
}
function jobOp(op, id) {
  const j = S.jobs.find((x) => x.id === id);
  if (!j) return;
  if (op === "cancel") { j.state = "cancel"; j.sub = "Dibatalkan baru saja"; }
  if (op === "pause") { j.state = "pause"; j.sub = "Dijeda oleh pengguna"; }
  if (op === "resume") { j.state = "run"; j.sub = "Encoder VideoToolbox"; }
  if (op === "retry" || op === "rerun") { j.state = "wait"; j.sub = "Menunggu giliran"; j.pct = 0; }
  if (op === "folder") todo("Membuka folder hasil");
  if (op === "upload") { S.layer = "upload"; render(); return; }
  layerRerender();
}
function runCmd(n) { const c = cmds()[n]; if (!c) return; S.layer = null; c.run(); render(); }

document.addEventListener("change", (e) => {
  const b = e.target.closest("[data-bind]");
  if (!b) return;
  const path = b.dataset.bind;
  if (path === "gain") { S.gain = +b.value; return; }
  let v = b.type === "checkbox" ? (b.checked ? 1 : 0) : b.type === "radio" ? b.value : isNaN(+b.value) ? b.value : +b.value;
  setPath(path, v);
  if (path === "preset") { if (S.layer === "export") layerRerender(); else render(); }
  if (path.startsWith("batch")) layerRerender();
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "q") { S.q = t.value; $("#home-main").innerHTML = homeMain(); }
  if (t.id === "cmdq") { S.cmdq = t.value; S.cmdi = 0; $("#cmdlist").innerHTML = cmdList(); }
  if (t.matches("input[data-bind=gain]")) { S.gain = +t.value; t.style.setProperty("--v", (S.gain + 60) / 72); const g = $("[data-gainv]"); if (g) g.textContent = `${S.gain > 0 ? "+" : ""}${S.gain} dB`; }
});
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey, tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (S.layer === "cmdk") {
    const l = cmds();
    if (e.key === "ArrowDown") { S.cmdi = (S.cmdi + 1) % Math.max(1, l.length); $("#cmdlist").innerHTML = cmdList(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { S.cmdi = (S.cmdi - 1 + l.length) % Math.max(1, l.length); $("#cmdlist").innerHTML = cmdList(); e.preventDefault(); }
    else if (e.key === "Enter") { runCmd(S.cmdi); e.preventDefault(); }
  }
  if (e.key === "Escape") { if (S.menu) { S.menu = null; render(); } else if (S.layer) closeLayer(); return; }
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); S.layer = S.layer === "cmdk" ? null : "cmdk"; S.cmdq = ""; S.cmdi = 0; render(); return; }
  if (mod && e.key === ",") { e.preventDefault(); S.layer = "settings"; render(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "e" && S.space === "studio") { e.preventDefault(); openExport(); render(); return; }
  if (mod && /^[1-4]$/.test(e.key) && S.space === "studio") { e.preventDefault(); S.step = +e.key; render(); return; }
  if (e.key === "Tab" && S.layer && S.layer !== "queue" && S.layer !== "history") {
    const f = $$("#layer button:not([disabled]), #layer input:not([disabled]), #layer select, #layer [tabindex]:not([tabindex='-1'])").filter((x) => x.offsetParent);
    if (f.length) { const i = f.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1; f[n].focus(); e.preventDefault(); }
    return;
  }
  if (S.space !== "studio" || S.layer || typing || mod || e.altKey) return;
  const onBtn = tag === "BUTTON";
  if (e.key === " " && !onBtn) { e.preventDefault(); S.playing ? stopPlay() : startPlay(); }
  else if (e.key.toLowerCase() === "n" && S.step === 2) { const n = nextReview(); if (n >= 0) { selectSeg(n); render(); } }
  else if (e.key === "Enter" && S.step === 2 && !onBtn) { $("[data-act=accept]") && $("[data-act=accept]").click(); }
});

/* ——— Awal ——— */
const sel0 = $("#scenario");
sel0.innerHTML = SCEN.map(([id, l]) => `<option value="${id}">${l}</option>`).join("");
sel0.addEventListener("change", () => applyScenario(sel0.value));
window.addEventListener("hashchange", () => applyScenario(location.hash.slice(1)));
applyScenario(location.hash.slice(1) || "home");
})();
