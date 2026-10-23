#![allow(clippy::unwrap_used)]
//! B2-14: arsip `.qrpack` — roundtrip, deteksi manipulasi, entri berbahaya, dan fuzz mutasi.

use qr_core::{
    export_qrpack, import_qrpack, import_qrpack_with_limits, save_project_atomic, AssetKind,
    AssetRef, ImportLimits, Project, QrPackManifest,
};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

fn tmp(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("qr_pack_{tag}_{}", ulid::Ulid::generate()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn listing(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

struct Fixture {
    root: PathBuf,
    project_dir: PathBuf,
    project: Project,
    audio: Vec<u8>,
    image: Vec<u8>,
}

/// Proyek dengan dua aset: satu absolut (di luar folder proyek, nama non-ASCII), satu relatif.
fn fixture(tag: &str) -> Fixture {
    let root = tmp(tag);
    let project_dir = root.join("sumber.qrproj");
    std::fs::create_dir_all(project_dir.join("media")).unwrap();
    let audio: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
    let image: Vec<u8> = (0..5_000u32).map(|i| (i % 13) as u8).collect();
    let ext_audio = root.join("Qari \u{0627}\u{0644}\u{0642}\u{0627}\u{0631}\u{064a}.WAV");
    std::fs::write(&ext_audio, &audio).unwrap();
    std::fs::write(project_dir.join("media/latar.png"), &image).unwrap();

    let mut p = Project::new("Proyek Portabel");
    p.assets.insert(
        "aud1".into(),
        AssetRef {
            id: "aud1".into(),
            path: ext_audio.to_string_lossy().into_owned(),
            sha256: sha(&audio),
            kind: AssetKind::Audio,
            duration_ticks: 48_000,
            size_bytes: audio.len() as u64,
        },
    );
    p.assets.insert(
        "img1".into(),
        AssetRef {
            id: "img1".into(),
            path: "media/latar.png".into(),
            sha256: String::new(),
            kind: AssetKind::Image,
            duration_ticks: 0,
            size_bytes: 0,
        },
    );
    save_project_atomic(&project_dir, &mut p).unwrap();
    Fixture {
        root,
        project_dir,
        project: p,
        audio,
        image,
    }
}

/// Entri (nama, isi) dari sebuah zip.
fn read_zip(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    (0..z.len())
        .map(|i| {
            let mut e = z.by_index(i).unwrap();
            let mut b = Vec::new();
            e.read_to_end(&mut b).unwrap();
            (e.name().unwrap().into_owned(), b)
        })
        .collect()
}

fn write_zip(path: &Path, entries: &[(String, Vec<u8>)]) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let opts = zip::write::SimpleFileOptions::default();
    for (n, d) in entries {
        z.start_file(n.as_str(), opts).unwrap();
        z.write_all(d).unwrap();
    }
    z.finish().unwrap();
}

fn pack_of(f: &Fixture) -> (PathBuf, QrPackManifest) {
    let out = f.root.join("hasil.qrpack");
    let m = export_qrpack(&f.project_dir, &out).unwrap();
    (out, m)
}

#[test]
fn roundtrip_preserves_asset_bytes_hashes_and_relative_paths() {
    let f = fixture("rt");
    let (pack, manifest) = pack_of(&f);

    // Manifest: versi + hash tiap berkas, path datar dengan `/`.
    assert_eq!(manifest.format_version, 1);
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(manifest.project_id, f.project.id);
    assert_eq!(manifest.files.len(), 3);
    for e in &manifest.files {
        assert!(!e.path.contains('\\') && !e.path.starts_with('/') && e.path.is_ascii());
    }
    let names: Vec<String> = read_zip(&pack).into_iter().map(|(n, _)| n).collect();
    assert!(names.contains(&"manifest.json".to_string()));
    assert!(names.contains(&"project.json".to_string()));
    assert_eq!(names.iter().filter(|n| n.starts_with("assets/")).count(), 2);

    let dest = f.root.join("impor/Baru.qrproj");
    let imported = import_qrpack(&pack, &dest).unwrap();
    assert_eq!(imported.id, f.project.id);
    assert_eq!(imported.name, "Proyek Portabel");
    assert_eq!(imported.segments, f.project.segments);
    assert_eq!(imported.assets.len(), 2);

    for (key, original) in [("aud1", &f.audio), ("img1", &f.image)] {
        let a = &imported.assets[key];
        assert!(
            a.path.starts_with("assets/"),
            "path harus relatif: {}",
            a.path
        );
        assert!(!Path::new(&a.path).is_absolute());
        let on_disk = std::fs::read(dest.join(&a.path)).unwrap();
        assert_eq!(&on_disk, original, "byte aset {key} harus identik");
        assert_eq!(sha(&on_disk), a.sha256, "hash aset {key}");
        assert_eq!(a.size_bytes, original.len() as u64);
    }
    // project.json di disk dapat dimuat ulang.
    assert_eq!(qr_core::load_project(&dest).unwrap(), imported);
    // Tidak ada sisa folder sementara.
    assert_eq!(listing(&f.root.join("impor")), vec!["Baru.qrproj"]);
    let _ = std::fs::remove_dir_all(&f.root);
}

#[test]
fn export_and_import_refuse_to_overwrite_and_leave_no_leftovers() {
    let f = fixture("ow");
    let (pack, _) = pack_of(&f);
    let before = std::fs::read(&pack).unwrap();
    assert!(export_qrpack(&f.project_dir, &pack).is_err());
    assert_eq!(std::fs::read(&pack).unwrap(), before, "pack lama utuh");

    let dest = f.root.join("ada.qrproj");
    std::fs::create_dir_all(&dest).unwrap();
    std::fs::write(dest.join("milik-pengguna.txt"), b"jangan hilang").unwrap();
    assert!(import_qrpack(&pack, &dest).is_err());
    assert_eq!(listing(&dest), vec!["milik-pengguna.txt"]);

    // Aset hilang membatalkan ekspor tanpa meninggalkan berkas sementara.
    std::fs::remove_file(f.project_dir.join("media/latar.png")).unwrap();
    let out2 = f.root.join("kedua.qrpack");
    let before_list = listing(&f.root);
    let err = export_qrpack(&f.project_dir, &out2)
        .unwrap_err()
        .to_string();
    assert!(err.contains("img1"), "{err}");
    assert_eq!(listing(&f.root), before_list);
    let _ = std::fs::remove_dir_all(&f.root);
}

#[test]
fn export_rejects_asset_whose_content_no_longer_matches_recorded_sha() {
    let f = fixture("sha");
    let ext = std::path::PathBuf::from(&f.project.assets["aud1"].path);
    std::fs::write(&ext, b"isi diganti").unwrap();
    let out = f.root.join("x.qrpack");
    let err = export_qrpack(&f.project_dir, &out).unwrap_err().to_string();
    assert!(err.contains("aud1") && err.contains("SHA-256"), "{err}");
    assert!(!out.exists());
    let _ = std::fs::remove_dir_all(&f.root);
}

/// Mengimpor `entries` sebagai pack dan memastikan ditolak, tanpa sisa di folder tujuan.
fn assert_rejected(f: &Fixture, tag: &str, entries: &[(String, Vec<u8>)]) -> String {
    let slug: String = tag
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let z = f.root.join(format!("kasus_{slug}.qrpack"));
    write_zip(&z, entries);
    let root = f.root.join(format!("tujuan_{slug}"));
    std::fs::create_dir_all(&root).unwrap();
    let dest = root.join("P.qrproj");
    let r = catch_unwind(AssertUnwindSafe(|| import_qrpack(&z, &dest)))
        .unwrap_or_else(|_| panic!("panic pada kasus {tag}"));
    let err = r
        .err()
        .unwrap_or_else(|| panic!("kasus '{tag}' harus ditolak"));
    assert!(
        listing(&root).is_empty(),
        "kasus '{tag}' meninggalkan sisa: {:?}",
        listing(&root)
    );
    err.to_string()
}

fn replace(entries: &[(String, Vec<u8>)], name: &str, data: Vec<u8>) -> Vec<(String, Vec<u8>)> {
    entries
        .iter()
        .map(|(n, d)| {
            if n == name {
                (n.clone(), data.clone())
            } else {
                (n.clone(), d.clone())
            }
        })
        .collect()
}

fn manifest_of(entries: &[(String, Vec<u8>)]) -> QrPackManifest {
    let (_, m) = entries.iter().find(|(n, _)| n == "manifest.json").unwrap();
    serde_json::from_slice(m).unwrap()
}

#[test]
fn tampered_packs_are_rejected() {
    let f = fixture("tamper");
    let (pack, _) = pack_of(&f);
    let good = read_zip(&pack);
    let asset_name = good
        .iter()
        .find(|(n, _)| n.starts_with("assets/") && n.contains("aud1"))
        .unwrap()
        .0
        .clone();

    // 1. Satu byte aset diubah (manifest tetap).
    let mut a = good
        .iter()
        .find(|(n, _)| *n == asset_name)
        .unwrap()
        .1
        .clone();
    a[1000] ^= 0x01;
    let e = assert_rejected(&f, "byte aset", &replace(&good, &asset_name, a.clone()));
    assert!(e.contains("SHA-256"), "{e}");

    // 2. Aset diubah dan hash di manifest "diperbaiki", tetapi project.json masih memuat hash lama.
    let mut m = manifest_of(&good);
    for file in &mut m.files {
        if file.path == asset_name {
            file.sha256 = sha(&a);
        }
    }
    let e = assert_rejected(
        &f,
        "manifest disesuaikan",
        &replace(&good, "manifest.json", serde_json::to_vec(&m).unwrap()),
    );
    assert!(e.contains("aud1"), "{e}");

    // 3. project.json diubah (nama), manifest lama.
    let (_, pj) = good.iter().find(|(n, _)| n == "project.json").unwrap();
    let pj2 = String::from_utf8(pj.clone())
        .unwrap()
        .replace("Proyek Portabel", "Proyek Diubah");
    let e = assert_rejected(
        &f,
        "project diubah",
        &replace(&good, "project.json", pj2.into_bytes()),
    );
    assert!(e.contains("project.json"), "{e}");

    // 4. Berkas tambahan yang tidak ada di manifest.
    let mut extra = good.clone();
    extra.push(("assets/penyusup.bin".into(), b"x".to_vec()));
    assert_rejected(&f, "berkas tambahan", &extra);

    // 5. Berkas yang terdaftar di manifest hilang dari arsip.
    let missing: Vec<_> = good
        .iter()
        .filter(|(n, _)| *n != asset_name)
        .cloned()
        .collect();
    assert_rejected(&f, "berkas hilang", &missing);

    // 6. Ukuran di manifest salah.
    let mut m = manifest_of(&good);
    m.files[0].size += 1;
    assert_rejected(
        &f,
        "ukuran salah",
        &replace(&good, "manifest.json", serde_json::to_vec(&m).unwrap()),
    );

    // 7. Tanpa manifest; manifest rusak; versi format/skema asing.
    let no_manifest: Vec<_> = good
        .iter()
        .filter(|(n, _)| n != "manifest.json")
        .cloned()
        .collect();
    assert_rejected(&f, "tanpa manifest", &no_manifest);
    assert_rejected(
        &f,
        "manifest rusak",
        &replace(&good, "manifest.json", b"{".to_vec()),
    );
    let mut m = manifest_of(&good);
    m.format_version = 99;
    assert_rejected(
        &f,
        "format asing",
        &replace(&good, "manifest.json", serde_json::to_vec(&m).unwrap()),
    );
    let mut m = manifest_of(&good);
    m.schema_version = 9999;
    let e = assert_rejected(
        &f,
        "skema lebih baru",
        &replace(&good, "manifest.json", serde_json::to_vec(&m).unwrap()),
    );
    assert!(e.contains("9999"), "{e}");
    let _ = std::fs::remove_dir_all(&f.root);
}

/// Pack dengan project.json dan manifest dibuat konsisten (hash benar) agar yang diuji adalah
/// validasi isi proyek, bukan pemeriksaan hash.
fn consistent_pack(good: &[(String, Vec<u8>)], project_json: &str) -> Vec<(String, Vec<u8>)> {
    let mut m = manifest_of(good);
    for file in &mut m.files {
        if file.path == "project.json" {
            file.sha256 = sha(project_json.as_bytes());
            file.size = project_json.len() as u64;
        }
    }
    let mut out = replace(good, "project.json", project_json.as_bytes().to_vec());
    out = replace(&out, "manifest.json", serde_json::to_vec(&m).unwrap());
    out
}

#[test]
fn consistent_but_hostile_project_contents_are_rejected() {
    let f = fixture("proj");
    let (pack, _) = pack_of(&f);
    let good = read_zip(&pack);
    let pj = String::from_utf8(
        good.iter()
            .find(|(n, _)| n == "project.json")
            .unwrap()
            .1
            .clone(),
    )
    .unwrap();

    // Path aset absolut / keluar folder.
    for (tag, path) in [
        ("aset absolut", "/etc/passwd"),
        ("aset naik", "../../rahasia"),
        ("aset windows", "C:\\\\x.wav"),
    ] {
        let asset_name = good
            .iter()
            .find(|(n, _)| n.contains("aud1"))
            .unwrap()
            .0
            .clone();
        let evil = pj.replace(&asset_name, path);
        assert_ne!(evil, pj);
        let e = assert_rejected(&f, tag, &consistent_pack(&good, &evil));
        assert!(e.contains("aud1") || e.contains("Path"), "{tag}: {e}");
    }
    // id proyek berbahaya (dipakai pemanggil sebagai nama folder).
    let evil = pj.replace(&f.project.id, "../escape");
    let mut m = manifest_of(&good);
    m.project_id = "../escape".into();
    let mut entries = consistent_pack(&good, &evil);
    for file in &mut m.files {
        if file.path == "project.json" {
            file.sha256 = sha(evil.as_bytes());
            file.size = evil.len() as u64;
        }
    }
    entries = replace(&entries, "manifest.json", serde_json::to_vec(&m).unwrap());
    let e = assert_rejected(&f, "id berbahaya", &entries);
    assert!(e.contains("id proyek"), "{e}");
    // Aset merujuk berkas yang tidak ada di arsip.
    let evil = pj.replace("img1_latar.png", "tidak_ada.png");
    assert_ne!(evil, pj);
    assert_rejected(&f, "rujukan hilang", &consistent_pack(&good, &evil));
    let _ = std::fs::remove_dir_all(&f.root);
}

#[test]
fn hostile_entries_are_rejected_and_nothing_escapes_the_destination() {
    let f = fixture("host");
    let (pack, _) = pack_of(&f);
    let good = read_zip(&pack);
    let outside = f.root.join("escape.txt");
    let outside2 = f
        .root
        .parent()
        .unwrap()
        .join(format!("qr_pack_escape_{}", std::process::id()));

    let hostile_names = [
        "../../escape.txt",
        "assets/../../escape.txt",
        "/etc/qr_escape",
        "C:\\evil.txt",
        "C:/evil.txt",
        "assets\\..\\..\\escape.txt",
        "assets/a:stream",
        "assets/nul\0byte",
        "assets/../escape.txt",
        "assets/sub/dalam.bin",
        "assets//ganda.bin",
        "assets/CON.txt",
        "assets/.tersembunyi",
        "assets/bukan ascii \u{0627}.bin",
    ];
    for name in hostile_names {
        let mut entries = good.clone();
        entries.push((name.to_string(), b"x".to_vec()));
        assert_rejected(&f, &format!("host {}", name.escape_default()), &entries);
        assert!(
            !outside.exists() && !outside2.exists(),
            "{name:?} menulis di luar tujuan"
        );
    }
    // Entri bernama sama (beda huruf besar-kecil) -> tabrakan di macOS/Windows.
    let mut dup = good.clone();
    dup.push(("PROJECT.JSON".into(), b"{}".to_vec()));
    assert_rejected(&f, "ganda case", &dup);
    // Berkas bukan zip / kosong / terpotong.
    let junk = f.root.join("junk.qrpack");
    for data in [
        &b"PK\x03\x04bukan zip sebenarnya"[..],
        b"",
        b"QRPK\x01\0\0\0",
    ] {
        std::fs::write(&junk, data).unwrap();
        let dest = f.root.join("junk-tujuan/P.qrproj");
        assert!(import_qrpack(&junk, &dest).is_err());
        assert!(!dest.exists());
    }
    let whole = std::fs::read(&pack).unwrap();
    std::fs::write(&junk, &whole[..whole.len() / 2]).unwrap();
    assert!(import_qrpack(&junk, &f.root.join("junk-tujuan/P2.qrproj")).is_err());
    let _ = std::fs::remove_dir_all(&f.root);
}

#[test]
fn symlink_entries_are_rejected() {
    let f = fixture("sym");
    let (pack, _) = pack_of(&f);
    let good = read_zip(&pack);
    let z = f.root.join("sym.qrpack");
    let mut w = zip::ZipWriter::new(std::fs::File::create(&z).unwrap());
    let opts = zip::write::SimpleFileOptions::default();
    for (n, d) in &good {
        w.start_file(n.as_str(), opts).unwrap();
        w.write_all(d).unwrap();
    }
    w.add_symlink("assets/tautan", "/etc/passwd", opts).unwrap();
    w.finish().unwrap();
    let dest = f.root.join("sym-tujuan/P.qrproj");
    assert!(import_qrpack(&z, &dest).is_err());
    assert!(!dest.exists());
    assert!(listing(&f.root.join("sym-tujuan")).is_empty());
    let _ = std::fs::remove_dir_all(&f.root);
}

#[test]
fn import_limits_are_enforced() {
    let f = fixture("lim");
    let (pack, _) = pack_of(&f);
    let base = ImportLimits::default();
    let cases = [
        (
            "jumlah entri",
            ImportLimits {
                max_entries: 2,
                ..base
            },
        ),
        (
            "ukuran entri",
            ImportLimits {
                max_entry_bytes: 100_000,
                ..base
            },
        ),
        (
            "ukuran total",
            ImportLimits {
                max_total_bytes: 100_000,
                ..base
            },
        ),
        (
            "ukuran json",
            ImportLimits {
                max_json_bytes: 50,
                ..base
            },
        ),
    ];
    for (tag, limits) in cases {
        let root = f.root.join(format!("lim_{}", tag.replace(' ', "_")));
        std::fs::create_dir_all(&root).unwrap();
        let r = import_qrpack_with_limits(&pack, &root.join("P.qrproj"), &limits);
        assert!(r.is_err(), "batas '{tag}' harus ditegakkan");
        assert!(listing(&root).is_empty(), "'{tag}' meninggalkan sisa");
    }
    // Header memalsukan ukuran kecil: batas ditegakkan atas byte yang benar-benar dibaca.
    let mut m = manifest_of(&read_zip(&pack));
    m.files.iter_mut().for_each(|x| x.size = 10);
    let forged = replace(
        &read_zip(&pack),
        "manifest.json",
        serde_json::to_vec(&m).unwrap(),
    );
    assert_rejected(&f, "ukuran palsu", &forged);
    // Batas bawaan menerima pack normal.
    assert!(import_qrpack_with_limits(&pack, &f.root.join("ok/P.qrproj"), &base).is_ok());
    let _ = std::fs::remove_dir_all(&f.root);
}

// ---- Fuzz mutasi deterministik ----

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

fn mutate(base: &[u8], rng: &mut Rng) -> Vec<u8> {
    let mut v = base.to_vec();
    if v.is_empty() {
        return v;
    }
    match rng.below(5) {
        0 => {
            for _ in 0..1 + rng.below(8) {
                let i = rng.below(v.len());
                v[i] = rng.next() as u8;
            }
        }
        1 => {
            let n = rng.below(v.len());
            v.truncate(n);
        }
        2 => {
            let i = rng.below(v.len());
            let j = i + rng.below(v.len() - i);
            let chunk = v[i..j].to_vec();
            v.splice(i..i, chunk);
        }
        3 => {
            let i = rng.below(v.len());
            v.remove(i);
        }
        _ => {
            let i = rng.below(v.len());
            v.insert(i, b"\"{}[],:0-9eE/.\\"[rng.below(15)]);
        }
    }
    v
}

fn small_fixture(tag: &str) -> (Fixture, PathBuf) {
    // Aset kecil supaya ribuan iterasi cepat.
    let f = fixture(tag);
    let ext = PathBuf::from(&f.project.assets["aud1"].path);
    let small = vec![7u8; 600];
    std::fs::write(&ext, &small).unwrap();
    let mut p = qr_core::load_project(&f.project_dir).unwrap();
    p.assets.get_mut("aud1").unwrap().sha256 = sha(&small);
    save_project_atomic(&f.project_dir, &mut p).unwrap();
    let out = f.root.join("kecil.qrpack");
    export_qrpack(&f.project_dir, &out).unwrap();
    (f, out)
}

fn fuzz_import(f: &Fixture, data: &[u8], i: usize, what: &str) -> bool {
    let z = f.root.join("fuzz.qrpack");
    std::fs::write(&z, data).unwrap();
    let root = f.root.join("fuzz-tujuan");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let dest = root.join("P.qrproj");
    let r = catch_unwind(AssertUnwindSafe(|| import_qrpack(&z, &dest)));
    match r {
        Err(_) => panic!("panic pada iterasi {i} ({what})"),
        Ok(Ok(p)) => {
            // Mutasi yang tetap valid harus menghasilkan proyek utuh yang dapat dimuat.
            assert_eq!(
                qr_core::load_project(&dest).unwrap(),
                p,
                "iterasi {i} ({what})"
            );
            true
        }
        Ok(Err(e)) => {
            assert!(!e.to_string().is_empty());
            assert!(
                listing(&root).is_empty(),
                "sisa pada iterasi {i} ({what}): {:?}",
                listing(&root)
            );
            false
        }
    }
}

#[test]
fn mutated_packs_never_panic_and_failures_leave_nothing() {
    let (f, pack) = small_fixture("fuzz");
    let base = std::fs::read(&pack).unwrap();
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let (mut ok, mut err) = (0, 0);
    // (a) mutasi byte mentah pada arsip ZIP.
    for i in 0..400 {
        let data = mutate(&base, &mut rng);
        if fuzz_import(&f, &data, i, "byte mentah") {
            ok += 1;
        } else {
            err += 1;
        }
    }
    // (b) mutasi isi entri (ZIP tetap valid, CRC benar): menjangkau validasi manifest/proyek.
    let entries = read_zip(&pack);
    for i in 0..400 {
        let k = rng.below(entries.len());
        let mut e = entries.clone();
        if rng.below(6) == 0 {
            e[k].0 = String::from_utf8_lossy(&mutate(e[k].0.as_bytes(), &mut rng)).into_owned();
        } else {
            e[k].1 = mutate(&e[k].1, &mut rng);
        }
        let z = f.root.join("fuzz-entri.qrpack");
        write_zip(&z, &e);
        let data = std::fs::read(&z).unwrap();
        if fuzz_import(&f, &data, i, "isi entri") {
            ok += 1;
        } else {
            err += 1;
        }
    }
    assert!(
        err > 600,
        "mutasi seharusnya sering merusak arsip (err={err}, ok={ok})"
    );
    let _ = std::fs::remove_dir_all(&f.root);
}
