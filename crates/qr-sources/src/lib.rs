//! Adapter jaringan: Quran.com (QRN-12), paket model, update data, dan verifikasi tanda tangan.
//! Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §8.

pub mod verify;

pub use verify::{verify_signature, VerifyError};

#[derive(Debug, Clone)]
pub struct QuranDotComAdapter;
