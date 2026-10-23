//! Ekspor dan impor arsip proyek mandiri `.qrpack` (PRD PRJ-5, B2-14).
//! Mengacu ke docs/product/PRD.md §7 PRJ-5 dan docs/engineering/01_TECHNICAL_HANDOFF.md §8.1.
//!
//! Format: berkas ZIP dengan tata letak tetap dan datar:
//!
//! ```text
//! manifest.json            versi format/aplikasi/skema + SHA-256 dan ukuran setiap berkas lain
//! project.json             proyek; path aset ditulis ulang menjadi relatif `assets/<nama>`
//! assets/<id>_<nama>       aset yang dirujuk proyek (nama ASCII `[A-Za-z0-9._-]`)
//! ```
//!
//! Lintas-OS: semua nama entri memakai `/`, tanpa path absolut, tanpa drive, dan nama aset dibatasi ke
//! ASCII sehingga arsip dari macOS terbuka identik di Windows/Linux (tanpa beda normalisasi Unicode
//! NFC/NFD atau huruf besar-kecil). Impor memakai pengerasan yang sama dengan
//! `qr-render::template::import_qrtemplate` (zip-slip, batas jumlah/ukuran, tolak menimpa, tanpa sisa)
//! ditambah verifikasi SHA-256 setiap berkas terhadap manifest.

