import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Scissors,
  UploadCloud,
  Sparkles,
  Download,
  Film,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileVideo,
  Layers,
  Video
} from 'lucide-react';

interface YtMetadata {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
  view_count?: number;
  has_subtitles: boolean;
  available_sub_langs: string[];
}

interface TranscriptSegment {
  start_sec: number;
  end_sec: number;
  text: string;
}

interface HookRecommendation {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  duration: number;
  hook_score: number;
  reasoning: string;
  suggested_caption: string;
}

export const Clipper: React.FC = () => {
  const navigate = useNavigate();
  const { setBgPath, settings } = useAppStore();

  const [sourceType, setSourceType] = useState<'youtube' | 'local'>('youtube');
  const [ytUrl, setYtUrl] = useState('');
  const [localFilePath, setLocalFilePath] = useState('');
  
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<YtMetadata | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [recommendations, setRecommendations] = useState<HookRecommendation[]>([]);

  // Video trim player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(60);
  const [layoutMode, setLayoutMode] = useState<'vertical_9_16' | 'landscape_16_9' | 'square_1_1'>('vertical_9_16');

  // Handle local video pick
  const handlePickLocalFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }]
      });

      if (selected && typeof selected === 'string') {
        setLocalFilePath(selected);
        const fileName = selected.split('/').pop() || 'Local Video';
        setMetadata({
          id: 'local_' + Date.now(),
          title: fileName,
          duration: 0, // will be updated when video metadata loads
          thumbnail: '',
          uploader: 'Local File',
          has_subtitles: false,
          available_sub_langs: []
        });
        setTranscript([]);
        setRecommendations([]);
      }
    } catch (e: any) {
      setErrorMessage('Gagal memilih file video: ' + e);
    }
  };

  // Fetch YouTube Metadata
  const handleFetchYtInfo = async () => {
    if (!ytUrl.trim()) return;
    setLoadingMeta(true);
    setErrorMessage(null);
    setMetadata(null);
    setTranscript([]);
    setRecommendations([]);

    try {
      const meta = await invoke<YtMetadata>('fetch_yt_metadata', { url: ytUrl });
      setMetadata(meta);
      setStartTime(0);
      setEndTime(Math.min(60, meta.duration || 60));
      setVideoDuration(meta.duration || 0);

      if (meta.has_subtitles) {
        fetchTranscript(ytUrl);
      }
    } catch (e: any) {
      setErrorMessage('Gagal mengambil informasi video YouTube: ' + e);
    } finally {
      setLoadingMeta(false);
    }
  };

  // Fetch Transcript
  const fetchTranscript = async (url: string) => {
    setLoadingTranscript(true);
    try {
      const segs = await invoke<TranscriptSegment[]>('fetch_yt_transcript', { url, lang: null });
      setTranscript(segs);
    } catch (e: any) {
      console.warn('Transcript fetch info:', e);
    } finally {
      setLoadingTranscript(false);
    }
  };

  // AI Hook Analysis
  const handleAnalyzeHooks = async () => {
    if (!transcript || transcript.length === 0) {
      setErrorMessage('Tidak ada transkrip subtitle yang tersedia untuk dianalisis AI pada video ini.');
      return;
    }
    setLoadingAi(true);
    setErrorMessage(null);
    try {
      const hooks = await invoke<HookRecommendation[]>('ai_analyze_yt_hooks', {
        transcript,
        videoTitle: metadata?.title || 'Islamic Video'
      });
      setRecommendations(hooks);
    } catch (e: any) {
      setErrorMessage('Gagal menganalisis hook AI: ' + e);
    } finally {
      setLoadingAi(false);
    }
  };

  // Apply timing recommendation
  const handleSelectHook = (rec: HookRecommendation) => {
    setStartTime(rec.start_time);
    setEndTime(rec.end_time);
    if (videoRef.current) {
      videoRef.current.currentTime = rec.start_time;
    }
  };

  // Video Time Update Listener
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      if (cur >= endTime) {
        videoRef.current.currentTime = startTime;
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  // Export Cut Clip
  const handleExportClip = async () => {
    const sourcePath = sourceType === 'youtube' ? ytUrl : localFilePath;
    if (!sourcePath) {
      setErrorMessage('Silakan tentukan sumber video (URL YouTube atau file lokal).');
      return;
    }

    try {
      const defaultFileName = `clip_${Date.now()}.mp4`;
      const savePath = await save({
        defaultPath: `${settings.outputDir}/${defaultFileName}`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
      });

      if (!savePath) return;

      setIsExporting(true);
      setExportMessage('Sedang memotong dan memproses klip video...');
      setErrorMessage(null);

      const result = await invoke<string>('download_and_cut_clip', {
        req: {
          source_type: sourceType,
          source_url_or_path: sourcePath,
          start_sec: startTime,
          end_sec: endTime,
          layout_mode: layoutMode,
          output_path: savePath
        }
      });

      setExportMessage(`Klip video berhasil disimpan di: ${result}`);
      alert(`Berhasil! Klip video telah disimpan di:\n${result}`);
    } catch (e: any) {
      setErrorMessage('Gagal memotong klip video: ' + e);
    } finally {
      setIsExporting(false);
    }
  };

  // Send to Editor
  const handleSendToEditor = async () => {
    const sourcePath = sourceType === 'youtube' ? ytUrl : localFilePath;
    if (!sourcePath) return;

    try {
      // Export to temp file first then use as bg
      setIsExporting(true);
      setExportMessage('Memproses video klip untuk latar belakang editor...');
      const tempOutput = `${settings.outputDir}/temp_editor_clip_${Date.now()}.mp4`;

      const result = await invoke<string>('download_and_cut_clip', {
        req: {
          source_type: sourceType,
          source_url_or_path: sourcePath,
          start_sec: startTime,
          end_sec: endTime,
          layout_mode: layoutMode,
          output_path: tempOutput
        }
      });

      setBgPath(result);
      navigate('/editor');
    } catch (e: any) {
      setErrorMessage('Gagal mengirim klip ke editor: ' + e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 text-primary rounded-xl">
              <Scissors className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
                Video Clipper & AI Hook Analyzer
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Potong video bacaan imam, murottal, atau podcast islami dari YouTube maupun file lokal untuk konten Shorts/Reels/TikTok.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Error & Export Messages */}
      {errorMessage && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{errorMessage}</span>
        </div>
      )}

      {exportMessage && !errorMessage && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{exportMessage}</span>
        </div>
      )}

      {/* Input Source Selector Card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-4 border-b border-border pb-4">
          <button
            onClick={() => setSourceType('youtube')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              sourceType === 'youtube'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Video className="w-4 h-4 text-red-500" />
            YouTube Video URL
          </button>
          <button
            onClick={() => setSourceType('local')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              sourceType === 'local'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileVideo className="w-4 h-4 text-blue-500" />
            Upload File Lokal
          </button>
        </div>

        {sourceType === 'youtube' ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">URL Video YouTube</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=... atau https://youtu.be/..."
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  className="pr-10"
                />
                <Video className="absolute right-3 top-2.5 w-5 h-5 text-muted-foreground" />
              </div>
              <Button onClick={handleFetchYtInfo} disabled={loadingMeta || !ytUrl.trim()}>
                {loadingMeta ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Memuat...
                  </>
                ) : (
                  <>Ambil Info Video</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">File Video Lokal (MP4, MOV, WebM)</label>
            <div className="flex gap-3 items-center">
              <Input
                type="text"
                readOnly
                placeholder="Pilih file video dari komputer Anda..."
                value={localFilePath}
                className="flex-1 cursor-pointer bg-muted/40"
                onClick={handlePickLocalFile}
              />
              <Button variant="secondary" onClick={handlePickLocalFile}>
                <UploadCloud className="w-4 h-4 mr-2" />
                Pilih File...
              </Button>
            </div>
          </div>
        )}

        {/* Video Info Display */}
        {metadata && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-muted/40 border border-border rounded-xl mt-4">
            {metadata.thumbnail ? (
              <img
                src={metadata.thumbnail}
                alt={metadata.title}
                className="w-32 h-20 object-cover rounded-lg shadow-sm border border-border"
              />
            ) : (
              <div className="w-32 h-20 bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
                <Film className="w-8 h-8" />
              </div>
            )}
            <div className="flex-1 space-y-1">
              <h3 className="font-semibold text-foreground text-base line-clamp-1">{metadata.title}</h3>
              <p className="text-xs text-muted-foreground">Oleh: {metadata.uploader}</p>
              <div className="flex items-center gap-3 pt-1 text-xs">
                {metadata.duration > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" /> {formatTime(metadata.duration)}
                  </span>
                )}
                {metadata.has_subtitles ? (
                  <span className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded font-medium text-[11px]">
                    ✓ Subtitle/Transkrip Tersedia
                  </span>
                ) : (
                  <span className="bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded font-medium text-[11px]">
                    Subtitel Otomatis
                  </span>
                )}
              </div>
            </div>

            {sourceType === 'youtube' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyzeHooks}
                disabled={loadingAi || loadingTranscript}
                className="shadow-sm border-primary/30 text-primary hover:bg-primary/10"
              >
                {loadingAi || loadingTranscript ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Menganalisis...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 text-amber-400" />
                    Analisis Hook AI
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* AI Recommendations Section */}
      {recommendations.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-foreground">Rekomendasi Potongan Klip Terbaik (AI)</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                onClick={() => handleSelectHook(rec)}
                className="bg-muted/30 border border-border hover:border-primary/50 p-4 rounded-xl space-y-3 cursor-pointer transition-all hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-full">
                    🔥 Score {rec.hook_score}%
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {formatTime(rec.start_time)} - {formatTime(rec.end_time)} ({rec.duration}s)
                  </span>
                </div>
                <h3 className="font-semibold text-sm text-foreground">{rec.title}</h3>
                <p className="text-xs text-muted-foreground line-clamp-2">{rec.reasoning}</p>
                <Button variant="secondary" size="sm" className="w-full text-xs mt-2">
                  Gunakan Klip Ini
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Trim & Player Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Video Preview Player */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Film className="w-5 h-5 text-primary" /> Pemutar & Pratinjau Klip
          </h2>

          <div className="relative aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center border border-border">
            {localFilePath ? (
              <video
                ref={videoRef}
                controls
                src={`atom://${localFilePath}`}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    setVideoDuration(videoRef.current.duration);
                    if (endTime === 60 || endTime > videoRef.current.duration) {
                      setEndTime(videoRef.current.duration);
                    }
                  }
                }}
                className="w-full h-full object-contain"
              />
            ) : metadata?.thumbnail ? (
              <div className="relative w-full h-full">
                <img src={metadata.thumbnail} className="w-full h-full object-contain opacity-80" alt="Preview" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <p className="text-xs text-white bg-black/60 px-3 py-1.5 rounded-full backdrop-blur">
                    Siap dipotong dari: {formatTime(startTime)} sampai {formatTime(endTime)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground p-6">
                <Film className="w-12 h-12 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Masukkan URL YouTube atau unggah video lokal untuk pratinjau.</p>
              </div>
            )}
          </div>

          {/* Timeline Slider */}
          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-xs font-mono text-muted-foreground">
              <span>Mulai: {formatTime(startTime)}</span>
              <span className="font-semibold text-primary">Durasi Klip: {formatTime(endTime - startTime)}</span>
              <span>Selesai: {formatTime(endTime)}</span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min={0}
                max={videoDuration || 300}
                step={0.1}
                value={startTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (val < endTime) setStartTime(val);
                }}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min={0}
                max={videoDuration || 300}
                step={0.1}
                value={endTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (val > startTime) setEndTime(val);
                }}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Precision Trim & Format Options */}
        <div className="space-y-6">
          {/* Format / Layout Selection */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" /> Preset Layout Output
            </h3>
            <div className="space-y-3">
              <button
                onClick={() => setLayoutMode('vertical_9_16')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  layoutMode === 'vertical_9_16'
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border bg-muted/30 hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                <div>
                  <div className="text-sm">📱 9:16 Vertical Shorts/TikTok</div>
                  <div className="text-xs opacity-70">Latar Belakang Blur Fill Otomatis</div>
                </div>
                {layoutMode === 'vertical_9_16' && <CheckCircle2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => setLayoutMode('landscape_16_9')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  layoutMode === 'landscape_16_9'
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border bg-muted/30 hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                <div>
                  <div className="text-sm">🖥️ 16:9 Landscape Video</div>
                  <div className="text-xs opacity-70">Rasio Asli Standard YouTube</div>
                </div>
                {layoutMode === 'landscape_16_9' && <CheckCircle2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => setLayoutMode('square_1_1')}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  layoutMode === 'square_1_1'
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border bg-muted/30 hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                <div>
                  <div className="text-sm">🔳 1:1 Square Instagram</div>
                  <div className="text-xs opacity-70">Potongan Persegi Feed IG</div>
                </div>
                {layoutMode === 'square_1_1' && <CheckCircle2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Time Inputs */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-foreground">Pengaturan Waktu Pemotongan</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Start (Detik)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={startTime}
                  onChange={(e) => setStartTime(Math.max(0, parseFloat(e.target.value) || 0))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">End (Detik)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={endTime}
                  onChange={(e) => setEndTime(parseFloat(e.target.value) || startTime + 10)}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <Button
                onClick={handleExportClip}
                disabled={isExporting}
                className="w-full h-12 text-base font-semibold shadow-md"
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Memproses Klip...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Eksport Klip Video (.mp4)
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={handleSendToEditor}
                disabled={isExporting}
                className="w-full text-sm border-primary/30 text-primary hover:bg-primary/10"
              >
                <Film className="w-4 h-4 mr-2" />
                Gunakan di Murottal Editor
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
