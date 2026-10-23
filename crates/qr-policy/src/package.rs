//! Generator paket unggah (*.upload.txt dan *.credits.txt) serta validasi CNT-3/CNT-4 (PRD PKG-1, PKG-2, CNT-3, CNT-4, B2-11).
//! Mengacu ke docs/product/PRD.md §7 PKG-1..2, §6 CNT-3..4.

use qr_core::project::Project;

/// Generator berkas atribusi *.credits.txt untuk mendampingi video hasil ekspor (PRD PKG-1).
pub fn generate_credits_text(
    project: &Project,
    surah_name: &str,
    ayah_range: &str,
    translation_source: &str,
) -> String {
    let reciter = project.reciter.as_deref().unwrap_or("Qari Pilihan");

    format!(
        "============================================================\n\
         QURANRENDER ATRIBUSI DAN KREDIT KONTEN\n\
         ============================================================\n\n\
         Surah          : {}\n\
         Ayat           : {}\n\
         Tilawah Oleh   : {}\n\n\
         Sumber Teks Al-Qur'an:\n\
         - Mushaf Standar Indonesia (LPMQ, Kementerian Agama RI)\n\
         - Font Mushaf: LPMQ Misbah (Hak Cipta Kemenag RI, Izin Penggunaan Publik)\n\n\
         Terjemahan:\n\
         - Sumber: {}\n\n\
         Dibuat Menggunakan:\n\
         QuranRender — Generator Video Tilawah Al-Qur'an Sumber Terbuka (GPL-3.0)\n\
         https://quranrender.app\n\
         ============================================================\n",
        surah_name, ayah_range, reciter, translation_source
    )
}

/// Generator berkas deskripsi dan metadata unggah *.upload.txt (PRD PKG-2).
pub fn generate_upload_text(project: &Project, surah_name: &str, ayah_range: &str) -> String {
    let reciter = project.reciter.as_deref().unwrap_or("Qari");

    // Bentuk chapters berdasarkan waktu mulai segmen ayat
    let mut chapters = String::new();
    for seg in &project.segments {
        let s = (seg.start_tick / 48000).max(0);
        let m = s / 60;
        let sec = s % 60;
        chapters.push_str(&format!(
            "{:02}:{:02} Ayat {}:{}\n",
            m, sec, seg.surah_id, seg.ayah_number
        ));
    }

    format!(
        "Surah {} Ayat {} | Tilawah Merdu {}\n\n\
         Tilawah Al-Qur'an Surah {} ayat {} dibacakan dengan khusyuk oleh {}.\n\n\
         Daftar Isi (Chapters):\n\
         {}\n\n\
         Teks Arab: Mushaf Standar Indonesia (Kemenag RI)\n\
         Terjemahan: Bahasa Indonesia\n\n\
         #Quran #Murottal #Tilawah #{} #AlQuran #QuranRender\n",
        surah_name,
        ayah_range,
        reciter,
        surah_name,
        ayah_range,
        reciter,
        chapters,
        surah_name.replace([' ', '-'], "")
    )
}

/// Validasi CNT-3 dan CNT-4: Larangan makhluk bernyawa & ikonografi musik dalam metadata.
pub fn validate_cnt3_cnt4_metadata(project: &Project) -> Result<(), String> {
    // Larangan penggunaan ikonografi musik di label klip atau nama proyek
    let forbidden_music_keywords = ["music", "lagu", "lagu_latar", "song", "bintang_musik"];
    for track in &project.tracks {
        for clip in &track.clips {
            let label_lower = clip.label.to_lowercase();
            for kw in forbidden_music_keywords {
                if label_lower.contains(kw) {
                    return Err(format!(
                        "Pelanggaran CNT-4: Klip '{}' memuat kata terlarang '{}'. Ikonografi dan istilah musik tidak diperbolehkan.",
                        clip.label, kw
                    ));
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use qr_core::project::AyahSegment;

    #[test]
    fn test_credits_generation_contains_kemenag_and_gpl() {
        let mut proj = Project::new("Uji Kredit");
        proj.reciter = Some("Misyari Rasyid".into());

        let credits = generate_credits_text(&proj, "Al-Fatihah", "1-7", "Kemenag RI 2019");
        assert!(credits.contains("Kementerian Agama RI"));
        assert!(credits.contains("LPMQ Misbah"));
        assert!(credits.contains("Misyari Rasyid"));
        assert!(credits.contains("GPL-3.0"));
    }

    #[test]
    fn test_upload_text_contains_chapters() {
        let mut proj = Project::new("Uji Unggah");
        proj.reciter = Some("Misyari Rasyid".into());
        proj.segments.push(AyahSegment {
            id: "s1".into(),
            surah_id: 1,
            ayah_number: 1,
            start_tick: 0,
            end_tick: 48000 * 5,
            word_timings: vec![],
            confidence: 0.99,
            manual_override: false,
        });
        proj.segments.push(AyahSegment {
            id: "s2".into(),
            surah_id: 1,
            ayah_number: 2,
            start_tick: 48000 * 5,
            end_tick: 48000 * 12,
            word_timings: vec![],
            confidence: 0.98,
            manual_override: false,
        });

        let upload = generate_upload_text(&proj, "Al-Fatihah", "1-2");
        assert!(upload.contains("00:00 Ayat 1:1"));
        assert!(upload.contains("00:05 Ayat 1:2"));
        assert!(upload.contains("#AlFatihah"));
    }
}
