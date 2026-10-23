#!/usr/bin/env bash
# build-linux.sh — Membangun FFmpeg GPL untuk Linux dengan $ORIGIN rpath
# Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.1

set -euo pipefail

FFMPEG_VERSION="7.1"
PREFIX="$(pwd)/target/ffmpeg-linux"
SRC_DIR="$(pwd)/target/ffmpeg-src"

echo "=== Membangun FFmpeg GPL v${FFMPEG_VERSION} untuk Linux ==="
mkdir -p "$PREFIX" "$SRC_DIR"

if [ ! -f "$SRC_DIR/configure" ]; then
    echo "Mengunduh sumber FFmpeg ${FFMPEG_VERSION}..."
    curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" | tar -xJ --strip-components=1 -C "$SRC_DIR"
fi

cd "$SRC_DIR"

./configure \
    --prefix="$PREFIX" \
    --enable-gpl \
    --enable-version3 \
    --enable-shared \
    --disable-static \
    --disable-programs \
    --disable-doc \
    --disable-debug \
    --enable-pthreads \
    --extra-cflags="-fPIC" \
    --extra-ldflags="-Wl,-rpath,'\$ORIGIN' -Wl,-rpath,'\$ORIGIN/../lib'"

make -j"$(nproc || echo 4)"
make install

echo "✓ Selesai membangun FFmpeg untuk Linux di $PREFIX"