use crate::project::{
    load_project, load_project_with, Project, ProjectError, CURRENT_SCHEMA_VERSION, MIGRATIONS,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use ulid::Ulid;

pub const PACK_FORMAT_VERSION: u32 = 1;
const MANIFEST_NAME: &str = "manifest.json";
const PROJECT_NAME: &str = "project.json";
const ASSETS_PREFIX: &str = "assets/";
const STAGING_DIR: &str = ".qrpack-staging";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QrPackFile {
    /// Path relatif dalam arsip, selalu dengan `/`.
    pub path: String,
    /// SHA-256 isi berkas (heksadesimal huruf kecil, 64 karakter).
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QrPackManifest {
    pub format_version: u32,
    /// Versi aplikasi yang membuat arsip.
    pub app_version: String,
    /// Versi skema `project.json` di dalam arsip.
    pub schema_version: u32,
    pub project_id: String,
    pub project_name: String,
    /// Waktu ekspor (ms sejak epoch Unix).
    pub exported_at: u64,
    pub files: Vec<QrPackFile>,
}

/// Batas keamanan saat impor (mencegah ZIP bomb dan pengisian disk).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportLimits {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
    /// Batas untuk `manifest.json` dan `project.json`.
    pub max_json_bytes: u64,
}

impl Default for ImportLimits {
    fn default() -> Self {
        Self {
            max_entries: 4096,
            max_entry_bytes: 4 * 1024 * 1024 * 1024,
            max_total_bytes: 16 * 1024 * 1024 * 1024,
            max_json_bytes: 32 * 1024 * 1024,
        }
    }
}

fn bad(msg: impl Into<String>) -> ProjectError {
    ProjectError::Corrupted(msg.into())
}

fn zip_err(e: zip::result::ZipError) -> ProjectError {
    bad(e.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn hex(digest: &[u8]) -> String {
    use std::fmt::Write as _;
    digest.iter().fold(String::with_capacity(64), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn is_hex_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Penghapus direktori/berkas sementara saat gagal (tanpa sisa); `keep()` bila sukses.
struct Cleanup {
    path: PathBuf,
    armed: bool,
    /// Folder perantara yang dihapus bila kosong setelah selesai (berhasil maupun gagal).
    prune: Option<PathBuf>,
}

impl Cleanup {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            armed: true,
            prune: None,
        }
    }
    fn with_prune(path: PathBuf, prune: PathBuf) -> Self {
        Self {
            path,
            armed: true,
            prune: Some(prune),
        }
    }
    fn keep(mut self) {
        self.armed = false;
    }
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_dir_all(&self.path);
            let _ = fs::remove_file(&self.path);
        }
        if let Some(p) = &self.prune {
            let _ = fs::remove_dir(p);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Penamaan & validasi path
// ---------------------------------------------------------------------------------------------

fn is_windows_reserved(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment);
    let up = stem.to_ascii_uppercase();
    matches!(up.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (up.len() == 4
            && (up.starts_with("COM") || up.starts_with("LPT"))
            && matches!(up.as_bytes()[3], b'1'..=b'9'))
}

/// Segmen nama berkas yang aman di semua OS: ASCII `[A-Za-z0-9._-]`, tidak diawali/diakhiri titik,
/// bukan nama perangkat Windows, panjang terbatas.
fn is_safe_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg.len() <= 160
        && seg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        && !seg.starts_with('.')
        && !seg.ends_with('.')
        && !is_windows_reserved(seg)
}

/// Jenis entri yang diizinkan dalam arsip; selain ini ditolak.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    Manifest,
    Project,
    Asset,
}

/// Memvalidasi path entri arsip: harus persis `manifest.json`, `project.json`, atau `assets/<nama>`.
/// Menolak `\`, `:`, NUL, `..`, path absolut, segmen kosong, dan nama tak aman lintas-OS.
fn classify_path(name: &str) -> Result<EntryKind, ProjectError> {
    let hostile = || {
        bad(format!(
            "Path berbahaya atau tidak dikenal di arsip: {name:?}"
        ))
    };
    if name.contains(['\\', ':', '\0']) || name.starts_with('/') {
        return Err(hostile());
    }
    if name == MANIFEST_NAME {
        return Ok(EntryKind::Manifest);
    }
    if name == PROJECT_NAME {
        return Ok(EntryKind::Project);
    }
    match name.strip_prefix(ASSETS_PREFIX) {
        Some(rest) if is_safe_segment(rest) => Ok(EntryKind::Asset),
        _ => Err(hostile()),
    }
}

/// id proyek dipakai sebagai nama folder oleh pemanggil, jadi dibatasi ke karakter aman.
fn is_safe_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

fn sanitize_component(s: &str, max: usize) -> String {
    let mut out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(max)
        .collect();
    while out.ends_with('.') {
        out.pop();
        out.push('_');
    }
    out
}

/// Nama aset di dalam arsip: `<id>_<namaberkas>` yang disanitasi ke ASCII dan dijamin unik tanpa
/// memperhatikan huruf besar-kecil.
fn pack_asset_name(id: &str, source: &Path, used: &mut HashSet<String>) -> String {
    let file = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let id = sanitize_component(id, 40);
    let id = if id.is_empty() {
        "aset".to_string()
    } else {
        id
    };
    let file = sanitize_component(&file, 80);
    let base = format!("{id}_{file}");
    let mut candidate = base.clone();
    let mut n = 2;
    while !used.insert(candidate.to_ascii_lowercase()) {
        candidate = format!("{n}_{base}");
        n += 1;
    }
    candidate
}

// ---------------------------------------------------------------------------------------------
// Ekspor
// ---------------------------------------------------------------------------------------------

fn exists_err(path: &Path) -> ProjectError {
    ProjectError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!(
            "'{}' sudah ada. Pilih nama lain; ekspor tidak menimpa berkas.",
            path.display()
        ),
    ))
}

/// Mengekspor proyek ke arsip `.qrpack` mandiri. Menolak menimpa `out_pack_path`. Aset dicopy ke
/// `assets/` dan path-nya di `project.json` dalam arsip ditulis ulang menjadi relatif. Aset yang
/// hilang, atau yang isinya berbeda dari SHA-256 yang tercatat di proyek, membatalkan ekspor.
/// Gagal = tidak ada berkas tersisa.
pub fn export_qrpack(
    project_dir: &Path,
    out_pack_path: &Path,
) -> Result<QrPackManifest, ProjectError> {
    if out_pack_path.exists() {
        return Err(exists_err(out_pack_path));
    }
    let mut project = load_project(project_dir)?;

    let parent = out_pack_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let tmp_name = format!(
        ".{}.tmp-{}",
        out_pack_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "pack".into()),
        Ulid::generate()
    );
    let tmp_path = parent.join(tmp_name);
    let cleanup = Cleanup::new(tmp_path.clone());

    let manifest = write_pack(project_dir, &mut project, &tmp_path)?;

    if out_pack_path.exists() {
        return Err(exists_err(out_pack_path));
    }
    fs::rename(&tmp_path, out_pack_path)?;
    cleanup.keep();
    Ok(manifest)
}

