import { invoke } from '@tauri-apps/api/core';
import { QuranAyah } from '../store';

/**
 * IPC Service Wrapper
 * Provides a strongly-typed interface to Tauri commands.
 */

export async function fetchQuranVerses(surah: number, ayatStart: number, ayatEnd: number, reciterId: number): Promise<QuranAyah[]> {
  try {
    return await invoke('fetch_quran_verses', {
      surah,
      ayatStart,
      ayatEnd,
      reciterId,
    });
  } catch (error) {
    console.error('Failed to fetch quran verses:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during fetch_quran_verses');
  }
}

export async function downloadAudio(url: string, filename: string): Promise<string> {
  try {
    return await invoke('download_audio', {
      url,
      filename,
    });
  } catch (error) {
    console.error('Failed to download audio:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during download_audio');
  }
}

export async function searchStockMedia(provider: string, query: string, mediaType: string, perPage: number = 24): Promise<any[]> {
  try {
    return await invoke('search_stock_media', { provider, query, mediaType, perPage });
  } catch (error) {
    console.error('Failed to search stock media:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during search_stock_media');
  }
}

export async function downloadBackground(url: string, filename: string): Promise<string> {
  try {
    return await invoke('download_background', { url, filename });
  } catch (error) {
    console.error('Failed to download background:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during download_background');
  }
}

export async function fetchTafsir(surah: number, ayah: number, tafsirId: number): Promise<string> {
  try {
    return await invoke('fetch_tafsir', { surah, ayah, tafsirId });
  } catch (error) {
    console.error('Failed to fetch tafsir:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during fetch_tafsir');
  }
}

export async function aiSummarizeTafsir(rawText: string, language: string): Promise<string> {
  try {
    return await invoke('ai_summarize_tafsir', { rawText, language });
  } catch (error) {
    console.error('Failed to summarize tafsir:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during ai_summarize_tafsir');
  }
}

export async function aiGenerateImage(contextText: string): Promise<string> {
  try {
    return await invoke('ai_generate_image', { contextText });
  } catch (error) {
    console.error('Failed to generate image:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during ai_generate_image');
  }
}

export async function aiGenerateAudio(text: string): Promise<string> {
  try {
    return await invoke('ai_generate_audio', { text });
  } catch (error) {
    console.error('Failed to generate audio:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during ai_generate_audio');
  }
}

// ==========================================
// Utilities & Diagnostics
// ==========================================

export interface SystemDiagnostics {
  ffmpeg_path: string | null;
  ffprobe_path: string | null;
  ytdlp_path: string | null;
  python_path: string | null;
}

export async function getSystemDiagnostics(): Promise<SystemDiagnostics> {
  try {
    return await invoke('get_system_diagnostics');
  } catch (error) {
    console.error('Failed to get system diagnostics:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during get_system_diagnostics');
  }
}

export interface MediaInfo {
  duration: number;
  width: number | null;
  height: number | null;
}

export async function getMediaInfo(path: string): Promise<MediaInfo> {
  try {
    return await invoke('get_media_info', { path });
  } catch (error) {
    console.error('Failed to get media info:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during get_media_info');
  }
}

export async function cutAudio(input: string, output: string, start: number, end: number): Promise<void> {
  try {
    return await invoke('cut_audio', { input, output, start, end });
  } catch (error) {
    console.error('Failed to cut audio:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during cut_audio');
  }
}

// ==========================================
// AI Segmentation (Local Sidecar)
// ==========================================

export interface WordTiming {
  word: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
}

export interface AyahSegment {
  surah: number;
  ayah: number;
  text: string;
  start_ms: number;
  end_ms: number;
  words: WordTiming[];
}

export interface SegmentationResult {
  success: boolean;
  error_message: string | null;
  total_duration_ms: number;
  ayahs: AyahSegment[];
}

export interface SegmentRequest {
  audio_path: string;
  surah: number;
  ayahs: number[];
  texts: string[];
}

export async function runAlignment(req: SegmentRequest): Promise<SegmentationResult> {
  try {
    return await invoke('run_alignment', { req });
  } catch (error) {
    console.error('Failed to run alignment:', error);
    throw new Error(typeof error === 'string' ? error : 'Unknown error during run_alignment');
  }
}
