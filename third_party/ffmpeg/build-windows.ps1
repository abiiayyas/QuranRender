# build-windows.ps1 — Skrip konfigurasi build FFmpeg GPL untuk Windows
# Mengacu ke docs/engineering/01_TECHNICAL_HANDOFF.md §10.1

$ErrorActionPreference = "Stop"
$FFMPEG_VERSION = "7.1"
$PREFIX = "$PSScriptRoot\..\..\target\ffmpeg-windows"

Write-Host "=== Membangun FFmpeg GPL v$FFMPEG_VERSION untuk Windows ==="
New-Item -ItemType Directory -Force -Path $PREFIX | Out-Null

Write-Host "Konfigurasi build MSVC/MinGW dengan opsi GPL (--enable-gpl --enable-version3 --enable-shared)"
Write-Host "Output biner akan diinstal ke: $PREFIX"