fn write_pack(
    project_dir: &Path,
    project: &mut Project,
    tmp_path: &Path,
) -> Result<QrPackManifest, ProjectError> {
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let json_opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut files: Vec<QrPackFile> = Vec::new();
    let mut used = HashSet::new();
    let mut keys: Vec<String> = project.assets.keys().cloned().collect();
    keys.sort();
    for key in keys {
        let Some(asset) = project.assets.get_mut(&key) else {
            continue;
        };
        let raw = Path::new(&asset.path);
        let src = if raw.is_absolute() {
            raw.to_path_buf()
        } else {
            project_dir.join(raw)
        };
        let mut input = File::open(&src).map_err(|e| {
            ProjectError::Io(io::Error::new(
                e.kind(),
                format!(
                    "Aset '{key}' ({}) tidak dapat dibaca: {e}",
                    src.file_name().unwrap_or_default().to_string_lossy()
                ),
            ))
        })?;
        let size = input.metadata()?.len();
        let name = format!("{ASSETS_PREFIX}{}", pack_asset_name(&key, &src, &mut used));
        let opts = json_opts.large_file(size >= u64::from(u32::MAX));
        zip.start_file(name.as_str(), opts).map_err(zip_err)?;

        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut copied = 0u64;
        loop {
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            zip.write_all(&buf[..n])?;
            copied += n as u64;
        }
        let sha = hex(&hasher.finalize());
        if !asset.sha256.is_empty() && !asset.sha256.eq_ignore_ascii_case(&sha) {
            return Err(bad(format!(
                "Aset '{key}' berubah sejak dicatat (SHA-256 tidak cocok); ekspor dibatalkan"
            )));
        }
        asset.sha256 = sha.clone();
        asset.size_bytes = copied;
        asset.path = name.clone();
        files.push(QrPackFile {
            path: name,
            sha256: sha,
            size: copied,
        });
    }

    let project_bytes = serde_json::to_vec_pretty(&*project)?;
    zip.start_file(PROJECT_NAME, json_opts).map_err(zip_err)?;
    zip.write_all(&project_bytes)?;
    files.push(QrPackFile {
        path: PROJECT_NAME.into(),
        sha256: hex(&Sha256::digest(&project_bytes)),
        size: project_bytes.len() as u64,
    });

    let manifest = QrPackManifest {
        format_version: PACK_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: project.schema_version,
        project_id: project.id.clone(),
        project_name: project.name.clone(),
        exported_at: now_ms(),
        files,
    };
    zip.start_file(MANIFEST_NAME, json_opts).map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;

    let mut file = zip.finish().map_err(zip_err)?;
    file.flush()?;
    file.sync_all()?;
    Ok(manifest)
}

// ---------------------------------------------------------------------------------------------
// Impor
// ---------------------------------------------------------------------------------------------

/// Membaca dan memvalidasi hanya `manifest.json` dari arsip (mis. untuk menamai folder tujuan).
/// Tidak menulis apa pun ke disk dan tidak memverifikasi isi berkas lain.
pub fn read_qrpack_manifest(pack_path: &Path) -> Result<QrPackManifest, ProjectError> {
    let limits = ImportLimits::default();
    let mut zip = zip::ZipArchive::new(File::open(pack_path)?).map_err(zip_err)?;
    if zip.len() > limits.max_entries {
        return Err(bad("Arsip memuat terlalu banyak berkas"));
    }
    let index = scan_entries(&mut zip, &limits)?;
    read_manifest(&mut zip, &index, &limits)
}

/// Mengimpor `.qrpack` ke `dest_dir` (folder proyek baru yang belum ada) dengan batas bawaan.
pub fn import_qrpack(pack_path: &Path, dest_dir: &Path) -> Result<Project, ProjectError> {
    import_qrpack_with_limits(pack_path, dest_dir, &ImportLimits::default())
}

