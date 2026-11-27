# Third-Party Notices

Quran Render's own source code is licensed under
[MIT](LICENSE). Third-party content and software below keep their
own licences.

This document lists what the application bundles (ships inside the installer)
and what it fetches at runtime (downloads on the user's machine). The ambient
loops have their own provenance file at
[`assets/ambient/SOURCES.md`](assets/ambient/SOURCES.md).

## Bundled content

### Quranic text, translation, and metadata — Kemenag RI

| | |
| --- | --- |
| Paths | Read-only SQLite dataset `resources/quran.db` |
| Source | Lajnah Pentashihan Mushaf Al-Qur'an, Kementerian Agama RI (Kemenag), in the format of the `quran.kemenag.go.id` API, supplied by the product owner |
| Licence | Bundling permission confirmed by the product owner |
| Attribution | Lajnah Pentashihan Mushaf Al-Qur'an, Kementerian Agama RI |

The Arabic text is displayed verbatim from this source; the Indonesian
translation is the Kemenag edition.

### Fonts

| File | Source | Licence |
| --- | --- | --- |
| `assets/fonts/quran/LPMQ.ttf` | Lajnah Pentashihan Mushaf Al-Qur'an (Kemenag RI) — Mushaf Standar Indonesia | Permission to use the standard Kemenag mushaf (bundling confirmed by the product owner) |
| `assets/fonts/quran/Amiri-Regular.ttf`, `assets/fonts/quran/Amiri-Bold.ttf` | Khaled Hosny, Amiri Font Project — <https://github.com/aliftype/amiri> | SIL Open Font License 1.1 (OFL-1.1) |
| `assets/fonts/ui/Inter-Variable.ttf` | The Inter Project Authors — <https://github.com/rsms/inter> (Latin subset via `@fontsource-variable/inter`) | SIL Open Font License 1.1 (OFL-1.1); see `assets/fonts/ui/OFL-Inter.txt` |

### Ambient audio loops

`assets/ambient/*.m4a` — nine background loops, regenerable with
`scripts/make-ambient.mjs`.

Seven loops are original synthesized work (no third-party rights). Two loops
use third-party clips:

| Loop | Third-party clip | Licence |
| --- | --- | --- |
| `rain-thunder` | `source/thunder-tonitrus-mysid-pd.ogg` — "Tonitrus.ogg" by Mysid (Wikimedia Commons) | Public domain (`PD-self`) |
| `crickets` | `source/crickets-syncopika-cc0.flac` — "cricket sounds" by syncopika (OpenGameArt) | CC0 1.0 Universal |

Full provenance, licence URLs, and processing notes are in
[`assets/ambient/SOURCES.md`](assets/ambient/SOURCES.md).

## Fetched at runtime (not bundled)

These are downloaded by the application at the user's request and are not part
of this repository or the installer:

- **Uthmani and QPC Quranic text and page fonts** — Quran.com (CDN). The KFGQPC
  font is downloaded on first use.
- **Translations other than Kemenag** — Quran.com.
- **Recitation audio** — MP3Quran and QDC.
- **Supplications (Hisn al-Muslim) & recitation audio** — OpenDua
  (<https://opendua.org>), including Arabic text, OpenDua English translation,
  and recitations by Muhammad Jumah, licensed under **CC BY 4.0**
  (<https://creativecommons.org/licenses/by/4.0/>).
- **Stock photos and videos** — Pexels, Unsplash, Pixabay (the user supplies
  their own API key; credits are shown per provider in the UI).
- **AI background images** — Pollinations (free tier), an OpenAI-compatible
  `/images/generations` endpoint (user-supplied key/URL), or a local AI CLI.

## Bundled software

### FFmpeg — `ffmpeg-static`

- Version: 5.3.0. Package licence: GPL-3.0-or-later (a GPL build of FFmpeg).
- FFmpeg's own source files are LGPL v2.1+ with optional GPL v2+ parts, as
  described in the bundled `ffmpeg.LICENSE` (shipped as
  `licenses/FFmpeg-LICENSE.txt` in the installer).

Distribution review: FFmpeg is invoked as a separate subprocess, so it is
combined with the MIT-licensed app only by aggregation. Ship the FFmpeg
licence (already done) and make FFmpeg's corresponding source available.

### Remotion

- Packages: `remotion`, `@remotion/renderer`, `@remotion/bundler`,
  `@remotion/player` — all 4.0.537.
- Licence: the **Remotion License** (not a standard open-source licence).
  Free for individuals, non-profits, and for-profit organisations of up to
  3 employees; a paid Company License is required for larger for-profit
  organisations. See <https://www.remotion.pro/license> and
  `node_modules/remotion/LICENSE.md`.

Distribution review: resolved by relicensing the project to MIT. The Remotion
License still applies to Remotion's own code: a paid Company License remains required for for-profit organisations over
3 employees; individuals and organisations up to 3 employees may use it free.

### Other npm dependencies

Listed in `package.json` under their own licences (MIT for React, react-dom,
zustand, better-sqlite3, Electron, and others). For a complete inventory, run a
licence scanner such as `license-checker` or `npx license-report`.
