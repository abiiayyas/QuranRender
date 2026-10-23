#![allow(clippy::unwrap_used)]
//! H-02: impor `.qrtemplate` dan `template.json` rusak/berbahaya harus ditolak tanpa panic atau penulisan di luar folder tujuan.
use qr_render::{import_qrtemplate, TemplateDoc};
use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;

fn tmp(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("qr_fuzz_tpl_{}_{name}", std::process::id()))
}

#[test]
fn mutated_template_json_never_panics() {
    let base = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("templates/subuh/template.json"),
    )
    .unwrap();
    let mut s = 0x5555_AAAA_1357_9BDFu64;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    let f = tmp("t.json");
    let (mut errs, mut oks) = (0, 0);
    for i in 0..2000 {
        let mut d = base.clone();
        for _ in 0..1 + next() % 6 {
            let k = (next() % d.len() as u64) as usize;
            match next() % 3 {
                0 => d[k] = next() as u8,
                1 => {
                    d.remove(k);
                }
                _ => d.truncate(k.max(1)),
            }
            if d.is_empty() {
                d.push(b'{');
            }
        }
        std::fs::write(&f, &d).unwrap();
        match catch_unwind(AssertUnwindSafe(|| TemplateDoc::load(&f))) {
            Err(_) => panic!("panic iterasi {i}"),
            Ok(Ok(_)) => oks += 1,
            Ok(Err(e)) => {
                assert!(!e.to_string().is_empty());
                errs += 1;
            }
        }
    }
    assert!(errs > 500, "errs={errs} oks={oks}");
    let _ = std::fs::remove_file(&f);
}

fn make_zip(path: &PathBuf, entries: &[(&str, &[u8])]) {
    let file = std::fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    for (n, data) in entries {
        z.start_file(*n, opts).unwrap();
        z.write_all(data).unwrap();
    }
    z.finish().unwrap();
}

#[test]
fn hostile_archives_are_rejected_and_nothing_escapes_the_destination() {
    let dest = tmp("dest");
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(&dest).unwrap();
    let outside = dest
        .parent()
        .unwrap()
        .join(format!("qr_fuzz_escape_{}", std::process::id()));
    let _ = std::fs::remove_file(&outside);
    let good = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("templates/subuh/template.json"),
    )
    .unwrap();

    type Entries = Vec<(String, Vec<u8>)>;
    let cases: Vec<(&str, Entries)> = vec![
        (
            "zip-slip",
            vec![
                ("../../escape.txt".into(), b"x".to_vec()),
                ("template.json".into(), good.clone()),
            ],
        ),
        (
            "absolute",
            vec![
                ("/etc/qr_escape".into(), b"x".to_vec()),
                ("template.json".into(), good.clone()),
            ],
        ),
        (
            "windows-drive",
            vec![
                ("C:\\evil.txt".into(), b"x".to_vec()),
                ("template.json".into(), good.clone()),
            ],
        ),
        (
            "tanpa template.json",
            vec![("readme.md".into(), b"x".to_vec())],
        ),
        ("json rusak", vec![("template.json".into(), b"{".to_vec())]),
        (
            "id berbahaya",
            vec![(
                "template.json".into(),
                String::from_utf8_lossy(&good)
                    .replace("\"id\": \"subuh\"", "\"id\": \"../x\"")
                    .into_bytes(),
            )],
        ),
        (
            "terlalu besar",
            vec![
                ("template.json".into(), good.clone()),
                ("big.bin".into(), vec![0u8; 40 * 1024 * 1024]),
            ],
        ),
    ];
    for (name, entries) in cases {
        let z = tmp(&format!("{}.qrtemplate", name.replace(' ', "_")));
        let refs: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(n, d)| (n.as_str(), d.as_slice()))
            .collect();
        make_zip(&z, &refs);
        let r = catch_unwind(AssertUnwindSafe(|| import_qrtemplate(&z, &dest)));
        let r = r.unwrap_or_else(|_| panic!("panic pada kasus {name}"));
        assert!(r.is_err(), "kasus '{name}' seharusnya ditolak");
        assert!(
            !outside.exists(),
            "kasus '{name}' menulis di luar folder tujuan"
        );
        let _ = std::fs::remove_file(&z);
    }
    // Berkas bukan zip dan berkas acak.
    let junk = tmp("junk.qrtemplate");
    std::fs::write(&junk, b"PK\x03\x04bukan zip sebenarnya").unwrap();
    assert!(import_qrtemplate(&junk, &dest).is_err());
    std::fs::write(&junk, b"").unwrap();
    assert!(import_qrtemplate(&junk, &dest).is_err());
    assert_eq!(
        std::fs::read_dir(&dest).unwrap().count(),
        0,
        "tidak boleh ada sisa hasil impor gagal"
    );
    let _ = std::fs::remove_file(&junk);
    let _ = std::fs::remove_dir_all(&dest);
}
