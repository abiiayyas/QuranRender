use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize, Serialize)]
struct ContentManifest {
    schema: u32,
    entries: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ManifestEntry {
    path: String,
    sha256: String,
    kind: String,
    source: String,
    license: String,
    attribution: String,
    redistribution: String,
}

#[derive(Debug, Deserialize)]
struct SurahListItem {
    nomor: u32,
    jumlah_ayat: u32,
    tempat_turun: String,
}

#[derive(Debug, Deserialize)]
struct RawAyah {
    aya_id: u32,
    aya_number: u32,
    aya_text: String,
    sura_id: u32,
    juz_id: u32,
    page_number: u32,
    translation_aya_text: String,
}

#[derive(Debug, Deserialize)]
struct SurahData {
    data: Vec<RawAyah>,
}

#[derive(Debug, Deserialize)]
struct JuzData {
    nomor: u32,
    data: Vec<RawAyah>,
}

fn compute_sha256(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("Gagal membuka file untuk hash: {:?}", path))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

/// S0: Verifikasi manifest terhadap file di disk (03 §5.1)
pub fn verify_manifest(manifest_path: &Path, is_release: bool) -> Result<usize> {
    let content = fs::read_to_string(manifest_path)
        .with_context(|| format!("Gagal membaca manifest di {:?}", manifest_path))?;
    let manifest: ContentManifest =
        serde_json::from_str(&content).context("Format content-manifest.json tidak valid")?;

    if manifest.schema != 1 {
        bail!(
            "Skema content-manifest.json harus 1, ditemukan {}",
            manifest.schema
        );
    }

    let base_dir = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let mut tracked_paths = HashSet::new();

    for entry in &manifest.entries {
        let p = base_dir.join(&entry.path);
        if !p.exists() {
            bail!("File di manifest tidak ditemukan di disk: {:?}", p);
        }

        let actual_hash = compute_sha256(&p)?;
        if actual_hash != entry.sha256 {
            bail!(
                "Hash mismatch untuk {}: manifest={}, disk={}",
                entry.path,
                entry.sha256,
                actual_hash
            );
        }

        if is_release
            && (entry.source.contains("PERLU DIISI")
                || entry.license.contains("PERLU DIISI")
                || entry.attribution.contains("PERLU DIISI"))
        {
            bail!("Build rilis menolak entri PERLU DIISI di {}", entry.path);
        }

        let canonical_p = p.canonicalize().unwrap_or(p);
        tracked_paths.insert(canonical_p);
    }

    // Periksa bahwa tidak ada file di data/ atau assets/fonts/quran/ yang terlewat
    let check_dirs = [
        base_dir.join("data/surah"),
        base_dir.join("data/juz"),
        base_dir.join("assets/fonts/quran"),
    ];

    for dir in &check_dirs {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                // Abaikan file tersembunyi
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') {
                        continue;
                    }
                }
                let canonical_path = path.canonicalize().unwrap_or(path.clone());
                if !tracked_paths.contains(&canonical_path) {
                    bail!("File tidak terdaftar di content-manifest.json: {:?}", path);
                }
            }
        }
    }

    Ok(manifest.entries.len())
}

