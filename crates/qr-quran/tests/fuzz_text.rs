#![allow(clippy::unwrap_used)]
//! H-02: tokenizer/pembersih teks menerima teks sembarang tanpa panic (menolak dengan galat).
use qr_quran::{clean_translation, search_form, tokenize_ayah_v1};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[test]
fn random_unicode_never_panics() {
    let pool: Vec<char> =
        "ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأإٱ ًٌٍَُِّْٰۖۗۘۙۚۛۜ۞۩\u{08D6}\u{06D4}\u{200B}\u{0000}<>&é漢🙂 \n\t"
            .chars()
            .collect();
    let mut s = 0xDEAD_BEEF_CAFE_F00Du64;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    for i in 0..20000 {
        let len = (next() % 40) as usize;
        let text: String = (0..len)
            .map(|_| pool[(next() % pool.len() as u64) as usize])
            .collect();
        let r = catch_unwind(AssertUnwindSafe(|| {
            let _ = tokenize_ayah_v1(&text);
            let _ = clean_translation(&text);
            let _ = search_form(&text);
        }));
        assert!(r.is_ok(), "panic iterasi {i} pada {text:?}");
    }
}