/// Seperti [`import_qrpack`] dengan batas yang dapat diatur. Isi diekstrak ke folder sementara di
/// samping `dest_dir`, diverifikasi penuh (nama, ukuran, SHA-256, skema, rujukan aset), lalu
/// di-rename ke `dest_dir`. Kegagalan menghapus folder sementara; `dest_dir` yang sudah ada ditolak.
pub fn import_qrpack_with_limits(
    pack_path: &Path,
    dest_dir: &Path,
    limits: &ImportLimits,
) -> Result<Project, ProjectError> {
    if dest_dir.exists() {
        return Err(exists_err(dest_dir));
    }
    if dest_dir.file_name().is_none() {
        return Err(bad("Folder tujuan tidak valid"));
    }
    let parent = dest_dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let mut zip = zip::ZipArchive::new(File::open(pack_path)?).map_err(zip_err)?;
    if zip.len() > limits.max_entries {
        return Err(bad("Arsip memuat terlalu banyak berkas"));
    }
    let index = scan_entries(&mut zip, limits)?;
    let manifest = read_manifest(&mut zip, &index, limits)?;
    let hashes = check_manifest(&manifest, &index, limits)?;

    // Staging di subfolder tersembunyi agar pemindai indeks proyek (yang hanya membaca anak langsung
    // folder proyek) tidak pernah menganggap hasil ekstraksi setengah jadi sebagai proyek.
    let staging_root = parent.join(STAGING_DIR);
    let staging = staging_root.join(Ulid::generate().to_string());
    fs::create_dir_all(&staging)?;
    let cleanup = Cleanup::with_prune(staging.clone(), staging_root);
    extract_verified(&mut zip, &index, &manifest, &staging, limits)?;
    let project = verify_project(&staging, &manifest, &hashes)?;

    if dest_dir.exists() {
        return Err(exists_err(dest_dir));
    }
    fs::rename(&staging, dest_dir)?;
    cleanup.keep();
    Ok(project)
}

/// Entri berkas arsip yang lolos validasi nama: path -> indeks ZIP.
fn scan_entries(
    zip: &mut zip::ZipArchive<File>,
    limits: &ImportLimits,
) -> Result<HashMap<String, usize>, ProjectError> {
    let mut index = HashMap::new();
    let mut seen_lower = HashSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(zip_err)?;
        let name = entry
            .name()
            .map_err(|_| bad("Nama berkas arsip bukan UTF-8"))?
            .into_owned();
        if entry.is_dir() {
            // Entri direktori hanya boleh `assets/`; selebihnya tidak dikenal.
            if name.trim_end_matches('/') == "assets" {
                continue;
            }
            return Err(bad(format!("Direktori tidak dikenal di arsip: {name:?}")));
        }
        if entry.is_symlink() {
            return Err(bad(format!("Symlink di arsip ditolak: {name:?}")));
        }
        if entry.encrypted() {
            return Err(bad(format!("Entri terenkripsi ditolak: {name:?}")));
        }
        classify_path(&name)?;
        if entry.size() > limits.max_entry_bytes {
            return Err(bad(format!("Berkas {name:?} melebihi batas ukuran")));
        }
        // Dua entri yang hanya beda huruf besar-kecil bertabrakan di macOS/Windows.
        if !seen_lower.insert(name.to_ascii_lowercase()) || index.insert(name.clone(), i).is_some()
        {
            return Err(bad(format!("Nama berkas ganda di arsip: {name:?}")));
        }
    }
    Ok(index)
}

fn read_limited(
    zip: &mut zip::ZipArchive<File>,
    idx: usize,
    max: u64,
) -> Result<Vec<u8>, ProjectError> {
    let entry = zip.by_index(idx).map_err(zip_err)?;
    let mut buf = Vec::new();
    entry.take(max + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > max {
        return Err(bad("Berkas JSON di arsip melebihi batas ukuran"));
    }
    Ok(buf)
}

fn read_manifest(
    zip: &mut zip::ZipArchive<File>,
    index: &HashMap<String, usize>,
    limits: &ImportLimits,
) -> Result<QrPackManifest, ProjectError> {
    let idx = *index
        .get(MANIFEST_NAME)
        .ok_or_else(|| bad("manifest.json tidak ada di arsip"))?;
    let bytes = read_limited(zip, idx, limits.max_json_bytes)?;
    let manifest: QrPackManifest = serde_json::from_slice(&bytes)
        .map_err(|e| bad(format!("manifest.json tidak valid: {e}")))?;
    if manifest.format_version != PACK_FORMAT_VERSION {
        return Err(bad(format!(
            "Versi format .qrpack {} tidak didukung (aplikasi mendukung {PACK_FORMAT_VERSION})",
            manifest.format_version
        )));
    }
    if manifest.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(ProjectError::UnsupportedSchemaVersion(
            manifest.schema_version,
            CURRENT_SCHEMA_VERSION,
        ));
    }
    Ok(manifest)
}

