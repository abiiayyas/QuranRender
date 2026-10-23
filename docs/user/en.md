# QuranRender — User Guide (English)

> **Status: pre-alpha.** This guide only describes what actually works. Missing features are marked
> **Not available**.

## 1. Getting started

**Run from source** (no release installer yet):

```bash
pnpm install
pnpm --filter @quranrender/desktop tauri dev      # desktop app
cargo run -p qr-dataset -- build                   # build the Quran dataset (build/dataset)
```

The app needs `ffmpeg` and `ffprobe` on `PATH` for media import and export. A macOS `.app` bundle is built
with `pnpm tauri build --bundles app`. Windows/Linux installers and the "first launch" guide
(Gatekeeper/SmartScreen): **Not available**.

**Create a project.** On the home screen choose *New project*, enter a name, a reciter (optional) and an
aspect ratio (9:16, 16:9, 1:1, 4:5). Projects are saved as `*.qrproj` folders in `~/QuranRender/Projects`.
A duplicate name never overwrites another project (`Name-2.qrproj`).

## 2. Sync (verse segments and timing)

- Each **segment** shows one verse or part of a verse, with a start and end time.
- Segments with confidence < 80% are flagged *needs review*. **Accept** marks them as reviewed.
- A long verse that does not fit one screen (e.g. Al-Baqarah 2:282) must be **split by word range**.
  Splits happen only on word boundaries; a word never appears in two segments. Translation is not
  shown on split segments.
- **Automatic sync from audio: Not available.** The existing voice-activity module only gives a rough
  estimate and does not identify verses. Set timing by hand.
- **Audio playback in Studio: Not available.**

## 3. Style and templates

- 12 built-in templates: `subuh`, `senja`, `hening`, `terang`, `madinah`, `naskh-klasik`, `besar`,
  `editorial-split`, `kartu-apung`, `siaran-lower-third`, `tadabbur-wbw`, `kajian-side-panel`. Each
  supports specific aspect ratios only (see `docs/design/05_VIDEO_TEMPLATES.md` §8).
- Verse text is **always** taken verbatim from the verified dataset; the app never alters it. If the
  dataset signature or hash does not match, the text is not displayed.
- Text is kept inside the platform **safe area**. If a verse does not fit at the minimum size, export is
  refused with code `CNT-5-OVERFLOW` and you are asked to split the segment.
- Per-element style editing in the UI: **Not available** (templates are chosen whole).
- `.qrtemplate` import/export exists at library level; a gallery in the UI: **Not available**.

## 4. Export

**Subtitles** (SRT/VTT/ASS): the *Export subtitles* dialog in Studio builds text from the dataset (verse
and/or translation). Saving straight to a file from the dialog: **Not available** (use the copy button).

**MP4 video** from the command line:

```bash
qurender render <folder.qrproj> <output.mp4> [--audio file] [--width N] [--max-seconds S] [--threads N] [--overwrite]
```

- Output: H.264 + AAC, BT.709 colour. Hardware encoder when available; if it fails, libx264 is used
  automatically.
- An existing output file is **not overwritten** unless `--overwrite` is given.
- Audio shorter than the video is padded with silence; the video is not truncated.
- Export from the Studio UI, transparent export (ProRes/WebM) and a batch queue in the UI:
  **Not available**.

## 5. Batch and upload package

- Splitting a project per N verses/duration/marker exists as a library. A batch queue in the UI, and a
  queue that survives closing the app: **Not available**.
- The credits file (`*.credits.txt`) and upload text (`*.upload.txt`) generators exist as a library. The
  *Ready to upload* panel: **Not available**.

## 6. Content and licensing

- Quran text: Kemenag RI (Indonesian Standard Mushaf). Built-in translation: Kemenag. Saheeh
  International is downloaded by the user and stored separately (`content.db`); downloading from inside
  the app: **Not available**.
- Content must not contain living beings or music; QuranRender provides neither.

## 7. Help

Report issues in the project repository. Include the version (`qurender --version`), your operating
system and the steps you took. Never attach private keys.
