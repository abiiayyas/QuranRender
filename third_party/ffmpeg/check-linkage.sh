#!/usr/bin/env bash
# check-linkage.sh — Memeriksa bahwa binary/shared library dibundel dengan path relatif (@rpath / $ORIGIN)
# Mengacu ke PRD DST-3 dan docs/engineering/01_TECHNICAL_HANDOFF.md §10.1, 04_IMPLEMENTATION_PLAN.md F0-04.

set -euo pipefail

TARGET_DIR="${1:-.}"
FAILED=0

echo "Memeriksa linkage pustaka di: $TARGET_DIR"

if [[ "$(uname)" == "Darwin" ]]; then
    # macOS: periksa binary distribusi / ffmpeg dylib dengan otool -L (abaikan proc-macro dylib di deps/)
    while IFS= read -r -d '' file; do
        if [[ "$file" =~ /deps/ ]] || [[ "$file" =~ \.dSYM/ ]]; then
            continue
        fi

        if file "$file" | grep -q "Mach-O"; then
            echo "Memeriksa: $file"
            while IFS= read -r line; do
                dep=$(echo "$line" | awk '{print $1}')
                # Izinkan library sistem macOS
                if [[ "$dep" =~ ^/usr/lib/ ]] || [[ "$dep" =~ ^/System/Library/ ]] || [[ "$dep" =~ ^@rpath/ ]] || [[ "$dep" =~ ^@executable_path/ ]] || [[ "$dep" =~ ^@loader_path/ ]]; then
                    continue
                fi
                # Abaikan path self-id di dylib
                if [[ "$dep" == "$file" ]]; then
                    continue
                fi
                echo "  [GALAT] Ditemukan dependensi absolut non-sistem: $dep di $file"
                FAILED=1
            done < <(otool -L "$file" | tail -n +2)
        fi
    done < <(find "$TARGET_DIR" -type f \( -name "*.dylib" -o -name "qurender" -o -name "qr-desktop" \) -print0 2>/dev/null || true)

elif [[ "$(uname)" == "Linux" ]]; then
    # Linux: periksa dengan readelf / ldd (abaikan deps/)
    while IFS= read -r -d '' file; do
        if [[ "$file" =~ /deps/ ]]; then
            continue
        fi

        if file "$file" | grep -q "ELF"; then
            echo "Memeriksa: $file"
            if command -v readelf >/dev/null 2>&1; then
                rpath=$(readelf -d "$file" | grep -E "RPATH|RUNPATH" || true)
                if [[ -n "$rpath" ]] && echo "$rpath" | grep -qv '\$ORIGIN'; then
                    echo "  [GALAT] RPATH Linux tidak memakai \$ORIGIN: $rpath di $file"
                    FAILED=1
                fi
            fi
        fi
    done < <(find "$TARGET_DIR" -type f \( -name "*.so*" -o -name "qurender" -o -name "qr-desktop" \) -print0 2>/dev/null || true)
fi

if [[ $FAILED -eq 0 ]]; then
    echo "✓ Pemeriksaan linkage lulus: tidak ada path absolut non-sistem."
    exit 0
else
    echo "✗ Pemeriksaan linkage gagal: terdapat path absolut non-sistem yang merusak portabilitas."
    exit 1
fi