/// S1 & S2: Parse sumber dan validasi struktur invarian (03 §5.2)
pub fn verify_structure(root_dir: &Path) -> Result<()> {
    let surah_list_path = root_dir.join("data/surah/list-surah.json");
    let surah_list_content = fs::read_to_string(&surah_list_path)
        .with_context(|| format!("Gagal membaca {:?}", surah_list_path))?;
    let surah_list: Vec<SurahListItem> = serde_json::from_str(&surah_list_content)?;

    if surah_list.len() != 114 {
        bail!(
            "list-surah.json harus memuat 114 surah, ditemukan {}",
            surah_list.len()
        );
    }

    let mut surah_ayat_counts = HashMap::new();
    let mut makkiyah_count = 0;
    let mut madaniyah_count = 0;

    for s in &surah_list {
        surah_ayat_counts.insert(s.nomor, s.jumlah_ayat);
        match s.tempat_turun.to_lowercase().as_str() {
            "mekah" => makkiyah_count += 1,
            "madinah" => madaniyah_count += 1,
            other => bail!("Tempat turun tidak valid pada surah {}: {}", s.nomor, other),
        }
    }

    if makkiyah_count != 86 || madaniyah_count != 28 {
        bail!(
            "Distribusi tempat turun salah: makkiyah={}, madaniyah={} (diharapkan 86 & 28)",
            makkiyah_count,
            madaniyah_count
        );
    }

    let mut expected_aya_id = 1;
    let mut last_juz_id = 1;
    let mut last_page_number = 1;
    let mut unique_pages = HashSet::new();
    let mut surah_ayahs_map: HashMap<(u32, u32), RawAyah> = HashMap::new();

    // Validasi 114 file surah
    for sura_id in 1..=114 {
        let surah_path = root_dir.join(format!("data/surah/{}.json", sura_id));
        let content = fs::read_to_string(&surah_path)
            .with_context(|| format!("Gagal membaca {:?}", surah_path))?;
        let surah: SurahData = serde_json::from_str(&content)?;

        let expected_count = *surah_ayat_counts
            .get(&sura_id)
            .context("Surah tidak ditemukan di list-surah.json")?;
        if surah.data.len() as u32 != expected_count {
            bail!(
                "Jumlah ayat surah {} ({}) tidak cocok dengan list-surah.json ({})",
                sura_id,
                surah.data.len(),
                expected_count
            );
        }

        for (expected_aya_num, ayah) in (1..).zip(surah.data) {
            if ayah.aya_id != expected_aya_id {
                bail!(
                    "aya_id tidak berurutan: diharapkan {}, ditemukan {}",
                    expected_aya_id,
                    ayah.aya_id
                );
            }
            if ayah.aya_number != expected_aya_num {
                bail!(
                    "aya_number surah {} salah: diharapkan {}, ditemukan {}",
                    sura_id,
                    expected_aya_num,
                    ayah.aya_number
                );
            }
            if ayah.sura_id != sura_id {
                bail!(
                    "sura_id salah di {}:{}: ditemukan {}",
                    sura_id,
                    ayah.aya_number,
                    ayah.sura_id
                );
            }
            if ayah.juz_id < last_juz_id || ayah.juz_id > 30 {
                bail!(
                    "juz_id menurun atau di luar batas di {}:{}: {}",
                    sura_id,
                    ayah.aya_number,
                    ayah.juz_id
                );
            }
            last_juz_id = ayah.juz_id;

            if ayah.page_number < last_page_number || ayah.page_number > 604 {
                bail!(
                    "page_number menurun atau di luar batas di {}:{}: {}",
                    sura_id,
                    ayah.aya_number,
                    ayah.page_number
                );
            }
            last_page_number = ayah.page_number;
            unique_pages.insert(ayah.page_number);

            surah_ayahs_map.insert((ayah.sura_id, ayah.aya_number), ayah);
            expected_aya_id += 1;
        }
    }

    if expected_aya_id != 6237 {
        bail!("Total ayat harus 6.236, ditemukan {}", expected_aya_id - 1);
    }

    if unique_pages.len() != 604 {
        bail!(
            "Jumlah halaman unik harus 604, ditemukan {}",
            unique_pages.len()
        );
    }

    // Pemeriksaan silang dengan data/juz/ (03 §5.2)
    let mut juz_total_ayat = 0;
    for juz_id in 1..=30 {
        let juz_path = root_dir.join(format!("data/juz/juz_{}.json", juz_id));
        let content = fs::read_to_string(&juz_path)
            .with_context(|| format!("Gagal membaca {:?}", juz_path))?;
        let juz: JuzData = serde_json::from_str(&content)?;

        if juz.nomor != juz_id {
            bail!("Nomor juz salah di {:?}: {}", juz_path, juz.nomor);
        }

        for ayah in juz.data {
            juz_total_ayat += 1;
            let surah_ayah = surah_ayahs_map
                .get(&(ayah.sura_id, ayah.aya_number))
                .with_context(|| {
                    format!(
                        "Ayat {}:{} di juz {} tidak ditemukan di data surah",
                        ayah.sura_id, ayah.aya_number, juz_id
                    )
                })?;

            if ayah.aya_text != surah_ayah.aya_text {
                bail!(
                    "aya_text {}:{} di juz {} berbeda byte dari data surah",
                    ayah.sura_id,
                    ayah.aya_number,
                    juz_id
                );
            }
            if ayah.translation_aya_text != surah_ayah.translation_aya_text {
                bail!(
                    "translation_aya_text {}:{} di juz {} berbeda byte dari data surah",
                    ayah.sura_id,
                    ayah.aya_number,
                    juz_id
                );
            }
        }
    }

    if juz_total_ayat != 6236 {
        bail!(
            "Total ayat di data/juz/ harus 6.236, ditemukan {}",
            juz_total_ayat
        );
    }

    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "verify-sources" => {
            let is_release = args.iter().any(|a| a == "--release");
            let manifest_path = Path::new("content-manifest.json");
            let entries_count = verify_manifest(manifest_path, is_release)?;
            println!(
                "✓ S0: Manifest diverifikasi ({} entri, SHA-256 cocok)",
                entries_count
            );

            verify_structure(Path::new("."))?;
            println!(
                "✓ S1–S2: Struktur sumber diverifikasi (114 surah, 6.236 ayat, 30 juz identik)"
            );
            println!("✓ Semua pemeriksaan sumber lulus.");
            Ok(())
        }
        "help" | "--help" | "-h" => {
            println!("Pipeline dataset QuranRender:");
            println!("  qr-dataset verify-sources [--release]   Verifikasi manifest dan struktur sumber (S0–S2)");
            println!(
                "  qr-dataset build --out <dir>           Bangun quran.db dan laporan (S0–S10)"
            );
            Ok(())
        }
        other => {
            bail!(
                "Perintah tidak dikenal: '{}'. Jalankan 'qr-dataset --help' untuk bantuan.",
                other
            );
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_manifest_and_structure() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let manifest = root.join("content-manifest.json");
        let count = verify_manifest(&manifest, false).expect("Verifikasi manifest gagal");
        assert_eq!(count, 153);
        verify_structure(&root).expect("Verifikasi struktur gagal");
    }
}
