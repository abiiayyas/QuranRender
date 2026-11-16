# Quran Render — User Guide

Quran Render turns a recitation recording into a captioned video: Arabic verses, translation, and word-by-word highlighting in
sync with the reciter's voice. To run it from source, see [`07_BUILD_DAN_TEST.md`](../engineering/07_BUILD_DAN_TEST.md).

The app speaks English and Indonesian: **Settings > General > Language**.

## 1. Getting started

On **Home**, choose a surah and verse range (optional), the reciter's name, the video format (9:16, 16:9 or 1:1) and the Arabic
text, then click **Create project**. A project name is optional: leave it empty to use the surah's name. Projects save
automatically, and you can open any step at any time from the step bar.

Want the quickest start? Click **Blank project**: just a name and a surah. The recording, translation and look are set up in the
steps that follow.

The **project list** has one row per project: title, surah (number, Latin and Arabic name) with its verse range, reciter,
segment count, duration, stage, and what to do next. Filter by stage, search by title, surah or reciter, and sort by newest,
surah or name. The **Continue** card next to the form names the next step for the project you worked on last.

| Arabic text | What it is |
|---|---|
| Kemenag (LPMQ) | The Indonesian Standard Mushaf, built in, works offline |
| Uthmani Hafs | From Quran.com; the font downloads the first time it is used |
| QPC Madinah | The Madinah mushaf, page by page, from Quran.com; the font downloads when used |

## 2. Step 1: Source

Pick one:

- **File:** drag an audio or video file into the box, or click **Choose file**. A video's sound is used, and its picture can
  become the background in the Editor.
- **Reciter:** download a surah's recitation from MP3Quran or Quran.com. Reciters labeled *auto-synced* carry verse timings, so
  you can skip the Sync step.
- **YouTube:** paste a video address. The first time, the app downloads yt-dlp. Make sure you have the right to use the recording.

Under the waveform, set the start and end points and click **Trim** to cut away what you do not need.

## 3. Step 2: Sync

Click **Start auto sync** to find the verses and the timing of every word. The recording is sent to a public Hugging Face Space
(*Quranic Universal Aligner*), so it needs internet. Choose the **Base** model (faster) or **Large** (more careful).

The result is a list of segments. Low-confidence segments are flagged; use **Next to check**. For each segment you can:

