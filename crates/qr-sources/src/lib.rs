//! Adapter jaringan: Quran.com (QRN-12), paket model, update data, verifikasi tanda tangan, dan allowlist domain.
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §8.

pub mod allowlist;
pub mod content_db;
pub mod quran_com;
pub mod verify;

pub use allowlist::{NetworkPolicy, DEFAULT_ALLOWED_DOMAINS};
pub use content_db::{ContentDb, InstalledEdition, TranslationVerse};
pub use quran_com::{
    extract_clean_translation_and_footnotes, parse_quran_com_payload, FootnoteItem,
    QuranComTranslationItem, QuranComTranslationResponse,
};
pub use verify::{verify_signature, VerifyError};

#[derive(Debug, Clone)]
pub struct QuranDotComAdapter;
