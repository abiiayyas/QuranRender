import type { CloudAlignOptions } from "../bindings";

/** Konstanta sinkron AI (`align_cloud`, HF Space hetchyy/quranic-universal-aligner). */
export const ALIGN_PROGRESS_EVENT = "align-progress";

/** Pengaturan persetujuan unggah audio ke layanan cloud (wajib `true` sebelum `align_cloud`). */
export const CLOUD_CONSENT_KEY = "sync.cloud_consent";

export const CONSENT_REQUIRED_PREFIX = "CLOUD_CONSENT_REQUIRED:";
export const OFFLINE_PREFIX = "CLOUD_OFFLINE:";

/** Bawaan Quran Caption (`/process_audio_session`). */
export const DEFAULT_CLOUD_OPTIONS: CloudAlignOptions = {
  model: "Base",
  min_silence_ms: 200,
  min_speech_ms: 1000,
  pad_ms: 100,
  fill_silence: true,
};
