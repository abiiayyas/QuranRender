//! Resolusi terjemahan per segmen (dipakai preview, worker ekspor, dan subtitle) serta pemotongan
//! terjemahan heuristik untuk segmen sebagian ayat.
//!
//! Aturan (paritas Quran Caption, lihat `AyahSegment::translations`):
//! - ayat utuh (`word_range == None`) → teks ayat edisi apa adanya (lengkap, tanpa status);
//! - sebagian ayat → entri segmen untuk edisi itu bila ada; bila tidak, teks ayat utuh berstatus
//!   `ToReview`;
//! - basmalah/isti'adzah → entri segmen bila ada, selain itu terjemahan bawaan sesuai bahasa edisi
//!   (id, en); bahasa lain tidak mendapat terjemahan.
//!
//! Urutan hasil mengikuti `Project::translation_editions` (pertama = utama).

use qr_core::project::{AyahSegment, SegmentKind, TranslationStatus};
use std::collections::BTreeMap;

/// Isti'adzah (bukan ayat Al-Qur'an; teks tetap bawaan aplikasi, ditampilkan tanpa label surah/ayat).
pub const ISTIADHA_AR: &str = "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ";

/// Terjemahan satu edisi untuk satu segmen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTranslation {
    pub edition_key: String,
    pub text: String,
    /// `None` = lengkap secara bawaan (ayat utuh / teks khusus bawaan); `Some` = status peninjauan.
    pub status: Option<TranslationStatus>,
}

/// Kode bahasa edisi dari kuncinya (`id.kemenag` → `id`, `en.qdc20` → `en`).
pub fn edition_language(edition_key: &str) -> &str {
    edition_key.split('.').next().unwrap_or("")
}

/// Terjemahan bawaan segmen khusus untuk bahasa `lang`; `None` untuk ayat atau bahasa lain.
pub fn special_translation(kind: SegmentKind, lang: &str) -> Option<&'static str> {
    match (kind, lang) {
        (SegmentKind::Basmala, "id") => {
            Some("Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.")
        }
        (SegmentKind::Basmala, "en") => {
            Some("In the name of Allah, the Entirely Merciful, the Especially Merciful.")
        }
        (SegmentKind::Istiadha, "id") => {
            Some("Aku berlindung kepada Allah dari setan yang terkutuk.")
        }
        (SegmentKind::Istiadha, "en") => Some("I seek refuge in Allah from the accursed Satan."),
        _ => None,
    }
}

/// Terjemahan segmen untuk tiap edisi di `editions` (urut). `whole` = teks ayat utuh per edisi (hanya
/// edisi yang tersedia). Edisi tanpa teks sama sekali dilewati.
pub fn resolve_segment_translations(
    seg: &AyahSegment,
    editions: &[String],
    whole: &BTreeMap<String, String>,
) -> Vec<ResolvedTranslation> {
    editions
        .iter()
        .filter_map(|key| {
            let entry = seg
                .translations
                .get(key)
                .filter(|t| !t.text.trim().is_empty());
            let (text, status) = match seg.kind {
                SegmentKind::Basmala | SegmentKind::Istiadha => match entry {
                    Some(t) => (t.text.clone(), Some(t.status)),
                    None => (
                        special_translation(seg.kind, edition_language(key))?.to_string(),
                        None,
                    ),
                },
                SegmentKind::Ayah => match (seg.word_range, entry) {
                    (None, _) => (whole.get(key)?.clone(), None),
                    (Some(_), Some(t)) => (t.text.clone(), Some(t.status)),
                    (Some(_), None) => (whole.get(key)?.clone(), Some(TranslationStatus::ToReview)),
                },
            };
            Some(ResolvedTranslation {
                edition_key: key.clone(),
                text,
                status,
            })
        })
        .collect()
}

/// Perlu ditinjau: terjemahan berstatus selain `Reviewed`.
pub fn needs_review(status: Option<TranslationStatus>) -> bool {
    matches!(status, Some(s) if s != TranslationStatus::Reviewed)
}

/// Tanda baca penutup frasa: batas potong yang disukai.
fn ends_phrase(token: &str) -> bool {
    token
        .trim_end_matches(['"', '\'', '”', '’', ')', ']', '»'])
        .ends_with([',', '.', ';', ':', '!', '?', '—', '–', '-', '،', '؛'])
        || token.ends_with([')', ']'])
}

