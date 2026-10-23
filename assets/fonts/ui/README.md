# Font UI dan terjemahan (bukan font Al-Qur'an)

| Berkas | Sumber | Lisensi |
|---|---|---|
| `Inter-Variable.ttf` | Dikonversi tanpa mengubah data glyph dari `inter-latin-wght-normal.woff2` (paket `@fontsource-variable/inter`, subset Latin, sumbu `wght` 100–900). Proyek asli: https://github.com/rsms/inter | SIL Open Font License 1.1 (`OFL-Inter.txt`) |

Dipakai renderer (`qr-render`) untuk teks terjemahan dan lencana referensi, agar kanvas ekspor memakai font yang sama
dengan template (`font_family: "Inter"`). Font Al-Qur'an tetap di `assets/fonts/quran/` dan berada di bawah
`content-manifest.json`.
