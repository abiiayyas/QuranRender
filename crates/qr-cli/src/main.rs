//! Biner `qurender`: CLI pengembang di atas pustaka `qr_cli` (lihat lib.rs).

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    qr_cli::run_cli(&args)
}
