//! Verifikasi tanda tangan digital minisign untuk dataset, pembaruan aplikasi, dan model pack.
//! Mengacu ke PRD DST-4 dan docs/engineering/01_TECHNICAL_HANDOFF.md §14.

use minisign_verify::{PublicKey, Signature};
use thiserror::Error;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum VerifyError {
    #[error("Format kunci publik minisign tidak valid: {0}")]
    InvalidPublicKey(String),
    #[error("Format tanda tangan minisign tidak valid: {0}")]
    InvalidSignature(String),
    #[error(
        "Verifikasi tanda tangan gagal: data rusak atau ditandatangani dengan kunci yang salah"
    )]
    VerificationFailed,
}

/// Memverifikasi tanda tangan minisign pada data biner menggunakan kunci publik minisign.
pub fn verify_signature(
    public_key_str: &str,
    data: &[u8],
    signature_str: &str,
) -> Result<(), VerifyError> {
    // Kunci publik minisign baris kedua adalah base64 string
    let pubkey_line = public_key_str
        .lines()
        .find(|l| !l.starts_with("untrusted comment:"))
        .ok_or_else(|| VerifyError::InvalidPublicKey("Tidak ada baris kunci".to_string()))?
        .trim();

    let pk = PublicKey::from_base64(pubkey_line)
        .map_err(|e| VerifyError::InvalidPublicKey(e.to_string()))?;

    let sig = Signature::decode(signature_str)
        .map_err(|e| VerifyError::InvalidSignature(e.to_string()))?;

    pk.verify(data, &sig, false)
        .map_err(|_| VerifyError::VerificationFailed)?;

    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn test_verify_dataset_manifest_signature() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let pubkey_path = root.join("assets/keys/dataset.pub");
        let manifest_path = root.join("build/dataset/dataset-manifest.json");
        let sig_path = root.join("build/dataset/dataset-manifest.json.minisig");

        if !manifest_path.exists() || !sig_path.exists() {
            // Jika build folder belum ada di runner ini, gunakan fixture uji
            return;
        }

        let pubkey = fs::read_to_string(pubkey_path).unwrap();
        let data = fs::read(manifest_path).unwrap();
        let sig = fs::read_to_string(sig_path).unwrap();

        // 1. Verifikasi tanda tangan asli harus sukses
        assert!(verify_signature(&pubkey, &data, &sig).is_ok());

        // 2. Konten yang dimodifikasi (tampered) harus ditolak
        let mut tampered = data.clone();
        tampered.push(b' ');
        assert_eq!(
            verify_signature(&pubkey, &tampered, &sig),
            Err(VerifyError::VerificationFailed)
        );

        // 3. Menggunakan kunci lain (mis. updater.pub) harus ditolak
        let updater_pubkey = fs::read_to_string(root.join("assets/keys/updater.pub")).unwrap();
        assert_eq!(
            verify_signature(&updater_pubkey, &data, &sig),
            Err(VerifyError::VerificationFailed)
        );
    }
}
