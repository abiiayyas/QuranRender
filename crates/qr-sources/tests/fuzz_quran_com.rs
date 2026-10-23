#![allow(clippy::unwrap_used)]
//! H-02: respons Quran.com rusak harus ditolak tanpa panic.
use qr_sources::parse_quran_com_payload;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[test]
fn mutated_payloads_never_panic() {
    let base = serde_json::json!({"translations":[
        {"resource_id":20,"verse_key":"1:1","text":"In the name<sup foot_note=1>1</sup> of Allah."},
        {"resource_id":20,"verse_key":"1:2","text":"Praise is <i>due</i> to Allah."}]})
    .to_string()
    .into_bytes();
    let expected = [(1u32, 1u32), (1, 2)];
    let mut s = 0x1234_5678_9ABC_DEF1u64;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    for i in 0..4000 {
        let mut d = base.clone();
        for _ in 0..1 + next() % 6 {
            let k = (next() % d.len() as u64) as usize;
            match next() % 3 {
                0 => d[k] = next() as u8,
                1 => {
                    d.remove(k);
                }
                _ => d.insert(k, b"<>/\"{}:0"[(next() % 8) as usize]),
            }
            if d.is_empty() {
                d.push(b'{');
            }
        }
        let text = String::from_utf8_lossy(&d).to_string();
        let r = catch_unwind(AssertUnwindSafe(|| {
            parse_quran_com_payload("en.saheeh", 20, &expected, &text)
        }));
        assert!(r.is_ok(), "panic iterasi {i}: {text}");
    }
}

#[test]
fn unbalanced_tags_and_huge_numbers_are_handled() {
    for raw in [
        "<",
        "<sup foot_note=",
        "<sup foot_note=99999999999999999999>x",
        "</sup></sup>",
        "a<b",
        "<<<>>>",
    ] {
        let _ = qr_sources::extract_clean_translation_and_footnotes(raw);
    }
}