- drag its edges on the waveform or type the times;
- split at the playhead, merge with the next one, add, or delete;
- change the type (Verse, Basmalah, Isti'adzah), the surah, the verse and the word range for a partial verse;
- set each word's timing, or **Spread word timings** when there are none yet.

Shortcuts: Space plays and pauses, left and right arrows select a segment.

## 4. Step 3: Text

The Kemenag translation is built in. Click **Add translation** to install another edition from Quran.com; the top edition is the
main translation in the video. **Fill translations** fills every segment. For a verse that is only partly recited, **AI trim
partial verses** cuts the translation to the part that is read. This needs AI set up in **Settings**, with two options: an
**API** (any OpenAI-compatible service, including local Ollama, with your own key) or an **AI CLI on this computer** (Claude Code,
Codex CLI, OpenCode, or your own command) that is already installed and signed in, with no API key. A CLI starts
fresh on each call, so one batch can take about a minute; the app sends many segments at once to keep it short. The app never
asks a CLI for extra permissions. AI never changes the Arabic text.

**Verses or translations that are too long.** The video holds the Arabic, the translation and a reference between the surah name
and the reciter name. When they do not fit, the translation shrinks first (down to 70%), then the Arabic (down to 50%); they are
never shrunk further so they stay readable. A segment that still does not fit is marked **Too long for one screen** in the Text
step and appears as a note in the Export dialog. There are two causes and two cures:

- **The verse is long:** click **Auto split**. The verse is split at word gaps (preferably after a waqf mark, near the middle)
  until each part fits, and each part's translation is cut automatically. The result is one undoable step. A translation you
  typed in that segment is recomputed.
- **The translation is long** (the verse is partial but its translation is still whole, status *needs review*): splitting does not
  help. Use **AI trim** or type the cut yourself. AI results are flagged; check them before exporting, and type in the
  translation field to correct them.

## 5. Step 4: Editor

The preview uses the same engine as the export, so it matches the video.

- **Style:** 12 presets, then size, color, word highlight, translation, **separator** (a decorative line with a small ornament between the verse and its translation; its space is part of the layout, so it never covers text), box, frame and captions (surah name, reciter, reference).
- **Background:** a color, image, video, the source video, or **Motion** (soft light, geometry, particles, rays, waves; set two
  colors and the speed); set the dimming and blur. A background video shorter than the recitation loops: **Repeat** (back to the
  start), **Ping-pong** (forward then backward with no jump), or **Fade** (a soft cross-fade at the seam). **Find a stock photo or
  make one with AI** opens the background picker (see below).
- **Overlay:** text or an image (logo, channel name), **Reciter name** (an animated lower third with the surah name),
  **Progress** (a thin bar that fills during the recitation), **Call to action** (a short sentence such as "Don't forget to share and pray"),
  **Sound wave** (bars or a wave that move with the recitation; needs the source recording), and **Subscribe** and **Follow**
  (a button that appears at the overlay's Start time, gets tapped, then disappears and comes back at an interval, for example every
  60 seconds for 6 seconds; an account name can be added), each with a display time and a **place**: pick one of nine spots in the safe area (a 3×3 grid), set the **distance from the safe edge**, then fine-tune with the Horizontal and Vertical sliders. Text pinned to the right edge is right-aligned, to the left edge left-aligned. The Subscribe and Follow buttons in the video are always in English. Drag an overlay on the
  timeline to move it and drag its edges to resize it. The timeline zooms (up to 64×) and scrolls for long recordings.
- **Audio:** a **background sound** from nature under the recitation: rain, rain on a window, rain and thunder, flowing stream, campfire, night crickets, soft wind, calm waves and night hum. The files
  come with the app. The level is **relative to the reciter's voice**: the app measures how loud your recording is and puts the sound that many dB under it (default 24 dB; further right is
  louder, and past 18 dB under the voice a warning appears because it starts to compete with the recitation). There is a fade in and out. No music, on purpose.
- **Format:** switch between 9:16, 16:9 and 1:1 and show the safe-area guide. The guide is not exported.

Undo and Redo sit above the preview (Cmd+Z, Cmd+Shift+Z).

### Background picker

- **Stock photos & videos:** search Pexels, Unsplash or Pixabay (Pexels and Pixabay have videos too). Each service needs a free
  API key; the picker shows where to make one, and the key is stored encrypted on your computer. The photographer's credit is
  saved and goes into the Publish text; for Unsplash the credit is required. Search results belong to the service and can contain
  people or animals.
- **Make with AI:** pick a mood (rainy lofi room, lofi city rooftop at night, starry desert, mosque silhouette at dusk, misty pine
  forest, calm sea, geometric tile pattern, and more) and optionally add a short description. Images are always made without
  people, animals, text and logos (words for living beings in the description are rejected). Choose the provider in **Settings >
  Image generator**: **Pollinations** (free, no key, one image per 45 seconds, medium size, and the service stamps a small logo in the
  bottom-right corner that the app removes by cropping about 7% of the edges), an **OpenAI-compatible API** (uses the address and key
  above plus an image model name), or an **AI CLI**.

## 6. Export

Click **Export**. Choose 720p, 1080p or 4K at 15, 24, 30 or 60 fps (fewer frames render faster, with a less smooth word highlight), the extra files (SRT, VTT, YouTube chapters) and the output folder.
Before rendering, the app checks the text and completeness: export is refused when a segment has invalid timing, a word range
outside its verse, or no main translation. Warnings (translation to check, low confidence) do not block. Rendering takes about 1.5
times the video's duration at 1080p on one test machine; yours may differ.

**Exporting part of it (to cut a long video into shorts).** In the Export dialog choose **Only part of it**, then write **Start** and **End** as times in the
recording (`10:00`, `1:23.5`, or `83` for seconds). The project is not changed and the source is not trimmed, so you can export as many cuts as you like from
one project. The dialog tells you how long the result is and which verses it holds, and warns when the range cuts through a verse; **Snap to whole verses**
moves both ends to segment edges. Times in the video, the subtitles (SRT, VTT) and the YouTube chapters start again at zero. Overlays follow the project's
timeline: those set to run until the end of the video run from the start of the result (the progress bar fills across the result, the Subscribe button shows
from its start), while those whose time falls outside the range do not show (the dialog tells you). The background sound fades in and out at the start and end of
the result. Only the segments inside the range are checked before export. The file name carries the range.

