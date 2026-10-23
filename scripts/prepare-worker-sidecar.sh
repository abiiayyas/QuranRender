#!/usr/bin/env bash
# Membangun worker `qurender` (rilis) dan menyalinnya sebagai sidecar Tauri:
#   apps/desktop/src-tauri/binaries/qurender-<target-triple>
# Tauri menyalin berkas ini ke samping executable aplikasi (Contents/MacOS/qurender) saat membuat bundel.
# Dipakai sebelum: pnpm tauri build --bundles app --config src-tauri/tauri.sidecar.conf.json
set -euo pipefail
cd "$(dirname "$0")/.."
triple="$(rustc -vV | sed -n 's/^host: //p')"
cargo build --release -p qr-cli --bin qurender
mkdir -p apps/desktop/src-tauri/binaries
ext=""
case "$triple" in *windows*) ext=".exe" ;; esac
cp "target/release/qurender${ext}" "apps/desktop/src-tauri/binaries/qurender-${triple}${ext}"
echo "sidecar siap: apps/desktop/src-tauri/binaries/qurender-${triple}${ext}"
