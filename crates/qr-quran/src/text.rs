//! Modul normalisasi teks Al-Qur'an, tokenizer v1, dan fungsi pencarian.
//! Mengacu ke docs/engineering/03_DATASET_PIPELINE.md §5.3, §5.4, §5.5, §5.6.

use thiserror::Error;

/// Allowlist codepoint bahasa Arab v1 (75 codepoint).
/// Codepoint di luar daftar ini menggagalkan verifikasi dataset (03 §5.3).
pub const ARABIC_ALLOWLIST_V1: &[u32] = &[
    0x0020, // space
    0x0608, 0x0609, // ray, small high start of rub el hizb (anomali diawasi)
    0x0621, 0x0622, 0x0623, 0x0624, 0x0626, 0x0627, 0x0628, 0x0629, 0x062A, 0x062B, 0x062C, 0x062D,
    0x062E, 0x062F, 0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639,
    0x063A, // huruf
    0x0640, 0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x0649,
    0x064A, // huruf & tatweel
    0x064B, 0x064C, 0x064D, 0x064E, 0x064F, 0x0650, 0x0651, 0x0652, 0x0653, 0x0654, 0x0655, 0x0656,
    0x0657, // harakat
    0x0670, // dagger alif
    0x06D4, 0x06D5, // arabic full stop / penanda akhir juz, ae
    0x06D6, 0x06D7, 0x06D8, 0x06D9, 0x06DA, 0x06DB, 0x06DC, // tanda waqaf
    0x06DE, 0x06DF,
    0x06E0, // rub el hizb, small high rounded zero, small high upright rectangular zero
    0x06E2, 0x06E3, 0x06E4, // small high meem isolated, small low seen, small high mad
    0x06E7, 0x06E8, 0x06E9, 0x06EA, 0x06EB, 0x06EC, // tanda tajwid, sajdah
    0x08D6, // small high ligatures
];

#[derive(Error, Debug, PartialEq, Eq)]
pub enum TextError {
    #[error("Karakter tidak diizinkan dalam allowlist v1: U+{0:04X}")]
    DisallowedCodepoint(u32),
    #[error("Token tanda di awal ayat sebelum kata huruf: '{0}'")]
    LeadingSignToken(String),
    #[error("Prefix ۞ tidak diikuti kata huruf")]
    TrailingRubElHizbPrefix,
    #[error("Ayat tidak memiliki kata huruf")]
    NoWordsInAyah,
    #[error("Teks terjemahan kosong setelah dibersihkan")]
    EmptyTranslation,
}

/// Token hasil tokenisasi kata v1 (03 §5.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordToken {
    /// Indeks kata dalam ayat (1-based, 1..n).
    pub idx: u32,
    /// Offset awal byte dalam teks ayat yang telah di-trim.
    pub span_start: usize,
    /// Offset akhir byte dalam teks ayat yang telah di-trim.
    pub span_end: usize,
    /// Offset awal byte dari huruf inti kata (core).
    pub core_start: usize,
    /// Offset akhir byte dari huruf inti kata (core).
    pub core_end: usize,
    /// Teks utuh kata (termasuk tanda waqaf/awalan bila ada).
    pub text: String,
    /// Huruf inti kata (tanpa tanda terpisah atau prefix rub el hizb).
    pub core: String,
    /// Bentuk pencarian kata (FTS).
    pub search_form: String,
}

/// Metadata dan bendera hasil pemrosesan satu ayat.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AyahMeta {
    pub has_juz_end_mark: bool,
    pub has_rub_el_hizb: bool,
    pub has_sajdah: bool,
}

/// Memvalidasi bahwa seluruh codepoint dalam teks Arab mematuhi allowlist v1.
pub fn validate_arabic_allowlist(text: &str) -> Result<(), TextError> {
    for c in text.chars() {
        let cp = c as u32;
        if !ARABIC_ALLOWLIST_V1.contains(&cp) {
            return Err(TextError::DisallowedCodepoint(cp));
        }
    }
    Ok(())
}

/// Memeriksa apakah suatu token memuat huruf Arab (kategori Unicode `Lo` atau karakter abjad Arab).
pub fn is_letter_token(token: &str) -> bool {
    token.chars().any(|c| {
        let cp = c as u32;
        (0x0621..=0x064A).contains(&cp)
            || (0x066E..=0x066F).contains(&cp)
            || (0x0671..=0x06D5).contains(&cp)
            || (0x08A0..=0x08BA).contains(&cp)
    })
}

/// Tokenisasi teks ayat Al-Qur'an sesuai spesifikasi Tokenizer v1 (03 §5.4).
/// Mengembalikan daftar kata dan metadata ayat.
pub fn tokenize_ayah_v1(raw_text: &str) -> Result<(Vec<WordToken>, AyahMeta), TextError> {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return Err(TextError::NoWordsInAyah);
    }

    validate_arabic_allowlist(trimmed)?;

    let mut words = Vec::new();
    let mut meta = AyahMeta::default();

    if trimmed.contains('\u{06E9}') {
        meta.has_sajdah = true;
    }

    let mut pending_prefix_span: Option<(usize, usize)> = None;

    // Lacak offset byte dengan teliti saat melakukan split pada spasi
    let mut byte_offset = 0;
    for part in trimmed.split(' ') {
        let part_len = part.len();
        let part_start = byte_offset;
        let part_end = part_start + part_len;
        byte_offset += part_len + 1; // +1 untuk spasi U+0020

        if part.is_empty() {
            continue;
        }

        // Aturan 1: U+06D4 (۔) penanda akhir juz dibuang dari kata
        if part == "\u{06D4}" {
            meta.has_juz_end_mark = true;
            continue;
        }

        // Aturan 2: U+06DE (۞) disimpan sebagai prefix tertunda
        if part == "\u{06DE}" {
            meta.has_rub_el_hizb = true;
            pending_prefix_span = Some((part_start, part_end));
            continue;
        }

        if is_letter_token(part) {
            // Aturan 3: Token huruf membuka kata baru
            let span_start = if let Some((prefix_start, _)) = pending_prefix_span.take() {
                prefix_start
            } else {
                part_start
            };

            let core = part.to_string();
            let search = search_form(&core);

            words.push(WordToken {
                idx: (words.len() + 1) as u32,
                span_start,
                span_end: part_end,
                core_start: part_start,
                core_end: part_end,
                text: trimmed[span_start..part_end].to_string(),
                core,
                search_form: search,
            });
        } else {
            // Aturan 4: Token tanda lain menempel ke kata terakhir
            if let Some(last_word) = words.last_mut() {
                last_word.span_end = part_end;
                last_word.text = trimmed[last_word.span_start..part_end].to_string();
            } else {
                return Err(TextError::LeadingSignToken(part.to_string()));
            }
        }
    }

    if pending_prefix_span.is_some() {
        return Err(TextError::TrailingRubElHizbPrefix);
    }

    if words.is_empty() {
        return Err(TextError::NoWordsInAyah);
    }

    Ok((words, meta))
}

