#!/usr/bin/env bash
# build-macos.sh — Membangun FFmpeg GPL untuk macOS dengan @rpath
# Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.1

set -euo pipefail

FFMPEG_VERSION="7.1"
PREFIX="$(pwd)/target/ffmpeg-macos"
SRC_DIR="$(pwd)/target/ffmpeg-src"

echo "=== Membangun FFmpeg GPL v${FFMPEG_VERSION} untuk macOS ==="
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
    --enable-videotoolbox \
    --enable-shared \
    --disable-static \
    --disable-programs \
    --disable-doc \
    --disable-debug \
    --enable-pthreads \
    --extra-cflags="-mmacosx-version-min=11.0" \
    --extra-ldflags="-mmacosx-version-min=11.0 -Wl,-rpath,@loader_path/ -Wl,-rpath,@executable_path/../Frameworks"

make -j"$(sysctl -n hw.ncpu || echo 4)"
make install

# Sesuaikan install_name agar merujuk ke @rpath
for dylib in "$PREFIX/lib/"*.dylib; do
    if [ -f "$dylib" ] && [ ! -L "$dylib" ]; then
        name=$(basename "$dylib")
        install_name_tool -id "@rpath/$name" "$dylib"
        for dep in "$PREFIX/lib/"*.dylib; do
            dep_name=$(basename "$dep")
            install_name_tool -change "$PREFIX/lib/$dep_name" "@rpath/$dep_name" "$dylib" 2>/dev/null || true
        done
    fi
done

echo "✓ Selesai membangun FFmpeg untuk macOS di $PREFIX"