/// Manifest harus mendaftar persis berkas yang ada di arsip (selain manifest sendiri).
fn check_manifest(
    manifest: &QrPackManifest,
    index: &HashMap<String, usize>,
    limits: &ImportLimits,
) -> Result<HashMap<String, String>, ProjectError> {
    let mut hashes = HashMap::new();
    let mut total = 0u64;
    for f in &manifest.files {
        if classify_path(&f.path)? == EntryKind::Manifest {
            return Err(bad(
                "manifest.json tidak boleh mendaftarkan dirinya sendiri",
            ));
        }
        if !is_hex_sha256(&f.sha256) {
            return Err(bad(format!(
                "SHA-256 tidak valid di manifest untuk {:?}",
                f.path
            )));
        }
        let limit = if f.path == PROJECT_NAME {
            limits.max_json_bytes
        } else {
            limits.max_entry_bytes
        };
        if f.size > limit {
            return Err(bad(format!("Berkas {:?} melebihi batas ukuran", f.path)));
        }
        total = total.saturating_add(f.size);
        if total > limits.max_total_bytes {
            return Err(bad("Total ukuran arsip melebihi batas"));
        }
        if hashes.insert(f.path.clone(), f.sha256.clone()).is_some() {
            return Err(bad(format!("Berkas ganda di manifest: {:?}", f.path)));
        }
    }
    if !hashes.contains_key(PROJECT_NAME) {
        return Err(bad("project.json tidak terdaftar di manifest"));
    }
    let listed: HashSet<&str> = hashes.keys().map(String::as_str).collect();
    let present: HashSet<&str> = index
        .keys()
        .map(String::as_str)
        .filter(|n| *n != MANIFEST_NAME)
        .collect();
    if listed != present {
        return Err(bad(
            "Isi arsip tidak sama dengan manifest (ada berkas tambahan atau hilang)",
        ));
    }
    Ok(hashes)
}

/// Mengekstrak setiap berkas ke `staging` sambil menghitung SHA-256 dan ukuran; membatasi byte
/// sebenarnya yang dibaca (bukan hanya ukuran yang diklaim header).
fn extract_verified(
    zip: &mut zip::ZipArchive<File>,
    index: &HashMap<String, usize>,
    manifest: &QrPackManifest,
    staging: &Path,
    limits: &ImportLimits,
) -> Result<(), ProjectError> {
    if manifest
        .files
        .iter()
        .any(|f| f.path.starts_with(ASSETS_PREFIX))
    {
        fs::create_dir(staging.join("assets"))?;
    }
    let mut total = 0u64;
    let mut buf = vec![0u8; 256 * 1024];
    for f in &manifest.files {
        let idx = *index
            .get(&f.path)
            .ok_or_else(|| bad(format!("Berkas {:?} tidak ada di arsip", f.path)))?;
        let mut entry = zip.by_index(idx).map_err(zip_err)?;
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(staging.join(&f.path))?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        loop {
            let n = entry.by_ref().take(f.size + 1 - written).read(&mut buf)?;
            if n == 0 {
                break;
            }
            written += n as u64;
            total += n as u64;
            if written > f.size {
                return Err(bad(format!(
                    "Berkas {:?} lebih besar dari manifest",
                    f.path
                )));
            }
            if total > limits.max_total_bytes {
                return Err(bad("Total ukuran arsip melebihi batas"));
            }
            hasher.update(&buf[..n]);
            out.write_all(&buf[..n])?;
        }
        if written != f.size {
            return Err(bad(format!(
                "Ukuran {:?} tidak cocok dengan manifest",
                f.path
            )));
        }
        if hex(&hasher.finalize()) != f.sha256 {
            return Err(bad(format!(
                "SHA-256 {:?} tidak cocok dengan manifest (arsip rusak atau dimanipulasi)",
                f.path
            )));
        }
        out.sync_all()?;
    }
    Ok(())
}