**Render method.** *Automatic* renders in one go for short videos and **in pieces** (about 10 minutes each) for videos longer than 15 minutes; *Direct* and
*In pieces* force one or the other. The pieces are rendered one after another without sound, the sound is rendered once, and everything is joined without
re-encoding, so there is no quality loss and no click at the joins. The total time is about the same as a direct render. The gain: if an export is
interrupted (the app is closed, it fails, it is canceled), the finished pieces are kept and the Export dialog offers to continue from there; tick
*start over* to discard them. Pieces are reused only when the project and settings are exactly the same. It needs temporary disk space until the join is done:
the pieces take about the size of the video, plus the sound at about 11 MB per minute (a 2-hour video: about 1.4 GB).

**Estimated time** is shown in the dialog. At first it is a rough figure from measurements on one test computer; after every export it adjusts to your
computer's speed. A **Motion** background takes about 1.7 times as long to render as a plain one.

**When finished:** *Nothing*, *Sleep* (the Mac sleeps) or *Quit the app*. Only done when the export succeeds and nothing else is still running, after a
1-minute countdown you can cancel. While an export runs, the Mac does not fall asleep on its own.

## 7. Thumbnail and Publish

Both open from the buttons in the project header.

**Thumbnail** makes a JPG cover (under 2 MB) for Shorts, Reels and TikTok. The background comes from your project: an imported
image, a **frame from a video** (the background or source video; pick the position with the slider), or a plain color. The app
draws the text itself, so the letters are always right. Set the main text (the last word gets a color), the small text, the
position, the accent color, and how dark the layer behind the text is. In 9:16, dashed lines mark the part shown in the Instagram
profile grid; they are not saved. **Save thumbnail** saves to the export folder, **Save a copy…** to a place of your choice.

**Publish** prepares upload text for YouTube Shorts, TikTok, Reels and YouTube: title, description, hashtags and (YouTube)
chapters from your segments. The first draft is written from the project's data (surah, verses, reciter, translation name,
audio source), so attribution is always there and needs no internet. Character counts follow each platform's limits. **Write with
AI** polishes the wording (needs an API key in Settings); AI never writes or quotes Arabic text, and a reply containing Arabic
letters is rejected. Each field has a Copy button, and **Save all (.txt)** writes every platform to one file. Check the right to
use the recording before uploading.

## 8. Settings

- **General:** the app language (Bahasa Indonesia or English), theme, and the default Arabic text. The language also decides the
  app's messages and the text drawn into videos (for example the Subscribe button and the Publish drafts); verse translations are
  chosen separately in the Text step.
- **AI service** and **Image generator:** see the Text step and the Editor.
- **Storage:** sizes and a **Clear** button for *temporary files* (leftovers of renders and downloads), unfinished *render pieces*, *visualizer data* (rebuilt
  automatically) and *Uthmani/QPC fonts* (need internet to download again). Render leftovers older than a day and pieces older than a week are cleared
  automatically when the app opens. Below, **unused project files** (for example a recording from before it was trimmed) can be deleted per project; files
  still in use (audio source, background, overlays, thumbnail) can only be deleted one by one after a warning, and their references in the project are
  cleared. Deleted files cannot be restored, not even with Undo. Your recordings and exports are never deleted unless you choose them.
- **Support:** donation links (PayPal and Saweria). Donations are voluntary and unlock nothing.

## 9. Content and licenses

- Kemenag text and translation: Lajnah Pentashihan Mushaf Al-Qur'an, Indonesian Ministry of Religious Affairs.
- Uthmani, QPC and other translations: Quran.com. KFGQPC fonts are not bundled; they download from Quran.com's CDN.
- Recitations: MP3Quran and Quran.com. Check the right to use a recording before uploading.
- Code: GPL-3.0. Remotion is free for individuals and organizations of up to 3 employees.

## 10. Help

Report problems as an issue in the repository. Include the steps, the error message, and which step failed.
