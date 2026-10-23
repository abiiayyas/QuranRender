#![allow(clippy::unwrap_used)]
//! H-02: keluaran ffprobe janggal tidak boleh menyebabkan panic.
use qr_media::parse_ffprobe_json;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

#[test]
fn malformed_ffprobe_json_never_panics() {
    let base = br#"{"streams":[{"codec_type":"audio","sample_rate":"44100","channels":2},{"codec_type":"video","width":320,"height":240,"avg_frame_rate":"25/1"}],"format":{"duration":"2.5","format_name":"wav"}}"#.to_vec();
    let mut s = 0x0F0F_1234_ABCD_5678u64;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    for i in 0..5000 {
        let mut d = base.clone();
        for _ in 0..1 + next() % 5 {
            let k = (next() % d.len() as u64) as usize;
            if next() % 2 == 0 {
                d[k] = next() as u8
            } else {
                d.remove(k);
            }
            if d.is_empty() {
                d.push(b'{');
            }
        }
        let t = String::from_utf8_lossy(&d).to_string();
        assert!(
            catch_unwind(AssertUnwindSafe(|| parse_ffprobe_json(
                Path::new("x.wav"),
                &t,
                1
            )))
            .is_ok(),
            "panic {i}: {t}"
        );
    }
    for weird in [
        r#"{"streams":[{"codec_type":"video","avg_frame_rate":"0/0"}],"format":{"duration":"1"}}"#,
        r#"{"streams":[{"codec_type":"audio","sample_rate":"-5","channels":99999999}],"format":{"duration":"1e400"}}"#,
        r#"{"streams":[{"codec_type":"audio"}],"format":{"duration":"NaN"}}"#,
    ] {
        let _ = parse_ffprobe_json(Path::new("x.wav"), weird, 1);
    }
}
