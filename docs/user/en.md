# Quran Render — User Guide (English)

> **Status: pre-alpha.** This guide only describes what actually works. Missing features are marked
> **Not available**.

## 1. Getting started

Full build and test guide (Indonesian): [`docs/engineering/07_BUILD_DAN_TEST.md`](../engineering/07_BUILD_DAN_TEST.md).

**From source** (no official release installer yet):

```bash
pnpm install
cargo run -p qr-dataset -- build   # once: build the Quran dataset (build/dataset)
pnpm app                           # run the app to try it out
pnpm dmg                           # build the installer: target/release/bundle/dmg/Quran Render_<version>_<arch>.dmg
```

The app needs `ffmpeg` and `ffprobe` (macOS: `brew install ffmpeg`) for media import and export.
The `.dmg` is not signed with an Apple certificate yet: on another Mac, open it the first time with
right-click › *Open*. Windows/Linux installers: **Not available**.

**Create a project.** Drag a recitation file from Finder/File Explorer onto the Home window, or choose
*Create project*. In the *New project* sheet you can drop the file on the drop area or pick it with
*Choose file…*; the project name is filled in from the file name. The file is optional and is imported
as soon as the Studio opens. Projects are saved as `*.qrproj` folders in `~/QuranRender/Projects`.
A duplicate name never overwrites another project (`Name-2.qrproj`). A `.qrpack` file dropped on Home
opens the *Import pack* sheet.

**Import audio.** In the Studio *Source* step, drag an audio file and drop it anywhere in the window, or
click *Choose file…*. Formats: mp3, m4a, aac, wav, flac, ogg, opus, or mp4, mov, mkv, webm video (its
sound is used). A project uses one audio track; a new file replaces the old one.

**Background (image/video).** In the *Source* step, the *Background (image/video)* section: drop an image
(png, jpg, jpeg, webp, bmp) or video (mp4, mov, mkv, webm) on the background zone, or click *Choose background…*.
A background video is muted, cropped to cover the canvas, looped when shorter than the audio and trimmed when
longer. Drag *Background dimmer* (default 35%) to keep text readable; at least 20% is recommended. *Replace* or
the trash icon changes the background. Drops are routed automatically: images always become the background,
audio-only files become the audio, a video dropped on the audio zone is used as audio, anywhere else it becomes
the background.

**Verse range.** Pick the surah by name (e.g. "67. Al-Mulk"); *From verse* and *To verse* are limited to that
surah's verse count.

Other location fields (the exported `.mp4`, `.qrpack` files, the batch output folder) have a *Choose…*
button that opens the system's native dialog; you can still paste a path directly.

## 2. Sync (verse segments and timing)

- Each **segment** shows one verse or part of a verse, with a start and end time.
- Segments with confidence < 80% are flagged *needs review*. **Accept** marks them as reviewed.
- A long verse that does not fit one screen (e.g. Al-Baqarah 2:282) must be **split by word range**.
  Splits happen only on word boundaries; a word never appears in two segments. A split segment shows the
  whole-verse translation marked *needs review* until its translation is trimmed (automatically, with
  AI, or edited). Automatic/AI trims still need review; export shows a `TRN-REVIEW` warning (not
  blocking) for segments whose primary-edition translation is not reviewed.
- The opening Basmala and the Isti'adha can be special segments: the Basmala Arabic comes from the
  dataset (1:1), the Isti'adha from a built-in text (not a verse), with no surah/verse label; built-in
  translations exist for Indonesian and English.
- **Automatic sync (AI):** in the Sync step press *Sinkronkan otomatis (AI)* (auto sync). Verses are
  recognised from the audio (no verse range needed) with per-word timing, Basmala and Isti'adha. It uses
  the public Hugging Face Space `hetchyy/quranic-universal-aligner` (the same default engine as Quran
  Caption), so **the audio is uploaded to that service** and internet is required; first use asks for your
  consent. Low-confidence segments or segments with missing words are flagged *needs review*.
- **Offline sync (estimate):** local voice detection + proportional timing; needs a verse range.
- **Manual keyboard sync:** *Manual* mode in the Sync step. Play the audio, pick the verse words (↑/↓, V =
  whole verse), press **Enter** at the end of the recitation to create a segment, **Backspace** removes the
  last one, **B**/**A** insert Basmala/Isti'adha, **N**/**M** move a segment's start/end to the playhead,
  **S** marks a pause. Segment edges can also be dragged on the timeline.
- **Translations:** choose editions in the Display step; install more from Settings › Translation
  editions (Quran.com). AI trimming uses an OpenAI-compatible service with your own key (Settings › AI
  service, stored in the system keychain).
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

- Splitting a project per N verses/duration/marker and a job queue that survives closing the app
  (interrupted jobs return to the queue on start) exist as a library. A batch/queue UI: **Not available**.
- `.qrpack` archives (project + assets + SHA-256 fingerprints, openable on another OS) are available via app
  commands; UI buttons: **Not available**. Corrupted or hostile archives are rejected.
- The credits file (`*.credits.txt`) and upload text (`*.upload.txt`) generators exist as a library. The
  *Ready to upload* panel: **Not available**.

## 6. Content and licensing

- Quran text: Kemenag RI (Indonesian Standard Mushaf). Built-in translation: Kemenag. Other translation
  editions (e.g. Saheeh International) are downloaded from Quran.com (api.quran.com) and stored
  separately in `~/QuranRender/content.db`; the edition list stays available offline once fetched. A
  project can show several editions at once (project edition order; the first is primary).
- AI translation trimming uses your own OpenAI-compatible service (settings `ai.endpoint`, default
  `https://api.openai.com/v1`, and `ai.model`). The API key is stored in the system keychain, not in the
  settings file. Only the segment's Arabic text and translation are sent.
- Content must not contain living beings or music; Quran Render provides neither.

## 7. Help

Report issues in the project repository. Include the version (`qurender --version`), your operating
system and the steps you took. Never attach private keys.
