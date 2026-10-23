// Papan identitas: tema, token, kontras terukur, waveform, dan pemutaran contoh.
(() => {
  const root = document.documentElement;

  // Tema halaman.
  const themeButtons = document.querySelectorAll("[data-set-theme]");
  themeButtons.forEach((b) =>
    b.addEventListener("click", () => {
      const mode = b.dataset.setTheme;
      if (mode === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", mode);
      themeButtons.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }),
  );

  // Nilai token untuk tema terang dan gelap.
  const probe = (theme) => {
    const el = document.createElement("div");
    el.className = `t-${theme}`;
    el.hidden = true;
    document.body.append(el);
    return el;
  };
  const probes = { light: probe("light"), dark: probe("dark") };
  const resolve = (theme, token) => {
    let v = getComputedStyle(probes[theme]).getPropertyValue(token).trim();
    const m = v.match(/^var\((--[\w-]+)\)$/);
    if (m) v = getComputedStyle(root).getPropertyValue(m[1]).trim();
    return v;
  };
  document.querySelectorAll("tr[data-token]").forEach((tr) => {
    tr.querySelectorAll("[data-theme-of]").forEach((c) => (c.textContent = resolve(c.dataset.themeOf, tr.dataset.token)));
  });

  // Kontras WCAG.
  const toRgb = (hex) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const lum = (hex) => {
    const [r, g, b] = toRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const PAIRS = [
    ["Teks utama di panel", "--text", "--bg-panel", 4.5],
    ["Teks sekunder di panel", "--text-2", "--bg-panel", 4.5],
    ["Teks redup di panel", "--text-3", "--bg-panel", 4.5],
    ["Teks redup di area cekung", "--text-3", "--bg-sunken", 4.5],
    ["Aksen di panel (tautan, seleksi)", "--accent", "--bg-panel", 4.5],
    ["Teks di tombol aksen", "--on-accent", "--accent", 4.5],
    ["Peringatan di panel", "--warning", "--bg-panel", 4.5],
    ["Bahaya di panel", "--danger", "--bg-panel", 4.5],
    ["Selesai di panel", "--success", "--bg-panel", 4.5],
    ["Batas kontrol di panel (non-teks)", "--border-control", "--bg-panel", 3],
    ["Batas kontrol di area cekung (non-teks)", "--border-control", "--bg-sunken", 3],
  ];
  const tbody = document.querySelector("#contrast tbody");
  for (const [label, fg, bg, min] of PAIRS) {
    const cells = ["light", "dark"].map((t) => {
      const r = ratio(resolve(t, fg), resolve(t, bg));
      return `<td data-l="${t === "light" ? "Terang" : "Gelap"}" class="${r >= min ? "ok" : "bad"}">${r.toFixed(2)} : 1</td>`;
    });
    tbody.insertAdjacentHTML("beforeend", `<tr><th scope="row">${label}</th>${cells.join("")}<td data-l="Syarat">≥ ${min} : 1</td></tr>`);
  }

  // Studio contoh: digambar 1180 px lalu diskalakan ke lebar wadahnya.
  const fit = new ResizeObserver((entries) => {
    for (const e of entries) e.target.firstElementChild.style.setProperty("--k", String(e.contentRect.width / 1180));
  });
  document.querySelectorAll(".studio-wrap").forEach((w) => fit.observe(w));

  // Waveform contoh (data sintetis, deterministik).
  document.querySelectorAll("[data-wave]").forEach((lane) => {
    let s = 7;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let html = "";
    for (let i = 0; i < 140; i++) {
      const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 9));
      html += `<i style="height:${Math.max(8, Math.round(env * (0.45 + 0.55 * rnd()) * 100))}%"></i>`;
    }
    lane.innerHTML = html;
  });

  // Pemutaran contoh: playhead melintasi segmen 1:5 dan sorotan berpindah per kata.
  const demo = window.QR_DEMO;
  const fmt = (t) => {
    const f = Math.floor((t % 1) * demo.fps);
    const s = Math.floor(t);
    const p = (n) => String(n).padStart(2, "0");
    return `00:00:${p(s)}:${p(f)}`;
  };
  const wordAt = (t) => {
    for (let i = 0; i < demo.words.length - 1; i++) if (t >= demo.words[i] && t < demo.words[i + 1]) return i;
    return -1;
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  document.querySelectorAll("[data-studio]").forEach((studio) => {
    const head = studio.querySelector("[data-playhead]");
    const tc = studio.querySelector("[data-tc]");
    const words = studio.querySelectorAll(".ayah .w");
    const btn = studio.querySelector("[data-play]");
    let raf = 0;

    const render = (t) => {
      head.style.left = `${(t / demo.total) * 100}%`;
      tc.textContent = fmt(t);
      const k = wordAt(t);
      words.forEach((w, i) => w.classList.toggle("on", i === k));
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      clearTimeout(raf);
      studio.classList.remove("is-playing");
      btn.setAttribute("aria-label", "Putar segmen 1:5");
    };
    render(demo.start);

    btn.addEventListener("click", () => {
      if (studio.classList.contains("is-playing")) return stop();
      const from = demo.words[0];
      const to = demo.words[demo.words.length - 1];
      if (reduce.matches) {
        // Tanpa animasi: lompat per kata setiap 0,7 detik.
        studio.classList.add("is-playing");
        let i = 0;
        const step = () => {
          if (!studio.classList.contains("is-playing")) return;
          if (i >= demo.words.length - 1) return stop();
          render(demo.words[i] + 0.01);
          i += 1;
          raf = setTimeout(step, 700);
        };
        return step();
      }
      studio.classList.add("is-playing");
      btn.setAttribute("aria-label", "Jeda");
      const startAt = performance.now();
      const dur = (to - from) * 1000;
      const tick = (now) => {
        const t = from + Math.min(1, (now - startAt) / dur) * (to - from);
        render(t);
        if (t < to) raf = requestAnimationFrame(tick);
        else stop();
      };
      raf = requestAnimationFrame(tick);
    });
  });
})();
