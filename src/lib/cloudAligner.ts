import { Client } from "@gradio/client";
import { readFile } from '@tauri-apps/plugin-fs';
import { SegmentationResult, SegmentRequest, runAlignment, WordTiming } from "./ipc";

export async function runCloudAlignment(req: SegmentRequest, useFallback: boolean = true): Promise<SegmentationResult> {
  try {
    console.log("[CloudAligner] Connecting to HF Space...");
    const client = await Client.connect("hetchyy/quranic-universal-aligner");
    
    console.log("[CloudAligner] Reading audio file:", req.audio_path);
    const audioBytes = await readFile(req.audio_path);
    const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
    const file = new File([blob], "audio.mp3", { type: 'audio/mpeg' });
    
    // Prepare segments_json. The API expects an array of segments (usually with 'text' property)
    // We map our ayahs to the expected format
    const segmentsJson = req.texts.map((text, idx) => ({
      id: idx.toString(),
      text: text
    }));
    
    console.log("[CloudAligner] Sending prediction request...");
    const result = await client.predict("/timestamps_direct", { 
      audio_data: file, 
      segments_json: segmentsJson, 
      granularity: "words" 
    }) as any;
    
    console.log("[CloudAligner] Result received:", result);
    
    if (result && result.error) {
      throw new Error(`Cloud API Error: ${result.error}`);
    }
    
    if (!result || !result.segments || !Array.isArray(result.segments)) {
      throw new Error("Invalid response format from Cloud Aligner.");
    }
    
    // Convert to our internal format
    const ayahs = req.ayahs.map((ayahNum, idx) => {
      const hfSegment = result.segments[idx] || { words: [], start: 0, end: 0 };
      
      const words: WordTiming[] = (hfSegment.words || []).map((w: any) => ({
        word: w.word || w.text || "",
        start_ms: Math.round((w.start || 0) * 1000),
        end_ms: Math.round((w.end || 0) * 1000),
        confidence: w.score || w.confidence || 1.0
      }));
      
      return {
        surah: req.surah,
        ayah: ayahNum,
        text: req.texts[idx],
        start_ms: Math.round((hfSegment.start || 0) * 1000),
        end_ms: Math.round((hfSegment.end || 0) * 1000),
        words: words
      };
    });
    
    let total_duration_ms = 0;
    if (ayahs.length > 0) {
      const lastAyah = ayahs[ayahs.length - 1];
      total_duration_ms = lastAyah.end_ms;
    }
    
    return {
      success: true,
      error_message: null,
      total_duration_ms,
      ayahs
    };
    
  } catch (error) {
    console.error("[CloudAligner] Error:", error);
    if (useFallback) {
      console.log("[CloudAligner] Falling back to local offline alignment...");
      return await runAlignment(req);
    } else {
      return {
        success: false,
        error_message: `Cloud Aligner failed: ${error}`,
        total_duration_ms: 0,
        ayahs: []
      };
    }
  }
}
