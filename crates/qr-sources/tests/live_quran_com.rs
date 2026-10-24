#![allow(clippy::unwrap_used)]
//! Uji jaringan nyata Quran.com v4: katalog + pasang edisi Saheeh International (id 20) ke content.db
//! sementara, lalu dibaca lewat ATTACH dari quran.db seperti renderer.

use qr_sources::quran_api::{fetch_catalog, install_edition};
use qr_sources::{ContentDb, NetworkPolicy, UreqTransport};
use std::path::Path;
use std::time::Duration;

#[test]
#[ignore = "butuh internet (api.quran.com) dan build/dataset/quran.db; jalankan: cargo test -p qr-sources --test live_quran_com -- --ignored"]
fn installs_saheeh_international_from_quran_com() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let quran =
        qr_quran::QuranDatabase::open_unverified_for_test(&root.join("build/dataset/quran.db"))
            .unwrap();
    let expected = quran.all_verse_refs().unwrap();
    assert_eq!(expected.len(), 6236);

    let dir = std::env::temp_dir().join(format!("qr_live_qdc_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let content_path = dir.join("content.db");
    let mut db = ContentDb::open(&content_path).unwrap();
    let http = UreqTransport::new(NetworkPolicy::new(), Duration::from_secs(120));

    let (catalog, cached) = fetch_catalog(&http, &db, 1, 0).unwrap();
    assert!(!cached);
    assert!(
        catalog.len() > 50,
        "katalog terlalu kecil: {}",
        catalog.len()
    );
    let saheeh = catalog.iter().find(|e| e.id == 20).unwrap();
    assert_eq!(
        (saheeh.iso_code.as_str(), saheeh.key().as_str()),
        ("en", "en.qdc20")
    );

    let started = std::time::Instant::now();
    let ed = install_edition(&http, &mut db, saheeh, &expected, 2).unwrap();
    eprintln!(
        "Saheeh terpasang: {} ayat dalam {:.1} dtk",
        ed.total_verses,
        started.elapsed().as_secs_f64()
    );
    assert_eq!(ed.total_verses, 6236);

    assert!(quran.attach_installed_translations(&content_path).unwrap());
    let t = quran.verse_translation("en.qdc20", 1, 1).unwrap().unwrap();
    assert_eq!(
        t,
        "In the name of Allāh, the Entirely Merciful, the Especially Merciful."
    );
    let long = quran
        .verse_translation("en.qdc20", 2, 282)
        .unwrap()
        .unwrap();
    assert!(!long.contains('<') && !long.contains("foot_note"), "{long}");
    drop(quran);
    let _ = std::fs::remove_dir_all(&dir);
}