/// Memuat `project.json` hasil ekstraksi (dengan migrasi skema bila perlu) dan memastikan
/// konsistensi dengan manifest serta rujukan aset.
fn verify_project(
    staging: &Path,
    manifest: &QrPackManifest,
    hashes: &HashMap<String, String>,
) -> Result<Project, ProjectError> {
    let doc: serde_json::Value = serde_json::from_slice(&fs::read(staging.join(PROJECT_NAME))?)?;
    if doc
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(u64::from(manifest.schema_version))
    {
        return Err(bad("schema_version project.json berbeda dari manifest"));
    }
    let project = load_project_with(staging, CURRENT_SCHEMA_VERSION, MIGRATIONS)?;
    if project.id != manifest.project_id {
        return Err(bad("id proyek di project.json berbeda dari manifest"));
    }
    if !is_safe_project_id(&project.id) {
        return Err(bad("id proyek mengandung karakter yang tidak diizinkan"));
    }
    for (key, asset) in &project.assets {
        if classify_path(&asset.path)? != EntryKind::Asset {
            return Err(bad(format!(
                "Aset '{key}' tidak merujuk berkas di assets/ (path: {:?})",
                asset.path
            )));
        }
        match hashes.get(&asset.path) {
            Some(h) if h.eq_ignore_ascii_case(&asset.sha256) => {}
            Some(_) => {
                return Err(bad(format!(
                    "SHA-256 aset '{key}' di project.json berbeda dari manifest"
                )))
            }
            None => {
                return Err(bad(format!(
                    "Aset '{key}' merujuk berkas yang tidak ada di arsip: {:?}",
                    asset.path
                )))
            }
        }
    }
    Ok(project)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn classify_accepts_only_the_fixed_flat_layout() {
        assert_eq!(classify_path("manifest.json").unwrap(), EntryKind::Manifest);
        assert_eq!(classify_path("project.json").unwrap(), EntryKind::Project);
        assert_eq!(
            classify_path("assets/a1_audio.wav").unwrap(),
            EntryKind::Asset
        );
        for evil in [
            "../x",
            "assets/../x",
            "assets/..",
            "/etc/passwd",
            "C:/x",
            "C:\\x",
            "assets\\a.wav",
            "assets/a:b",
            "assets/a\0b",
            "assets/",
            "assets//a",
            "assets/sub/a.wav",
            "assets/.hidden",
            "assets/a.",
            "assets/CON.wav",
            "assets/nul",
            "assets/COM1",
            "assets/bukan ascii.wav",
            "assets/\u{0627}\u{0644}.wav",
            "lain.txt",
            "./project.json",
            "",
        ] {
            assert!(classify_path(evil).is_err(), "harus ditolak: {evil:?}");
        }
    }

    #[test]
    fn pack_asset_names_are_ascii_portable_and_unique_case_insensitively() {
        let mut used = HashSet::new();
        let a = pack_asset_name("a1", Path::new("/x/Qari Ñ \u{0627}.WAV"), &mut used);
        assert!(is_safe_segment(&a), "{a}");
        assert!(a.is_ascii());
        let b = pack_asset_name("A1", Path::new("/x/Qari Ñ \u{0627}.wav"), &mut used);
        assert_ne!(a.to_ascii_lowercase(), b.to_ascii_lowercase());
        assert!(is_safe_segment(&b), "{b}");
        let c = pack_asset_name("", Path::new("CON."), &mut used);
        assert!(is_safe_segment(&c), "{c}");
        assert!(is_safe_segment(&pack_asset_name(
            &"x".repeat(500),
            Path::new(&"y".repeat(500)),
            &mut used
        )));
    }

    #[test]
    fn project_id_allowlist() {
        assert!(is_safe_project_id("01HZZZ-abc_9"));
        for bad_id in ["", "../x", "a/b", "a b", "a\\b", &"x".repeat(65)] {
            assert!(!is_safe_project_id(bad_id), "{bad_id:?}");
        }
    }
}
