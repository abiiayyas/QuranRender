//! Eksportir subtitle SRT, WebVTT, dan ASS (PRD EXP-4, #79, QRN-13, A1-12).
//! Mengacu ke docs/product/PRD.md §7 EXP-4 dan docs/engineering/01_TECHNICAL_HANDOFF.md §11.

use qr_core::project::Project;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubtitleFormat {
    Srt,
    Vtt,
    Ass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubtitleTrackSelection {
    AyahOnly,
    TranslationOnly,
    Bilingual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleExportOptions {
    pub format: SubtitleFormat,
    pub track: SubtitleTrackSelection,
    /// Apakah nomor ayat disematkan di dalam teks subtitle (misal "[1] ...").
    /// Default `false` untuk menghasilkan subtitle bersih tanpa nomor indeks (menjawab #79).
    pub include_ayah_number: bool,
    /// Apakah catatan kaki terjemahan disertakan. Default `false` (QRN-13).
    pub include_footnotes: bool,
}

impl Default for SubtitleExportOptions {
    fn default() -> Self {
        Self {
            format: SubtitleFormat::Srt,
            track: SubtitleTrackSelection::AyahOnly,
            include_ayah_number: false, // Menjawab #79: tanpa prefiks [1]
            include_footnotes: false,   // QRN-13: default tanpa footnote
        }
    }
}

/// Struktur entri subtitle internal untuk diekspor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleCue {
    pub start_tick: i64,
    pub end_tick: i64,
    pub ayah_text: Option<String>,
    pub translation_text: Option<String>,
    pub surah_id: u32,
    pub ayah_number: u32,
}

impl SubtitleCue {
    pub fn format_text(&self, options: &SubtitleExportOptions) -> String {
        let prefix = if options.include_ayah_number {
            format!("[{}] ", self.ayah_number)
        } else {
            String::new()
        };

        match options.track {
            SubtitleTrackSelection::AyahOnly => {
                let text = self.ayah_text.as_deref().unwrap_or("");
                format!("{}{}", prefix, text)
            }
            SubtitleTrackSelection::TranslationOnly => {
                let text = self.translation_text.as_deref().unwrap_or("");
                format!("{}{}", prefix, text)
            }
            SubtitleTrackSelection::Bilingual => {
                let ar = self.ayah_text.as_deref().unwrap_or("");
                let tr = self.translation_text.as_deref().unwrap_or("");
                if ar.is_empty() {
                    format!("{}{}", prefix, tr)
                } else if tr.is_empty() {
                    format!("{}{}", prefix, ar)
                } else {
                    format!("{}{}\n{}", prefix, ar, tr)
                }
            }
        }
    }
}

/// Konversi ticks (48.000 Hz) ke format SRT `hh:mm:ss,mmm`.
pub fn ticks_to_srt_timecode(ticks: i64) -> String {
    let total_millis = (ticks.max(0) * 1000) / 48000;
    let millis = total_millis % 1000;
    let total_seconds = total_millis / 1000;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;

    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

/// Konversi ticks (48.000 Hz) ke format WebVTT `hh:mm:ss.mmm`.
pub fn ticks_to_vtt_timecode(ticks: i64) -> String {
    let total_millis = (ticks.max(0) * 1000) / 48000;
    let millis = total_millis % 1000;
    let total_seconds = total_millis / 1000;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;

    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

/// Konversi ticks (48.000 Hz) ke format ASS `h:mm:ss.cc` (centiseconds).
pub fn ticks_to_ass_timecode(ticks: i64) -> String {
    let total_centis = (ticks.max(0) * 100) / 48000;
    let centis = total_centis % 100;
    let total_seconds = total_centis / 100;
    let seconds = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;

    format!("{}:{:02}:{:02}.{:02}", hours, minutes, seconds, centis)
}

/// Generator subtitle SRT.
pub fn generate_srt(cues: &[SubtitleCue], options: &SubtitleExportOptions) -> String {
    let mut out = String::new();
    for (i, cue) in cues.iter().enumerate() {
        let index = i + 1;
        let start = ticks_to_srt_timecode(cue.start_tick);
        let end = ticks_to_srt_timecode(cue.end_tick);
        let text = cue.format_text(options);

        if !text.is_empty() {
            out.push_str(&format!("{}\n{} --> {}\n{}\n\n", index, start, end, text));
        }
    }
    out
}

/// Generator subtitle WebVTT.
pub fn generate_vtt(cues: &[SubtitleCue], options: &SubtitleExportOptions) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for cue in cues {
        let start = ticks_to_vtt_timecode(cue.start_tick);
        let end = ticks_to_vtt_timecode(cue.end_tick);
        let text = cue.format_text(options);

        if !text.is_empty() {
            out.push_str(&format!("{} --> {}\n{}\n\n", start, end, text));
        }
    }
    out
}

/// Generator subtitle ASS (Advanced SubStation Alpha).
pub fn generate_ass(
    cues: &[SubtitleCue],
    options: &SubtitleExportOptions,
    project_name: &str,
) -> String {
    let mut out = String::new();
    out.push_str("[Script Info]\n");
    out.push_str(&format!("Title: {}\n", project_name));
    out.push_str("ScriptType: v4.00+\n");
    out.push_str("WrapStyle: 0\n");
    out.push_str("ScaledBorderAndShadow: yes\n");
    out.push_str("YCbCr Matrix: TV.709\n\n");

    out.push_str("[V4+ Styles]\n");
    out.push_str("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
    out.push_str("Style: Default,Inter,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1\n");
    out.push_str("Style: QuranText,LPMQ IsepMisbah,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1\n\n");

    out.push_str("[Events]\n");
    out.push_str(
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );

    for cue in cues {
        let start = ticks_to_ass_timecode(cue.start_tick);
        let end = ticks_to_ass_timecode(cue.end_tick);
        let text = cue.format_text(options).replace('\n', "\\N");

        if !text.is_empty() {
            let style = match options.track {
                SubtitleTrackSelection::AyahOnly => "QuranText",
                _ => "Default",
            };
            out.push_str(&format!(
                "Dialogue: 0,{},{},{},,0,0,0,,{}\n",
                start, end, style, text
            ));
        }
    }
    out
}

/// Ekspor subtitle dari project data.
pub fn export_subtitles(
    _project: &Project,
    cues: &[SubtitleCue],
    options: &SubtitleExportOptions,
    project_name: &str,
) -> String {
    match options.format {
        SubtitleFormat::Srt => generate_srt(cues, options),
        SubtitleFormat::Vtt => generate_vtt(cues, options),
        SubtitleFormat::Ass => generate_ass(cues, options, project_name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_cues() -> Vec<SubtitleCue> {
        vec![
            SubtitleCue {
                start_tick: 0,
                end_tick: 48000 * 5,
                ayah_text: Some("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ".into()),
                translation_text: Some(
                    "Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.".into(),
                ),
                surah_id: 1,
                ayah_number: 1,
            },
            SubtitleCue {
                start_tick: 48000 * 5,
                end_tick: 48000 * 11,
                ayah_text: Some("الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ".into()),
                translation_text: Some("Segala puji bagi Allah, Tuhan seluruh alam.".into()),
                surah_id: 1,
                ayah_number: 2,
            },
        ]
    }

    #[test]
    fn test_srt_export_without_ayah_number_prefix_clean() {
        let cues = sample_cues();
        let options = SubtitleExportOptions {
            format: SubtitleFormat::Srt,
            track: SubtitleTrackSelection::AyahOnly,
            include_ayah_number: false, // Menjawab #79: tanpa [1]
            include_footnotes: false,
        };

        let srt = generate_srt(&cues, &options);
        assert!(srt.contains("1\n00:00:00,000 --> 00:00:05,000\nبِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"));
        assert!(srt.contains("2\n00:00:05,000 --> 00:00:11,000\nالْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"));
        // Memastikan tidak ada prefiks [1] atau [2] di dalam teks subtitle
        assert!(!srt.contains("[1]"));
        assert!(!srt.contains("[2]"));
    }

    #[test]
    fn test_srt_export_with_ayah_number_when_enabled() {
        let cues = sample_cues();
        let options = SubtitleExportOptions {
            format: SubtitleFormat::Srt,
            track: SubtitleTrackSelection::TranslationOnly,
            include_ayah_number: true,
            include_footnotes: false,
        };

        let srt = generate_srt(&cues, &options);
        assert!(srt.contains("[1] Dengan nama Allah Yang Maha Pengasih, Maha Penyayang."));
        assert!(srt.contains("[2] Segala puji bagi Allah, Tuhan seluruh alam."));
    }

    #[test]
    fn test_vtt_export() {
        let cues = sample_cues();
        let options = SubtitleExportOptions {
            format: SubtitleFormat::Vtt,
            track: SubtitleTrackSelection::AyahOnly,
            include_ayah_number: false,
            include_footnotes: false,
        };

        let vtt = generate_vtt(&cues, &options);
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("00:00:00.000 --> 00:00:05.000\nبِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"));
    }

    #[test]
    fn test_ass_export() {
        let cues = sample_cues();
        let options = SubtitleExportOptions {
            format: SubtitleFormat::Ass,
            track: SubtitleTrackSelection::Bilingual,
            include_ayah_number: false,
            include_footnotes: false,
        };

        let ass = generate_ass(&cues, &options, "Al-Fatihah Test");
        assert!(ass.contains("[Script Info]"));
        assert!(ass.contains("Title: Al-Fatihah Test"));
        assert!(ass.contains("[V4+ Styles]"));
        assert!(ass.contains("[Events]"));
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\\NDengan nama Allah Yang Maha Pengasih, Maha Penyayang."));
    }
}