/// Memotong terjemahan ayat utuh untuk rentang kata `word_range` (1-based inklusif) dari ayat
/// berjumlah `total_words` kata Arab. Posisi potong proporsional terhadap panjang terjemahan, lalu
/// digeser ke batas frasa (tanda baca) terdekat bila cukup dekat, selain itu ke batas kata terdekat.
///
/// Batas akhir rentang k dan batas awal rentang k+1 dihitung dari posisi yang sama, sehingga potongan
/// segmen-segmen berurutan menyambung tanpa celah atau tumpang tindih. Hasil tidak pernah kosong.
pub fn auto_trim_translation(full: &str, word_range: (u32, u32), total_words: u32) -> String {
    let tokens: Vec<&str> = full.split_whitespace().collect();
    if tokens.is_empty() || total_words == 0 {
        return tokens.join(" ");
    }
    let n = total_words;
    let a = word_range.0.clamp(1, n);
    let b = word_range.1.clamp(a, n);
    let m = tokens.len();
    // Posisi karakter awal tiap token dalam teks yang dinormalisasi (dipisah satu spasi).
    let mut starts = Vec::with_capacity(m + 1);
    let mut pos = 0usize;
    for t in &tokens {
        starts.push(pos);
        pos += t.chars().count() + 1;
    }
    let total_chars = pos.saturating_sub(1);
    starts.push(pos);

    let boundary = |word_boundary: u32| -> usize {
        // Batas setelah `word_boundary` kata Arab dari total `n`.
        if word_boundary == 0 {
            return 0;
        }
        if word_boundary >= n {
            return m;
        }
        let target = total_chars as f64 * f64::from(word_boundary) / f64::from(n);
        // Jendela "cukup dekat" untuk tanda baca: ±1,2 × rata-rata panjang terjemahan per kata Arab
        // (minimal 12 karakter). Di luar jendela, batas kata terdekat dipakai.
        let window = (total_chars as f64 / f64::from(n) * 1.2).max(12.0);
        let dist = |i: usize| (starts[i] as f64 - target).abs();
        let nearest = (1..m)
            .min_by(|&x, &y| dist(x).total_cmp(&dist(y)))
            .unwrap_or(m);
        (1..m)
            .filter(|&i| ends_phrase(tokens[i - 1]) && dist(i) <= window)
            .min_by(|&x, &y| dist(x).total_cmp(&dist(y)))
            .unwrap_or(nearest)
    };

    let mut s = boundary(a - 1);
    let mut e = boundary(b);
    if s >= e {
        // Terjemahan terlalu pendek untuk dibagi: ambil satu token di posisi proporsional.
        let idx = ((f64::from(a - 1) / f64::from(n)) * m as f64) as usize;
        s = idx.min(m - 1);
        e = s + 1;
    }
    tokens[s..e].join(" ")
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use qr_core::project::SegmentTranslation;

    fn eds(keys: &[&str]) -> Vec<String> {
        keys.iter().map(|k| (*k).to_string()).collect()
    }

    fn whole() -> BTreeMap<String, String> {
        BTreeMap::from([
            (
                "id.kemenag".into(),
                "Segala puji bagi Allah, Tuhan seluruh alam.".into(),
            ),
            (
                "en.qdc20".into(),
                "[All] praise is [due] to Allah, Lord of the worlds -".into(),
            ),
        ])
    }

    fn seg(range: Option<(u32, u32)>) -> AyahSegment {
        AyahSegment {
            id: "s".into(),
            surah_id: 1,
            ayah_number: 2,
            word_range: range,
            ..Default::default()
        }
    }

    #[test]
    fn whole_ayah_uses_edition_text_in_project_order_without_status() {
        let r =
            resolve_segment_translations(&seg(None), &eds(&["en.qdc20", "id.kemenag"]), &whole());
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].edition_key, "en.qdc20");
        assert!(r[0].text.starts_with("[All] praise"));
        assert_eq!(r[1].edition_key, "id.kemenag");
        assert!(r.iter().all(|t| t.status.is_none()));
    }

    #[test]
    fn whole_ayah_ignores_stale_segment_entries() {
        let mut s = seg(None);
        s.translations.insert(
            "id.kemenag".into(),
            SegmentTranslation {
                text: "lama".into(),
                status: TranslationStatus::AutoTrimmed,
            },
        );
        let r = resolve_segment_translations(&s, &eds(&["id.kemenag"]), &whole());
        assert_eq!(r[0].text, whole()["id.kemenag"]);
    }

    #[test]
    fn partial_ayah_prefers_entry_else_whole_text_to_review() {
        let mut s = seg(Some((1, 2)));
        s.translations.insert(
            "id.kemenag".into(),
            SegmentTranslation {
                text: "Segala puji bagi Allah,".into(),
                status: TranslationStatus::Reviewed,
            },
        );
        let r = resolve_segment_translations(&s, &eds(&["id.kemenag", "en.qdc20"]), &whole());
        assert_eq!(r[0].text, "Segala puji bagi Allah,");
        assert_eq!(r[0].status, Some(TranslationStatus::Reviewed));
        assert_eq!(r[1].text, whole()["en.qdc20"]);
        assert_eq!(r[1].status, Some(TranslationStatus::ToReview));
        assert!(!needs_review(r[0].status));
        assert!(needs_review(r[1].status));
    }

    #[test]
    fn missing_edition_is_skipped() {
        let r = resolve_segment_translations(
            &seg(Some((1, 2))),
            &eds(&["fr.qdc31", "id.kemenag"]),
            &whole(),
        );
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].edition_key, "id.kemenag");
    }

    #[test]
    fn special_segments_get_builtin_translation_by_language() {
        let mut s = AyahSegment {
            kind: SegmentKind::Istiadha,
            ..Default::default()
        };
        let r = resolve_segment_translations(
            &s,
            &eds(&["id.kemenag", "en.qdc20", "ur.qdc97"]),
            &BTreeMap::new(),
        );
        assert_eq!(r.len(), 2, "bahasa tanpa teks bawaan dilewati");
        assert!(r[0].text.starts_with("Aku berlindung"));
        assert!(r[1].text.starts_with("I seek refuge"));
        assert!(r.iter().all(|t| t.status.is_none()));
        s.kind = SegmentKind::Basmala;
        s.translations.insert(
            "en.qdc20".into(),
            SegmentTranslation {
                text: "In the name of God".into(),
                status: TranslationStatus::Reviewed,
            },
        );
        let r = resolve_segment_translations(&s, &eds(&["id.kemenag", "en.qdc20"]), &whole());
        assert!(r[0].text.starts_with("Dengan nama Allah"));
        assert_eq!(r[1].text, "In the name of God");
    }

    #[test]
    fn auto_trim_snaps_to_punctuation_and_is_contiguous() {
        let full = "O you who have believed, when you contract a debt for a specified term, write it down. And let a scribe write [it] between you in justice.";
        let n = 20;
        // Batas kata 4/20 ≈ karakter 28 → koma "believed," (karakter 25) dekat; 12/20 ≈ 85 → titik
        // "down." (89) lebih dekat daripada koma "term," (72) yang di luar jendela.
        let first = auto_trim_translation(full, (1, 4), n);
        let second = auto_trim_translation(full, (5, 12), n);
        let third = auto_trim_translation(full, (13, 20), n);
        assert_eq!(first, "O you who have believed,");
        assert!(second.ends_with("write it down."), "{second}");
        // Menyambung: gabungan = teks utuh, tanpa celah/tumpang tindih.
        assert_eq!(format!("{first} {second} {third}"), full);
        // Tanpa tanda baca dekat: batas kata terdekat (posisi proporsional).
        let mid = auto_trim_translation(full, (1, 7), n);
        assert!(!mid.ends_with(','), "{mid}");
        assert!(full.starts_with(&mid));
    }

    #[test]
    fn auto_trim_falls_back_to_word_boundary_and_covers_edges() {
        let full = "alpha beta gamma delta epsilon zeta eta theta";
        assert_eq!(
            auto_trim_translation(full, (1, 2), 4),
            "alpha beta gamma delta"
        );
        assert_eq!(
            auto_trim_translation(full, (3, 4), 4),
            "epsilon zeta eta theta"
        );
        assert_eq!(auto_trim_translation(full, (1, 4), 4), full);
    }

    #[test]
    fn auto_trim_never_returns_empty() {
        assert_eq!(auto_trim_translation("Satu.", (2, 2), 5), "Satu.");
        assert_eq!(auto_trim_translation("dua kata", (5, 5), 9), "dua");
        assert_eq!(auto_trim_translation("", (1, 1), 3), "");
        // Rentang di luar batas dijepit.
        assert_eq!(auto_trim_translation("a b c", (0, 99), 3), "a b c");
    }
}
