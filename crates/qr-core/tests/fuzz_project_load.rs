#![allow(clippy::unwrap_used)]
//! H-02: `project.json` rusak (mutasi bit/byte, pemotongan, duplikasi) harus menghasilkan `Err`, tidak pernah panic.

use qr_core::project::{AyahSegment, Project, WordTiming};
use std::panic::{catch_unwind, AssertUnwindSafe};

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

fn valid_json() -> Vec<u8> {
    let mut p = Project::new("Fuzz");
    p.segments.push(AyahSegment {
        id: "s".into(),
        surah_id: 1,
        ayah_number: 1,
        start_tick: 0,
        end_tick: 96_000,
        word_timings: vec![WordTiming {
            word_idx: 1,
            start_tick: 0,
            end_tick: 48_000,
            text: "x".into(),
            confidence: 0.9,
        }],
        confidence: 0.9,
        manual_override: false,
        word_range: Some((1, 3)),
    });
    serde_json::to_vec_pretty(&p).unwrap()
}

fn mutate(base: &[u8], rng: &mut Rng) -> Vec<u8> {
    let mut v = base.to_vec();
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
            v.insert(i, b"\"{}[],:0-9eE"[rng.below(12)]);
        }
    }
    v
}

#[test]
fn mutated_project_json_never_panics_and_errors_are_actionable() {
    let base = valid_json();
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let dir = std::env::temp_dir().join(format!("qr_fuzz_proj_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (mut ok, mut err) = (0, 0);
    for i in 0..3000 {
        let data = mutate(&base, &mut rng);
        std::fs::write(dir.join("project.json"), &data).unwrap();
        let r = catch_unwind(AssertUnwindSafe(|| qr_core::load_project(&dir)));
        match r {
            Err(_) => panic!(
                "panic pada iterasi {i} dengan input: {}",
                String::from_utf8_lossy(&data)
            ),
            Ok(Ok(_)) => ok += 1,
            Ok(Err(e)) => {
                assert!(!e.to_string().is_empty());
                err += 1;
            }
        }
    }
    assert!(
        err > 1000,
        "mutasi seharusnya sering merusak berkas (err={err}, ok={ok})"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unsupported_schema_version_and_empty_or_missing_files_are_errors() {
    let dir = std::env::temp_dir().join(format!("qr_fuzz_proj2_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(qr_core::load_project(&dir).is_err(), "tanpa project.json");
    std::fs::write(dir.join("project.json"), b"").unwrap();
    assert!(qr_core::load_project(&dir).is_err(), "berkas kosong");
    let mut v: serde_json::Value = serde_json::from_slice(&valid_json()).unwrap();
    v["schema_version"] = serde_json::json!(9999);
    std::fs::write(dir.join("project.json"), serde_json::to_vec(&v).unwrap()).unwrap();
    let e = qr_core::load_project(&dir).unwrap_err().to_string();
    assert!(e.contains("9999"), "{e}");
    let _ = std::fs::remove_dir_all(&dir);
}
