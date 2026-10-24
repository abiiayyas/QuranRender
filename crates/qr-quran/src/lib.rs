//! Akses dataset Al-Qur'an runtime, normalisasi teks, dan tokenizer v1.
//! Mengacu ke docs/engineering/03_DATASET_PIPELINE.md dan 02_DATABASE_SPECIFICATION.md §3.

pub mod dataset;
pub mod text;

pub use dataset::{
    Ayah, DatasetEdition, DatasetError, DatasetInfo, FullAyah, Juz, QuranDatabase, SearchResult,
    Surah, Word,
};
pub use text::{
    clean_translation, is_letter_token, search_form, tokenize_ayah_v1, validate_arabic_allowlist,
    AyahMeta, TextError, WordToken, ARABIC_ALLOWLIST_V1,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuranVerse {
    pub surah: u32,
    pub ayah: u32,
    pub arabic: String,
    pub translation: String,
}