/// Menghasilkan bentuk pencarian (FTS & alignment) dari huruf inti kata (03 §5.5).
pub fn search_form(core: &str) -> String {
    let mut out = String::with_capacity(core.len());
    for c in core.chars() {
        let cp = c as u32;

        // 1. Buang harakat & tanda waqaf / tajwid
        if (0x064B..=0x065F).contains(&cp)
            || cp == 0x0670
            || (0x06D6..=0x06ED).contains(&cp)
            || (0x08D3..=0x08FF).contains(&cp)
            || cp == 0x0640
            || cp == 0x0608
            || cp == 0x0609
        {
            continue;
        }

        // 2. Petakan varian alif (آ, أ, إ, ٱ) -> ا
        if cp == 0x0622 || cp == 0x0623 || cp == 0x0625 || cp == 0x0671 {
            out.push('\u{0627}');
            continue;
        }

        // 3. Petakan alif maqsurah (ى) -> ya (ي), ta marbutah (ة) -> ha (ه)
        if cp == 0x0649 {
            out.push('\u{064A}');
            continue;
        }
        if cp == 0x0629 {
            out.push('\u{0647}');
            continue;
        }

        out.push(c);
    }
    out
}

/// Membersihkan teks terjemahan Kemenag (03 §5.6).
pub fn clean_translation(raw: &str) -> Result<String, TextError> {
    // 1. Buang tag HTML
    let mut inside_tag = false;
    let mut cleaned_chars = Vec::with_capacity(raw.len());
    for c in raw.chars() {
        if c == '<' {
            inside_tag = true;
            continue;
        }
        if c == '>' {
            inside_tag = false;
            continue;
        }
        if !inside_tag {
            cleaned_chars.push(c);
        }
    }
    let intermediate: String = cleaned_chars.into_iter().collect();

    // 2. Decode HTML entities umum bila ada
    let decoded = intermediate
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&apos;", "'");

    // 3. Normalisasi whitespace (spasi berulang -> satu spasi, trim)
    let words: Vec<&str> = decoded.split_whitespace().collect();
    let result = words.join(" ");

    if result.is_empty() {
        return Err(TextError::EmptyTranslation);
    }

    Ok(result)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_translation() {
        assert_eq!(
            clean_translation("<p>Dengan nama Allah Yang Maha Pengasih lagi Maha Penyayang.</p>")
                .unwrap(),
            "Dengan nama Allah Yang Maha Pengasih lagi Maha Penyayang."
        );
        assert_eq!(
            clean_translation("  Segala  puji   bagi Allah,    Tuhan   seluruh alam.  ").unwrap(),
            "Segala puji bagi Allah, Tuhan seluruh alam."
        );
        assert!(clean_translation("<p>   </p>").is_err());
    }

    #[test]
    fn test_search_form() {
        // Al-Fatihah 1:1 kata pertama "بِسْمِ" -> "بسم"
        assert_eq!(search_form("بِسْمِ"), "بسم");
        // "ٱلرَّحْمَٰنِ" -> "الرحمن"
        assert_eq!(search_form("ٱلرَّحْمَٰنِ"), "الرحمن");
        // Ta marbutah "ة" -> "ه"
        assert_eq!(search_form("الصَّلَوٰةَ"), "الصلوه");
        // Alif maqsurah "ى" -> "ي"
        assert_eq!(search_form("هُدًى"), "هدي");
    }

    #[test]
    fn test_tokenizer_basic() {
        let bismillah = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
        let (words, meta) = tokenize_ayah_v1(bismillah).unwrap();
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].core, "بِسْمِ");
        assert_eq!(words[0].idx, 1);
        assert_eq!(words[3].core, "الرَّحِيمِ");
        assert_eq!(words[3].idx, 4);
        assert!(!meta.has_rub_el_hizb);
        assert!(!meta.has_juz_end_mark);
    }

    #[test]
    fn test_tokenizer_rub_el_hizb_prefix() {
        let text = "۞ قَدْ أَفْلَحَ";
        let (words, meta) = tokenize_ayah_v1(text).unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "۞ قَدْ");
        assert_eq!(words[0].core, "قَدْ");
        assert!(meta.has_rub_el_hizb);
    }

    #[test]
    fn test_tokenizer_waqf_attachment() {
        let text = "الْحَمْدُ لِلَّهِ ۚ";
        let (words, _) = tokenize_ayah_v1(text).unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[1].text, "لِلَّهِ ۚ");
        assert_eq!(words[1].core, "لِلَّهِ");
    }
}
