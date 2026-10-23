//! Skema `.qrtemplate` v1 (doc 05 §2), validasi, katalog bawaan, laporan font hilang, serta
//! impor/ekspor paket direktori atau ZIP (PRD STY-6, B2-03).

use crate::scene::RenderError;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

/// Rasio yang dikenal (doc 05 §3.1).
pub const KNOWN_RATIOS: [&str; 4] = ["9:16", "16:9", "1:1", "4:5"];
/// Keluarga font yang dipahami renderer (nama pada `font_family`).
pub const KNOWN_FONT_FAMILIES: [&str; 3] = ["LPMQ", "Amiri", "Inter"];

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SafeArea {
    pub top: f32,
    pub bottom: f32,
    pub left: f32,
    pub right: f32,
}

impl SafeArea {
    /// Matriks area aman standar (doc 05 §3.1). Satu-satunya sumber nilai bawaan.
    pub fn standard(ratio: &str) -> Option<Self> {
        let (top, bottom, left, right) = match ratio {
            "9:16" => (0.08, 0.14, 0.10, 0.10),
            "16:9" => (0.08, 0.08, 0.08, 0.08),
            "1:1" => (0.06, 0.06, 0.06, 0.06),
            "4:5" => (0.08, 0.10, 0.08, 0.08),
            _ => return None,
        };
        Some(Self {
            top,
            bottom,
            left,
            right,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    Background,
    SurahTitle,
    AyahText,
    TranslationText,
    ReferenceBadge,
    ReciterPill,
    /// Persegi panjang/kartu/bingkai (koordinat ternormalisasi `cw`/`ch`).
    ShapeRect,
    /// Kartu kata aktif (templat Tadabbur).
    WordCard,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub kind: LayerKind,
    pub visible: bool,
    #[serde(default)]
    pub properties: Map<String, Value>,
}

impl Layer {
    pub fn f32(&self, key: &str) -> Option<f32> {
        self.properties
            .get(key)
            .and_then(Value::as_f64)
            .map(|v| v as f32)
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.properties.get(key).and_then(Value::as_str)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    #[serde(rename = "type")]
    pub kind: String,
    pub duration_ticks: i64,
    pub easing: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KaraokeAnim {
    pub transition_duration_ticks: i64,
    pub easing: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Animations {
    pub transition_in: Transition,
    pub transition_out: Transition,
    pub karaoke: KaraokeAnim,
}

/// Isi `template.json` (skema v1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TemplateDoc {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub license: String,
    #[serde(default)]
    pub categories: Vec<String>,
    pub supported_ratios: Vec<String>,
    pub default_ratio: String,
    pub safe_area: HashMap<String, SafeArea>,
    pub layers: Vec<Layer>,
    pub animations: Animations,
}

impl TemplateDoc {
    pub fn from_json(json: &str) -> Result<Self, RenderError> {
        let doc: Self = serde_json::from_str(json)?;
        doc.validate()?;
        Ok(doc)
    }

    pub fn load(path: &Path) -> Result<Self, RenderError> {
        Self::from_json(&fs::read_to_string(path)?)
    }

    pub fn layer(&self, kind: LayerKind) -> Option<&Layer> {
        self.layers.iter().find(|l| l.kind == kind)
    }

    pub fn safe_area_for(&self, ratio: &str) -> Result<SafeArea, RenderError> {
        self.safe_area
            .get(ratio)
            .copied()
            .or_else(|| SafeArea::standard(ratio))
            .ok_or_else(|| RenderError::InvalidTemplate(format!("Rasio '{ratio}' tidak dikenal")))
    }

    /// Validasi struktural. Template tidak valid ditolak saat dimuat, bukan saat dirender.
    pub fn validate(&self) -> Result<(), RenderError> {
        let bad = |m: String| Err(RenderError::InvalidTemplate(format!("{}: {m}", self.id)));
        let id_ok = !self.id.is_empty()
            && self
                .id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !id_ok {
            return bad("id hanya boleh huruf kecil, angka, dan '-'".into());
        }
        if self.supported_ratios.is_empty() {
            return bad("supported_ratios kosong".into());
        }
        for r in &self.supported_ratios {
            if !KNOWN_RATIOS.contains(&r.as_str()) {
                return bad(format!("rasio tidak dikenal '{r}'"));
            }
            let Some(sa) = self.safe_area.get(r) else {
                return bad(format!("safe_area untuk '{r}' tidak ada"));
            };
            if sa.top < 0.0
                || sa.bottom < 0.0
                || sa.left < 0.0
                || sa.right < 0.0
                || sa.top + sa.bottom >= 0.8
                || sa.left + sa.right >= 0.8
            {
                return bad(format!("safe_area '{r}' di luar batas wajar"));
            }
        }
        if !self.supported_ratios.contains(&self.default_ratio) {
            return bad("default_ratio tidak termasuk supported_ratios".into());
        }
        let mut seen = HashSet::new();
        for l in &self.layers {
            if !seen.insert(l.id.as_str()) {
                return bad(format!("id layer ganda '{}'", l.id));
            }
            if let Some(f) = l.str("font_family") {
                if !KNOWN_FONT_FAMILIES.contains(&f) {
                    return bad(format!(
                        "font_family tidak dikenal '{f}' pada layer '{}'",
                        l.id
                    ));
                }
            }
            if let Some(s) = l.f32("font_size_cw") {
                if !(0.01..=0.30).contains(&s) {
                    return bad(format!(
                        "font_size_cw {s} di luar 0.01..0.30 pada '{}'",
                        l.id
                    ));
                }
            }
        }
        if self.layer(LayerKind::AyahText).is_none() {
            return bad("layer ayah_text wajib ada".into());
        }
        if self.layer(LayerKind::Background).is_none() {
            return bad("layer background wajib ada".into());
        }
        let ayah = self.layer(LayerKind::AyahText).map(|l| l.visible);
        if ayah != Some(true) {
            return bad("layer ayah_text tidak boleh disembunyikan (CNT-5)".into());
        }
        Ok(())
    }

    /// Keluarga font yang dibutuhkan semua layer teks yang terlihat.
    pub fn required_font_families(&self) -> BTreeSet<String> {
        self.layers
            .iter()
            .filter(|l| l.visible)
            .filter_map(|l| l.str("font_family").map(str::to_string))
            .collect()
    }
}

/// Laporan font hilang saat template dibuka atau diimpor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissingFontReport {
    pub template_id: String,
    pub missing_fonts: Vec<String>,
    pub is_blocked: bool,
}

pub fn check_template_fonts_availability(
    template: &TemplateDoc,
    available_families: &HashSet<String>,
) -> MissingFontReport {
    let missing: Vec<String> = template
        .required_font_families()
        .into_iter()
        .filter(|f| !available_families.contains(f))
        .collect();
    MissingFontReport {
        template_id: template.id.clone(),
        is_blocked: !missing.is_empty(),
        missing_fonts: missing,
    }
}

/// Memuat template bawaan berdasarkan id dari `<resources>/crates/qr-render/templates/<id>/template.json`.
/// Id dibatasi ke karakter aman agar tidak bisa keluar dari folder template.
pub fn load_builtin_template(resources: &Path, id: &str) -> Result<TemplateDoc, RenderError> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(RenderError::InvalidTemplate(format!(
            "Id template tidak valid: '{id}'"
        )));
    }
    TemplateDoc::load(
        &resources
            .join("crates/qr-render/templates")
            .join(id)
            .join("template.json"),
    )
}

/// Memuat seluruh template bawaan dari direktori `templates/` (satu subfolder per template).
pub fn list_builtin_templates(dir: &Path) -> Result<Vec<TemplateDoc>, RenderError> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let p = entry?.path();
        let tpl = p.join("template.json");
        if p.is_dir() && tpl.exists() {
            let doc = TemplateDoc::load(&tpl)?;
            let folder = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if folder != doc.id {
                return Err(RenderError::InvalidTemplate(format!(
                    "Nama folder '{folder}' harus sama dengan id '{}'",
                    doc.id
                )));
            }
            out.push(doc);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Batas ukuran berkas saat impor (mencegah ZIP bomb).
const MAX_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 64;

fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None, // `..`, akar, prefiks drive
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// Mengekspor direktori template menjadi arsip `.qrtemplate` (ZIP).
pub fn export_qrtemplate_zip(template_dir: &Path, out_zip: &Path) -> Result<(), RenderError> {
    // Validasi sebelum mengemas: paket rusak tidak boleh diekspor.
    TemplateDoc::load(&template_dir.join("template.json"))?;
    let file = fs::File::create(out_zip)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut names: Vec<PathBuf> = Vec::new();
    collect_files(template_dir, template_dir, &mut names)?;
    names.sort();
    for rel in names {
        let name = rel.to_string_lossy().replace('\\', "/");
        zip.start_file(name, opts).map_err(zip_err)?;
        zip.write_all(&fs::read(template_dir.join(&rel))?)?;
    }
    zip.finish().map_err(zip_err)?;
    Ok(())
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), RenderError> {
    for e in fs::read_dir(dir)? {
        let p = e?.path();
        if p.is_dir() {
            collect_files(root, &p, out)?;
        } else if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_path_buf());
        }
    }
    Ok(())
}

fn zip_err(e: zip::result::ZipError) -> RenderError {
    RenderError::InvalidTemplate(format!("Arsip .qrtemplate rusak: {e}"))
}

/// Mengimpor `.qrtemplate` (ZIP atau direktori) ke `dest_root/<id>/`. Menolak path berbahaya
/// (zip-slip), arsip terlalu besar, dan template yang tidak lolos validasi.
pub fn import_qrtemplate(source: &Path, dest_root: &Path) -> Result<TemplateDoc, RenderError> {
    let mut files: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    if source.is_dir() {
        let mut names = Vec::new();
        collect_files(source, source, &mut names)?;
        for rel in names {
            files.push((rel.clone(), fs::read(source.join(rel))?));
        }
    } else {
        let mut archive = zip::ZipArchive::new(fs::File::open(source)?).map_err(zip_err)?;
        if archive.len() > MAX_ENTRIES {
            return Err(RenderError::InvalidTemplate(
                "Arsip memuat terlalu banyak berkas".into(),
            ));
        }
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(zip_err)?;
            if entry.is_dir() {
                continue;
            }
            let entry_name = entry
                .name()
                .map_err(|_| RenderError::InvalidTemplate("Nama berkas arsip bukan UTF-8".into()))?
                .into_owned();
            let rel = safe_relative(&entry_name).ok_or_else(|| {
                RenderError::InvalidTemplate(format!("Path berbahaya di arsip: '{entry_name}'"))
            })?;
            if entry.size() > MAX_ENTRY_BYTES {
                return Err(RenderError::InvalidTemplate(format!(
                    "Berkas '{entry_name}' melebihi batas ukuran"
                )));
            }
            let mut buf = Vec::new();
            entry
                .by_ref()
                .take(MAX_ENTRY_BYTES + 1)
                .read_to_end(&mut buf)?;
            if buf.len() as u64 > MAX_ENTRY_BYTES {
                return Err(RenderError::InvalidTemplate(
                    "Berkas melebihi batas ukuran".into(),
                ));
            }
            files.push((rel, buf));
        }
    }
    let json = files
        .iter()
        .find(|(p, _)| p == Path::new("template.json"))
        .map(|(_, b)| String::from_utf8_lossy(b).to_string())
        .ok_or_else(|| RenderError::InvalidTemplate("template.json tidak ada di paket".into()))?;
    let doc = TemplateDoc::from_json(&json)?;
    let dest = dest_root.join(&doc.id);
    if dest.exists() {
        return Err(RenderError::InvalidTemplate(format!(
            "Template '{}' sudah ada. Hapus atau ganti nama sebelum mengimpor.",
            doc.id
        )));
    }
    for (rel, bytes) in files {
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(target, bytes)?;
    }
    Ok(doc)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn templates_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("templates")
    }

    #[test]
    fn catalog_has_exactly_the_12_ids_of_doc_05() {
        let list = list_builtin_templates(&templates_dir()).unwrap();
        let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
        let mut expected = vec![
            "subuh",
            "senja",
            "hening",
            "terang",
            "madinah",
            "naskh-klasik",
            "besar",
            "editorial-split",
            "kartu-apung",
            "siaran-lower-third",
            "tadabbur-wbw",
            "kajian-side-panel",
        ];
        expected.sort_unstable();
        assert_eq!(ids, expected);
    }

    #[test]
    fn supported_ratios_match_doc_05_matrix() {
        let list = list_builtin_templates(&templates_dir()).unwrap();
        let get = |id: &str| -> Vec<String> {
            list.iter()
                .find(|t| t.id == id)
                .unwrap()
                .supported_ratios
                .clone()
        };
        assert_eq!(get("subuh"), ["9:16", "16:9", "1:1", "4:5"]);
        assert_eq!(get("senja"), ["9:16", "4:5"]);
        assert_eq!(get("terang"), ["9:16", "16:9", "1:1"]);
        assert_eq!(get("besar"), ["9:16", "1:1"]);
        assert_eq!(get("siaran-lower-third"), ["16:9"]);
        assert_eq!(get("kajian-side-panel"), ["16:9"]);
    }

    #[test]
    fn standard_safe_area_matches_doc_matrix() {
        let s = SafeArea::standard("4:5").unwrap();
        assert_eq!((s.top, s.bottom, s.left, s.right), (0.08, 0.10, 0.08, 0.08));
        assert!(SafeArea::standard("21:9").is_none());
    }

    #[test]
    fn invalid_templates_are_rejected_at_load() {
        let list = list_builtin_templates(&templates_dir()).unwrap();
        let base = list.iter().find(|t| t.id == "subuh").unwrap().clone();

        let mut hidden = base.clone();
        for l in &mut hidden.layers {
            if l.kind == LayerKind::AyahText {
                l.visible = false;
            }
        }
        assert!(hidden.validate().is_err(), "ayat tidak boleh disembunyikan");

        let mut bad_font = base.clone();
        bad_font.layers[1]
            .properties
            .insert("font_family".into(), Value::from("Comic Sans"));
        assert!(bad_font.validate().is_err());

        let mut bad_ratio = base;
        bad_ratio.default_ratio = "21:9".into();
        assert!(bad_ratio.validate().is_err());
    }

    #[test]
    fn missing_font_report_lists_only_required_families() {
        let list = list_builtin_templates(&templates_dir()).unwrap();
        let tpl = list.iter().find(|t| t.id == "subuh").unwrap();
        let mut available: HashSet<String> = ["Inter".to_string()].into();
        let report = check_template_fonts_availability(tpl, &available);
        assert!(report.is_blocked);
        assert!(report.missing_fonts.contains(&"LPMQ".to_string()));
        available.insert("LPMQ".into());
        available.insert("Amiri".into());
        assert!(!check_template_fonts_availability(tpl, &available).is_blocked);
    }

    #[test]
    fn qrtemplate_zip_roundtrip_and_zip_slip_rejected() {
        let tmp = std::env::temp_dir().join(format!("qrtpl_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let src = templates_dir().join("hening");
        let zip_path = tmp.join("hening.qrtemplate");
        export_qrtemplate_zip(&src, &zip_path).unwrap();
        let imported = import_qrtemplate(&zip_path, &tmp.join("installed")).unwrap();
        assert_eq!(imported.id, "hening");
        // impor kedua ditolak: tidak menimpa diam-diam
        assert!(import_qrtemplate(&zip_path, &tmp.join("installed")).is_err());

        // zip-slip
        let evil = tmp.join("evil.qrtemplate");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("../../escape.txt", o).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        let err = import_qrtemplate(&evil, &tmp.join("installed2")).unwrap_err();
        assert!(err.to_string().contains("berbahaya"), "{err}");
        assert!(!tmp.join("escape.txt").exists());
        let _ = fs::remove_dir_all(&tmp);
    }
}
