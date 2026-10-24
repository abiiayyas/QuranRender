//! Adapter jaringan: Quran.com (QRN-12), paket model, update data, verifikasi tanda tangan, dan allowlist domain.
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §8.

pub mod ai_trim;
pub mod allowlist;
pub mod cloud_aligner;
mod cloud_aligner_word_map;
pub mod content_db;
pub mod http;
pub mod quran_api;
pub mod quran_com;
pub mod verify;

pub use allowlist::{NetworkPolicy, DEFAULT_ALLOWED_DOMAINS};
pub use cloud_aligner::{
    map_alignment, AlignProgressEvent, AlignStage, CloudAlignOptions, CloudAlignOutcome,
    CloudAlignerClient, CloudError, CloudModel, DetectedRange,
};
pub use content_db::{ContentDb, InstalledEdition, TranslationVerse};
pub use http::{HttpTransport, NetError, UreqTransport};
pub use quran_api::{installed_edition_key, remote_id_from_key, RemoteEdition, QURAN_API_BASE};
pub use quran_com::{
    extract_clean_translation_and_footnotes, parse_quran_com_payload, FootnoteItem,
    QuranComTranslationItem, QuranComTranslationResponse,
};
pub use verify::{verify_signature, VerifyError};

#[derive(Debug, Clone)]
pub struct QuranDotComAdapter;
