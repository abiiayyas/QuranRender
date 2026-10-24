import { open, save } from "@tauri-apps/plugin-dialog";
import React from "react";
import { useI18n } from "./i18n";
import { errorText } from "./tauri";
import { Icon } from "./ui";

/** Ekstensi media yang diterima `audio_import`; harus sama dengan `qr_media::probe::SUPPORTED_EXTENSIONS`. */
export const MEDIA_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "mp4", "mov", "mkv", "webm"];
/** Ekstensi gambar latar; harus sama dengan yang diterima `background_import`. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];
/** Ekstensi video (dipakai sebagai audio atau latar). */
export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm"];
/** Ekstensi audio saja (tanpa video). */
export const AUDIO_ONLY_EXTENSIONS = MEDIA_EXTENSIONS.filter((e) => !VIDEO_EXTENSIONS.includes(e));
/** Semua ekstensi yang diterima sebagai latar: gambar dan video. */
export const BACKGROUND_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
export const PACK_EXTENSION = "qrpack";

/** Ekstensi huruf kecil dari path/nama berkas (tanpa titik); string kosong bila tidak ada. */
export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

export type Pick = () => Promise<string | null>;

/** Dialog bawaan untuk memilih satu berkas yang ada; `null` bila dibatalkan. */
export function openFile(filterName: string, extensions: string[]): Promise<string | null> {
  return open({ multiple: false, directory: false, filters: [{ name: filterName, extensions }] });
}

/** Dialog bawaan untuk memilih satu folder; `null` bila dibatalkan. */
export function openFolder(): Promise<string | null> {
  return open({ multiple: false, directory: true });
}

/** Dialog bawaan "Simpan sebagai"; `null` bila dibatalkan. */
export function saveFile(filterName: string, extension: string, defaultName: string): Promise<string | null> {
  return save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [extension] }] });
}

/** Nama berkas aman dari nama proyek (tanpa pemisah path atau karakter terlarang Windows). */
export function safeFileName(name: string, extension: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "quranrender";
  return `${base}.${extension}`;
}

/** Tombol "Pilih…" di samping isian path: membuka dialog bawaan lalu mengisi path terpilih. */
export function PickButton({
  pick,
  onPicked,
  onError,
  disabled,
  primary,
  label,
}: {
  pick: Pick;
  onPicked: (path: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  primary?: boolean;
  label?: string;
}): React.ReactElement {
  const { t } = useI18n();
  const run = async () => {
    try {
      const path = await pick();
      if (path) onPicked(path);
    } catch (e) {
      onError(errorText(e));
    }
  };
  return (
    <button
      type="button"
      className={primary ? "qr-btn qr-btn--primary qr-btn--sm" : "qr-btn qr-btn--secondary"}
      disabled={disabled}
      onClick={() => void run()}
    >
      <Icon name="folder-open" />
      {label ?? t("common.choose")}
    </button>
  );
}
