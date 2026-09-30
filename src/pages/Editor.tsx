import React, { useRef, useState } from 'react';
import { useAppStore } from '../store';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { toPng } from 'html-to-image';
import { getFontEmbedCSS } from '../utils/fontEmbed';
import { PreviewCanvas, PreviewCanvasHandle } from '../components/PreviewCanvas';
import { getAudioDuration } from '../utils/audio';
import { convertFileSrc } from '@tauri-apps/api/core';
import { fetchQuranVerses, downloadAudio, searchStockMedia, downloadBackground, fetchTafsir, aiSummarizeTafsir, aiGenerateImage, aiGenerateAudio, runAlignment } from '../lib/ipc';
import { runCloudAlignment } from '../lib/cloudAligner';
import { SURAH_LIST } from '../utils/surahList';
import { RECITER_LIST } from '../utils/reciterList';

export const Editor: React.FC = () => {
  const store = useAppStore();
  const previewRef = useRef<PreviewCanvasHandle>(null);
  
  const [surah, setSurah] = useState('1');
  const [activeTab, setActiveTab] = useState<'data' | 'customize' | 'templates' | 'ai'>('data');
  const [ayatStart, setAyatStart] = useState('1');
  const [ayatEnd, setAyatEnd] = useState('2');
  const [loading, setLoading] = useState(false);
  const [autoFetchAudio, setAutoFetchAudio] = useState<boolean>(true);
  const [useCloudAligner, setUseCloudAligner] = useState<boolean>(false);
  
  // AI & Tafsir State
  const [tafsirSourceId, setTafsirSourceId] = useState<string>('169'); // 169 = Ibn Kathir English
  const [rawTafsir, setRawTafsir] = useState<string>('');
  const [aiSummary, setAiSummary] = useState<string>('');
  const [isFetchingTafsir, setIsFetchingTafsir] = useState<boolean>(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);

  // Stock background fetch state
  interface StockMedia {
    id: string;
    provider: string;
    media_type: string;
    preview_url: string;
    download_url: string;
    width: number;
    height: number;
    duration: number | null;
    author: string;
  }
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState('');
  const [stockProvider, setStockProvider] = useState<'pixabay' | 'pexels'>('pixabay');
  const [stockType, setStockType] = useState<'image' | 'video'>('image');
  const [stockResults, setStockResults] = useState<StockMedia[]>([]);
  const [isFetchingStock, setIsFetchingStock] = useState(false);
  const [isDownloadingStock, setIsDownloadingStock] = useState(false);
  const [stockError, setStockError] = useState('');

  const activeSlide = store.activeSlideId ? store.slides.find(s => s.id === store.activeSlideId) : null; 
  const [reciterId, setReciterId] = useState('7'); // Default Mishary
  const [useQuranApi, setUseQuranApi] = useState(true);
  const [manualArabic, setManualArabic] = useState('');
  const [manualTranslation, setManualTranslation] = useState('');
  
  const [thumbnailTitle, setThumbnailTitle] = useState('Surah Al-Baqarah');
  const [thumbnailSubtitle, setThumbnailSubtitle] = useState('Mishary Rashid Alafasy');
  const [generatingThumb, setGeneratingThumb] = useState(false);
  const bgIsVideo = !!(store.bgPath && store.bgPath.toLowerCase().match(/\.(mp4|mov|webm)$/));
  // Background for the generated thumbnail: use the uploaded thumbnail image
  // if provided; otherwise fall back to the project background when it's a
  // static image (a video background can't be captured as a thumbnail).
  const thumbnailBgPath = (() => {
    if (store.customization.thumbnailPath) return store.customization.thumbnailPath;
    if (store.bgPath && !bgIsVideo) return store.bgPath;
    return null;
  })();

  const handleGenerateThumbnailText = async () => {
    const el = document.getElementById('thumbnail-generator');
    if (!el) return;
    try {
      setGeneratingThumb(true);
      const baseW = store.customization.videoOrientation === 'landscape' ? 1920 : 1080;
      const baseH = store.customization.videoOrientation === 'landscape' ? 1080 : 1920;
      const fontEmbedCSS = await getFontEmbedCSS();
      const dataUrl = await toPng(el, { width: baseW, height: baseH, cacheBust: true, backgroundColor: '#000000', fontEmbedCSS });
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      
      const binaryString = window.atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      
      const filePath = await save({
          filters: [{ name: 'Image', extensions: ['png'] }],
          defaultPath: 'thumbnail.png'
      });
      
      if (filePath) {
          await writeFile(filePath, bytes);
          store.updateCustomization({ thumbnailPath: filePath });
          alert('Thumbnail generated and saved successfully!');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to generate thumbnail: ' + e);
    } finally {
      setGeneratingThumb(false);
    }
  };

  const handleSetManualText = () => {
    store.setVerses([{
      surah: 1,
      ayah: 1,
      arabic: manualArabic || 'بسم الله الرحمن الرحيم',
      translation: manualTranslation || 'Dengan menyebut nama Allah Yang Maha Pengasih lagi Maha Penyayang.',
      words: []
    }]);
  };

  const handleAddManualText = () => {
    store.addVerse({
      surah: store.verses.length + 1,
      ayah: store.verses.length + 1,
      arabic: manualArabic || 'بسم الله الرحمن الرحيم',
      translation: manualTranslation || 'Dengan menyebut nama Allah Yang Maha Pengasih lagi Maha Penyayang.',
      words: []
    });
    setManualArabic('');
    setManualTranslation('');
  };
  const handleFetchAyat = async () => {
    try {
      setLoading(true);
      const verses = await fetchQuranVerses(
        parseInt(surah),
        parseInt(ayatStart),
        parseInt(ayatEnd),
        parseInt(reciterId) // Pass reciterId to fetch words correctly from Rust
      );
      store.setVerses(verses);

      if (autoFetchAudio && verses.length > 0) {
        for (let i = 0; i < verses.length; i++) {
          const v = verses[i];
          const audioUrlReq = await fetch(`https://api.quran.com/api/v4/recitations/${reciterId}/by_ayah/${surah}:${v.ayah}`);
          const audioData = await audioUrlReq.json();
          
          if (audioData && audioData.audio_files && audioData.audio_files.length > 0) {
            let url = audioData.audio_files[0].url;
            if (url.startsWith('//')) {
              url = `https:${url}`;
            } else if (!url.startsWith('http')) {
              url = `https://verses.quran.com/${url}`;
            }
            const filename = `quran_${surah}_${v.ayah}_${reciterId}.mp3`;
            
            const localPath = await downloadAudio(url, filename);
            
            const dur = await getAudioDuration(convertFileSrc(localPath));
            store.updateVerseAudio(i, localPath, dur);
            
            if (i === 0) {
              store.setAudioPath(localPath);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      alert('Failed to fetch ayat or audio');
    } finally {
      setLoading(false);
    }
  };

  const handleSegment = async () => {
    if (!store.audioPath || store.verses.length === 0) {
      alert('Fetch ayat and audio first.');
      return;
    }
    
    setLoading(true);
    try {
      const req = {
        audio_path: store.audioPath,
        surah: parseInt(surah),
        ayahs: store.verses.map(v => v.ayah),
        texts: store.verses.map(v => v.arabic) // usually Arabic text is passed to aligner
      };
      
      let segResult;
      if (useCloudAligner) {
        segResult = await runCloudAlignment(req, true); // true = local fallback
      } else {
        segResult = await runAlignment(req);
      }

      if (segResult.success && segResult.ayahs) {
        const updatedVerses = store.verses.map((v) => {
          const matched = segResult.ayahs.find(a => a.ayah === v.ayah);
          if (matched) {
            return {
              ...v,
              words: matched.words.map((w, idx) => ({
                position: idx + 1,
                arabic: w.word,
                start_ms: w.start_ms,
                end_ms: w.end_ms
              })),
            };
          }
          return v;
        });
        store.setVerses(updatedVerses as any);
        alert('Alignment complete!');
      } else {
        alert('Alignment failed: ' + segResult.error_message);
      }
    } catch (e) {
      console.error(e);
      alert('Alignment exception: ' + e);
    } finally {
      setLoading(false);
    }
  };

  const handleImportAudio = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a'] }]
    });
    if (file) {
      store.setAudioPath(file as string);
    }
  };

  const handleImportBackground = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (file) {
      store.setBgPath(file as string);
    }
  };

  const handleSearchStock = async () => {
    if (!stockQuery.trim()) return;
    setIsFetchingStock(true);
    setStockError('');
    try {
      const results = await searchStockMedia(
        stockProvider,
        stockQuery,
        stockType,
        24
      );
      setStockResults(results);
      if (results.length === 0) setStockError('No results found.');
    } catch (e) {
      setStockError(String(e));
      setStockResults([]);
    } finally {
      setIsFetchingStock(false);
    }
  };

  const handlePickStock = async (item: StockMedia) => {
    if (!item.download_url) { alert('No download URL for this item.'); return; }
    setIsDownloadingStock(true);
    try {
      const extMatch = item.download_url.split('?')[0].match(/\.(\w{2,5})$/);
      const ext = extMatch ? extMatch[1] : (item.media_type === 'video' ? 'mp4' : 'jpg');
      const filename = `${item.provider}_${item.id}.${ext}`;
      const localPath = await downloadBackground(item.download_url, filename);
      store.setBgPath(localPath);
      setStockModalOpen(false);
    } catch (e) {
      alert(`Download failed: ${e}`);
    } finally {
      setIsDownloadingStock(false);
    }
  };

  const handleImportThumbnail = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    if (file) {
      store.updateCustomization({ thumbnailPath: file as string });
    }
  };

  const handleGenerate = async () => {
    if (!store.audioPath || !store.bgPath || store.verses.length === 0) {
      alert("Please ensure audio, background, and verses are loaded.");
      return;
    }

    if (!previewRef.current) return;

    try {
      setLoading(true);
      store.setIsExporting(true);
      
      const dir = store.settings.outputDir.replace(/\/$/, '');
      
      const baseW = store.customization.videoOrientation === 'landscape' ? 1920 : 1080;
      const baseH = store.customization.videoOrientation === 'landscape' ? 1080 : 1920;
      // We need to render the canvas at baseW x baseH without scaling for the export.

      // Pre-load font embed CSS so Arabic fonts (LPMQ, Uthmanic) render
      // correctly in the exported PNG frames.
      const fontEmbedCSS = await getFontEmbedCSS();

      if (store.slides.length === 0) {
        throw new Error("No slides to render. Fetch data first.");
      }

      let audioPaths: string[] = [];
      let overlaySequence: any[] = [];
      let cumulativeAudioDurationMs = 0;

      const uniqueVerseIndices = Array.from(new Set(store.slides.map(s => s.verseIndex)));
      uniqueVerseIndices.sort((a,b) => a - b);

      // Determine which verse is first and last for fade-in/fade-out.
      const firstVerseIndex = uniqueVerseIndices[0];
      const lastVerseIndex = uniqueVerseIndices[uniqueVerseIndices.length - 1];
      const fadeDuration = store.customization.fadeDuration;
      
      for (let vPos = 0; vPos < uniqueVerseIndices.length; vPos++) {
        const vIndex = uniqueVerseIndices[vPos];
        const verse = store.verses[vIndex];
        const vAudioPath = verse.audioPath || store.audioPath;
        if (!vAudioPath) {
           throw new Error("Missing audio for verse " + verse.ayah);
        }
        audioPaths.push(vAudioPath);
        
        const isFirstVerse = vIndex === firstVerseIndex;
        const isLastVerse = vIndex === lastVerseIndex;
        const verseSlides = store.slides.filter(s => s.verseIndex === vIndex);
        
        const quranSlides = verseSlides.filter(s => s.type !== 'tafsir');
        const tafsirSlides = verseSlides.filter(s => s.type === 'tafsir');
        
        // 1. Process Quran Slides
        for (let slideIdx = 0; slideIdx < quranSlides.length; slideIdx++) {
          const slide = quranSlides[slideIdx];
          const isFirstSlideOfFirstVerse = isFirstVerse && slideIdx === 0;
          const isLastSlideOfLastVerse = isLastVerse && slideIdx === quranSlides.length - 1 && tafsirSlides.length === 0;

          const slideEl = document.getElementById(`render-slide-${slide.id}`);
          const targetEl = slideEl?.querySelector('.preview-canvas-container') as HTMLElement;
          if (!targetEl) throw new Error("Render element not found");
          
          if (store.customization.karaokeMode && verse.words && verse.words.length > 0) {
            const displayWords = verse.words.slice(slide.wordStartIndex, slide.wordEndIndex);
            
            store.updateCustomization({ highlightWordIndex: null });
            await new Promise(res => setTimeout(res, 50));
            
            const baseFrameUrl = await toPng(targetEl, {
              width: baseW, height: baseH, cacheBust: true, backgroundColor: 'transparent',
              style: { transform: 'scale(1)', transformOrigin: 'top left', background: 'transparent' },
              pixelRatio: 1, filter: (node) => node.id !== 'preview-bg-layer',
              fontEmbedCSS
            });

            // Determine the true start and end of this slide within the verse timeline
            const firstWord = displayWords[0];
            const slideStartMs = slideIdx === 0 ? 0 : (firstWord?.start_ms ?? 0);
            const nextSlideWord = verse.words[slide.wordEndIndex];

            let previous_end_ms = slideStartMs;
            
            // If there's a gap before the first word of this slide, show the base frame
            if (firstWord && firstWord.start_ms !== null && firstWord.start_ms > slideStartMs) {
              overlaySequence.push({
                base64: baseFrameUrl.replace(/^data:image\/png;base64,/, ""),
                start_ms: Math.round(cumulativeAudioDurationMs + slideStartMs),
                end_ms: Math.round(cumulativeAudioDurationMs + firstWord.start_ms),
                fade_in: isFirstSlideOfFirstVerse && slideStartMs === 0,
                fade_out: false,
                fade_duration: fadeDuration
              });
              previous_end_ms = firstWord.start_ms;
            }

            for (let i = 0; i < displayWords.length; i++) {
              const word = displayWords[i];
              const actualWordIndex = slide.wordStartIndex + i;
              if (word.start_ms === null) continue;
              
              store.updateCustomization({ highlightWordIndex: actualWordIndex });
              await new Promise(res => setTimeout(res, 50));
              
              const frameDataUrl = await toPng(targetEl, {
                width: baseW, height: baseH, cacheBust: true, backgroundColor: 'transparent',
                style: { transform: 'scale(1)', transformOrigin: 'top left', background: 'transparent' },
                pixelRatio: 1, filter: (node) => node.id !== 'preview-bg-layer',
                fontEmbedCSS
              });
              
              const start_time = word.start_ms;
              const next_word = displayWords[i + 1] || nextSlideWord;
              const end_time = word.end_ms ?? (next_word?.start_ms ?? (verse.audioDurationMs || 5000));
              
              const shouldFadeIn = isFirstSlideOfFirstVerse && i === 0 && previous_end_ms === 0;
              const shouldFadeOut = isLastSlideOfLastVerse && i === displayWords.length - 1;

              overlaySequence.push({
                base64: frameDataUrl.replace(/^data:image\/png;base64,/, ""),
                start_ms: Math.round(cumulativeAudioDurationMs + start_time),
                end_ms: Math.round(cumulativeAudioDurationMs + end_time),
                fade_in: shouldFadeIn,
                fade_out: shouldFadeOut,
                fade_duration: fadeDuration
              });
              previous_end_ms = end_time;
            }
            store.updateCustomization({ highlightWordIndex: null });
          } else {
             const displayWords = verse.words ? verse.words.slice(slide.wordStartIndex, slide.wordEndIndex) : [];
             const firstWord = displayWords.length > 0 ? displayWords[0] : null;
             
             const slideStartMs = slideIdx === 0 ? 0 : (firstWord?.start_ms ?? 0);
             const nextSlideWord = verse.words ? verse.words[slide.wordEndIndex] : null;
             const slideEndMs = nextSlideWord?.start_ms ?? (verse.audioDurationMs || 5000);
             
             const frameDataUrl = await toPng(targetEl, {
                width: baseW, height: baseH, cacheBust: true, backgroundColor: 'transparent',
                style: { transform: 'scale(1)', transformOrigin: 'top left', background: 'transparent' },
                pixelRatio: 1, filter: (node) => node.id !== 'preview-bg-layer',
                fontEmbedCSS
             });
             
             overlaySequence.push({
               base64: frameDataUrl.replace(/^data:image\/png;base64,/, ""),
               start_ms: Math.round(cumulativeAudioDurationMs + slideStartMs),
               end_ms: Math.round(cumulativeAudioDurationMs + slideEndMs),
               fade_in: isFirstSlideOfFirstVerse,
               fade_out: isLastSlideOfLastVerse,
               fade_duration: fadeDuration
             });
          }
        }
        
        cumulativeAudioDurationMs += verse.audioDurationMs || 0;
        
        // 2. Process Tafsir Slides
        for (let tIdx = 0; tIdx < tafsirSlides.length; tIdx++) {
           const tSlide = tafsirSlides[tIdx];
           const tSlideEl = document.getElementById(`render-slide-${tSlide.id}`);
           const targetEl = tSlideEl?.querySelector('.preview-canvas-container') as HTMLElement;
           if (!targetEl) throw new Error("Render element not found");
           
           let tAudioDurationMs = (tSlide.slideDuration || 5) * 1000;
           if (tSlide.audioPath) {
              const dur = await new Promise<number>((resolve) => {
                const audio = new Audio(convertFileSrc(tSlide.audioPath!));
                audio.onloadedmetadata = () => resolve(audio.duration * 1000);
                audio.onerror = () => resolve((tSlide.slideDuration || 5) * 1000);
              });
              tAudioDurationMs = dur;
              audioPaths.push(tSlide.audioPath);
           } else {
              audioPaths.push(`SILENCE_SECONDS:${tSlide.slideDuration || 5}`);
           }
           
           const frameDataUrl = await toPng(targetEl, {
              width: baseW, height: baseH, cacheBust: true, backgroundColor: 'transparent',
              style: { transform: 'scale(1)', transformOrigin: 'top left', background: 'transparent' },
              pixelRatio: 1, 
              // Keep background if it's a custom Tafsir background image! (Not video)
              filter: (node) => {
                 if (node.id === 'preview-bg-layer') {
                    if (tSlide.customBgPath && tSlide.customBgPath.match(/\.(png|jpg|jpeg|webp)$/i)) {
                       return true; // keep it
                    }
                    return false; // remove it
                 }
                 return true;
              },
              fontEmbedCSS
           });
           
           const isLastTafsirOfLastVerse = isLastVerse && tIdx === tafsirSlides.length - 1;
           
           overlaySequence.push({
             base64: frameDataUrl.replace(/^data:image\/png;base64,/, ""),
             start_ms: Math.round(cumulativeAudioDurationMs),
             end_ms: Math.round(cumulativeAudioDurationMs + tAudioDurationMs),
             fade_in: true, // Tafsir slides always fade in
             fade_out: isLastTafsirOfLastVerse || true, // Tafsir slides always fade out
             fade_duration: fadeDuration
           });
           
           cumulativeAudioDurationMs += tAudioDurationMs;
        }
      }
      
      const jobId = `job_${Date.now()}`;
      const outputPath = `${dir}/quran_project_${Date.now()}.mp4`;

      store.updateRenderJob({
        job_id: jobId,
        status: 'pending',
        progress: 0,
        error: null,
        jobData: {
          id: jobId,
          title: `Render Project (${store.slides.length} slides)`,
          audio_paths: audioPaths,
          bg_path: store.bgPath,
          output_path: outputPath,
          overlay_base64: null,
          overlay_sequence: overlaySequence.length > 0 ? overlaySequence : null,
          thumbnail_path: store.customization.thumbnailPath,
          animation_style: store.customization.animationStyle !== 'none' ? store.customization.animationStyle : null,
          orientation: store.customization.videoOrientation,
          duration: store.customization.videoDuration !== null ? store.customization.videoDuration : null,
          fade_duration: fadeDuration
        }
      });
      
      alert(`Render job added to queue! Head over to the Render Queue tab to process it.`);
    } catch (err) {
      console.error(err);
      alert(`Render failed: ${err}`);
    } finally {
      setLoading(false);
      store.setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      {/* Top Section */}
      <div className="flex flex-1 h-[60%] min-h-[400px] overflow-hidden border-b border-border">
        {/* Left panel: Controls */}
        <div className="w-1/3 bg-card border-r border-border flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-xl font-bold mb-4">Project Editor</h2>
          <div className="flex bg-muted p-1 rounded-md">
            <button 
              onClick={() => setActiveTab('data')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-all ${activeTab === 'data' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >Data</button>
            <button 
              onClick={() => setActiveTab('customize')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-all ${activeTab === 'customize' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >Customize</button>
            <button 
              onClick={() => setActiveTab('templates')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-all ${activeTab === 'templates' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >Templates</button>
            <button 
              onClick={() => setActiveTab('ai')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-all ${activeTab === 'ai' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-primary'}`}
            >AI & Tafsir</button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {activeTab === 'data' && (
            <>
              <section>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Quran Data</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Use API</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={useQuranApi} onChange={e => setUseQuranApi(e.target.checked)} />
                  <div className="w-7 h-4 bg-muted/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>
            
            <div className="bg-muted p-3 rounded">
              {useQuranApi ? (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="w-full">
                      <label className="block text-xs text-muted-foreground mb-1">Surah</label>
                      <select 
                        value={surah} 
                        onChange={e => {
                          const newSurah = e.target.value;
                          setSurah(newSurah);
                          const surahData = SURAH_LIST.find(s => s.id.toString() === newSurah);
                          if (surahData) {
                            if (parseInt(ayatStart) > surahData.count) setAyatStart("1");
                            if (parseInt(ayatEnd) > surahData.count) setAyatEnd(surahData.count.toString());
                          }
                        }} 
                        className="w-full p-2 bg-background border border-input rounded text-foreground text-sm"
                      >
                        {SURAH_LIST.map(s => (
                          <option key={s.id} value={s.id.toString()}>{s.id}. {s.name} ({s.trans})</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-full">
                      <label className="block text-xs text-muted-foreground mb-1">Qari (Reciter)</label>
                      <select 
                        value={reciterId} 
                        onChange={e => setReciterId(e.target.value)}
                        className="w-full p-2 bg-background border border-input rounded text-foreground text-sm"
                      >
                        {RECITER_LIST.map(r => (
                          <option key={r.id} value={r.id.toString()}>{r.name} ({r.style})</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-1/2">
                        <label className="block text-xs text-muted-foreground mb-1">Mulai Ayat</label>
                        <input type="number" min="1" max={SURAH_LIST.find(s => s.id.toString() === surah)?.count || 286} value={ayatStart} onChange={e => setAyatStart(e.target.value)} placeholder="Start" className="w-full p-2 bg-background border border-input rounded text-foreground" />
                      </div>
                      <div className="w-1/2">
                        <label className="block text-xs text-muted-foreground mb-1">Sampai Ayat</label>
                        <input type="number" min="1" max={SURAH_LIST.find(s => s.id.toString() === surah)?.count || 286} value={ayatEnd} onChange={e => setAyatEnd(e.target.value)} placeholder="End" className="w-full p-2 bg-background border border-input rounded text-foreground" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center mt-3 mb-2 gap-2">
                    <input 
                      type="checkbox" 
                      id="autoFetchAudio"
                      checked={autoFetchAudio}
                      onChange={e => setAutoFetchAudio(e.target.checked)}
                      className="rounded bg-background border-input"
                    />
                    <label htmlFor="autoFetchAudio" className="text-xs text-muted-foreground">
                      Auto-Fetch Audio & Enable Batch Mode
                    </label>
                  </div>
                  <div className="flex items-center mb-2 gap-2">
                    <input 
                      type="checkbox" 
                      id="useCloudAligner"
                      checked={useCloudAligner}
                      onChange={e => setUseCloudAligner(e.target.checked)}
                      className="rounded bg-background border-input"
                    />
                    <label htmlFor="useCloudAligner" className="text-xs text-muted-foreground">
                      Use Cloud HF Aligner (quranic-universal-aligner)
                    </label>
                  </div>
                  <button onClick={handleFetchAyat} disabled={loading} className="w-full bg-primary hover:bg-primary/90 py-2 rounded text-primary-foreground font-medium transition disabled:opacity-50">
                    {loading ? 'Processing...' : (autoFetchAudio ? 'Fetch & Auto-Audio' : 'Fetch Quran Text')}
                  </button>
                  <button onClick={handleSegment} disabled={loading || store.verses.length === 0} className="w-full bg-secondary hover:bg-secondary/80 py-2 rounded text-secondary-foreground font-medium transition disabled:opacity-50 mt-2">
                    {loading ? 'Aligning...' : 'Run Aligner / Segment'}
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Teks Arab (Manual)</label>
                    <textarea value={manualArabic} onChange={e => setManualArabic(e.target.value)} className="w-full p-2 bg-background border border-input rounded text-foreground text-right text-lg" rows={3} placeholder="Teks Arab..." dir="rtl" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Terjemahan (Manual)</label>
                    <textarea value={manualTranslation} onChange={e => setManualTranslation(e.target.value)} className="w-full p-2 bg-background border border-input rounded text-foreground text-sm" rows={2} placeholder="Terjemahan..." />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={handleSetManualText} className="w-1/2 bg-red-600 hover:bg-red-700 py-2 rounded text-white font-medium transition text-sm">
                      Ganti Semua
                    </button>
                    <button onClick={handleAddManualText} className="w-1/2 bg-green-600 hover:bg-green-700 py-2 rounded text-white font-medium transition text-sm">
                      Tambah Scene Baru
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Slides / Scenes</h3>
            {store.slides.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No slides available. Fetch Quran data first.</div>
            ) : (
              <div className="space-y-2">
                {store.slides.map((slide, idx) => {
                  const verse = store.verses[slide.verseIndex];
                  if (!verse) return null;
                  const totalWords = verse.words ? verse.words.length : 0;
                  const canSplit = useQuranApi && totalWords > 1 && (slide.wordEndIndex - slide.wordStartIndex > 1);
                  return (
                    <div 
                      key={slide.id} 
                      className={`p-2 rounded cursor-pointer transition ${store.activeSlideId === slide.id ? 'bg-primary/20 border border-primary' : 'bg-muted hover:bg-muted/80'}`} 
                      onClick={() => store.setActiveSlideId(slide.id)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="text-xs text-foreground font-semibold">Slide {idx + 1} (Ayah {verse.ayah})</div>
                        <button onClick={(e) => { e.stopPropagation(); store.removeSlide(slide.id); }} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {slide.type === 'tafsir' ? 'Tafsir Slide' : `Words: ${slide.wordStartIndex + 1} to ${slide.wordEndIndex} of ${totalWords}`}
                      </div>
                      
                      {slide.type === 'tafsir' && (
                        <div className="mt-2 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Duration (s)</span>
                            <input 
                              type="number" 
                              value={slide.slideDuration || 5} 
                              onChange={(e) => store.updateSlideDuration(slide.id, parseInt(e.target.value) || 5)}
                              className="w-16 p-1 text-xs bg-background border border-input rounded text-foreground"
                            />
                          </div>
                          {slide.customBgPath && (
                            <div className="text-[10px] text-green-400 truncate">🖼️ {slide.customBgPath.split(/[\\/]/).pop()}</div>
                          )}
                          {slide.audioPath && (
                            <div className="text-[10px] text-blue-400 truncate">🔊 {slide.audioPath.split(/[\\/]/).pop()}</div>
                          )}
                        </div>
                      )}

                      {canSplit && slide.type !== 'tafsir' && (
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            const mid = slide.wordStartIndex + Math.floor((slide.wordEndIndex - slide.wordStartIndex) / 2);
                            store.splitSlide(slide.id, mid); 
                          }} 
                          className="text-xs bg-card hover:bg-muted text-primary px-2 py-1 rounded mt-2 border border-input w-full"
                        >
                          Split in half
                        </button>
                      )}
                      
                      {store.activeSlideId === slide.id && store.customization.showTranslation && slide.type !== 'tafsir' && (
                        <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
                          <div className="text-[10px] font-semibold uppercase text-muted-foreground">Edit Slide Translation</div>
                          {store.customization.translationLanguage === 'id' ? (
                            <textarea
                              value={slide.translation || ''}
                              onChange={(e) => store.updateSlideTranslation(slide.id, 'id', e.target.value)}
                              className="w-full text-xs p-1 bg-background border border-input rounded"
                              rows={2}
                            />
                          ) : (
                            <textarea
                              value={slide.translation_en || ''}
                              onChange={(e) => store.updateSlideTranslation(slide.id, 'en', e.target.value)}
                              className="w-full text-xs p-1 bg-background border border-input rounded"
                              rows={2}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Assets & Thumbnail</h3>
            <div className="space-y-2">
              <button onClick={handleImportAudio} className="w-full bg-muted hover:bg-muted/80 py-2 rounded transition flex flex-col items-center justify-center p-2 text-sm">
                <span className="font-semibold text-foreground">Import Audio</span>
                {store.audioPath && <span className="text-xs text-muted-foreground mt-1 break-all px-2">{store.audioPath}</span>}
              </button>
              <button onClick={handleImportBackground} className="w-full bg-muted hover:bg-muted/80 py-2 rounded transition flex flex-col items-center justify-center p-2 text-sm">
                <span className="font-semibold text-foreground">Import Background</span>
                {store.bgPath && <span className="text-xs text-muted-foreground mt-1 break-all px-2">{store.bgPath}</span>}
              </button>
              <button onClick={() => setStockModalOpen(true)} className="w-full bg-muted hover:bg-muted/80 py-2 rounded transition flex flex-col items-center justify-center p-2 text-sm">
                <span className="font-semibold text-foreground">🌐 Fetch Background Online</span>
                <span className="text-xs text-muted-foreground mt-1">Pixabay / Pexels</span>
              </button>
              <button onClick={handleImportThumbnail} className="w-full bg-muted hover:bg-muted/80 py-2 rounded transition flex flex-col items-center justify-center p-2 text-sm">
                <span className="font-semibold text-foreground">Import Thumbnail</span>
                {store.customization.thumbnailPath && <span className="text-xs text-muted-foreground mt-1 break-all px-2">{store.customization.thumbnailPath}</span>}
              </button>
              
              <div className="pt-2 mt-2 border-t border-border">
                <h4 className="text-xs font-semibold mb-2">Generate Text Thumbnail</h4>
                <div className="space-y-2">
                  <input type="text" value={thumbnailTitle} onChange={e => setThumbnailTitle(e.target.value)} placeholder="Title (e.g. Surah Al-Baqarah)" className="w-full p-2 bg-background border border-input rounded text-foreground text-sm" />
                  <input type="text" value={thumbnailSubtitle} onChange={e => setThumbnailSubtitle(e.target.value)} placeholder="Subtitle (e.g. Mishary Rashid)" className="w-full p-2 bg-background border border-input rounded text-foreground text-sm" />
                  <button onClick={handleGenerateThumbnailText} disabled={generatingThumb} className="w-full bg-secondary hover:bg-secondary/80 py-2 rounded text-secondary-foreground text-sm transition">
                    {generatingThumb ? 'Generating...' : 'Generate & Save Thumbnail'}
                  </button>
                </div>
              </div>
            </div>
          </section>
          </>
          )}

          {activeTab === 'customize' && (
            <>
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Customize</h3>
            <div className="bg-muted p-4 rounded space-y-4">
              {/* Arabic Settings */}
              <div className="pt-2">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Arabic Text</h4>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Font</span>
                    <select 
                      value={store.customization.arabicFontFamily}
                      onChange={e => store.updateCustomization({ arabicFontFamily: e.target.value })}
                      className="bg-background border border-input rounded text-foreground text-xs p-1"
                    >
                      <option value="Uthmanic">Uthmanic (Hafs)</option>
                      <option value="LPMQ">LPMQ (Kemenag)</option>
                      <option value="amiri">Amiri</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Color</span>
                    <input type="color" value={store.customization.arabicColor} onChange={e => store.updateCustomization({ arabicColor: e.target.value })} className="w-full h-[26px] bg-transparent border-0 cursor-pointer rounded" />
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Size</span>
                  <span>{store.customization.arabicTextSize}%</span>
                </div>
                <input 
                  type="range" min="50" max="250" 
                  value={store.customization.arabicTextSize} 
                  onChange={e => store.updateCustomization({ arabicTextSize: parseInt(e.target.value) })}
                  className="w-full h-1"
                />
              </div>

              {/* Translation Settings */}
              <div className="pt-2 border-t border-input mt-2">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">Translation Text</h4>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={store.customization.showTranslation}
                      onChange={e => store.updateCustomization({ showTranslation: e.target.checked })}
                    />
                    <div className="w-7 h-4 bg-muted/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
                
                {store.customization.showTranslation && (
                  <>
                    <div className="flex flex-col gap-1 mb-2">
                      <span className="text-xs text-muted-foreground">Language</span>
                      <select 
                        value={store.customization.translationLanguage}
                        onChange={e => store.updateCustomization({ translationLanguage: e.target.value as 'id' | 'en' })}
                        className="bg-background border border-input rounded text-foreground text-xs p-1"
                      >
                        <option value="id">Indonesian (Kemenag)</option>
                        <option value="en">English (Saheeh Intl)</option>
                      </select>
                    </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Font</span>
                    <select 
                      value={store.customization.translationFontFamily}
                      onChange={e => store.updateCustomization({ translationFontFamily: e.target.value })}
                      className="bg-background border border-input rounded text-foreground text-xs p-1"
                    >
                      <option value="sans-serif">Sans Serif</option>
                      <option value="serif">Serif</option>
                      <option value="monospace">Monospace</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Color</span>
                    <input type="color" value={store.customization.translationColor} onChange={e => store.updateCustomization({ translationColor: e.target.value })} className="w-full h-[26px] bg-transparent border-0 cursor-pointer rounded" />
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Size</span>
                  <span>{store.customization.translationTextSize}%</span>
                </div>
                <input 
                  type="range" min="50" max="250" 
                  value={store.customization.translationTextSize} 
                  onChange={e => store.updateCustomization({ translationTextSize: parseInt(e.target.value) })}
                  className="w-full h-1"
                />
                
                <div className="flex flex-col gap-2 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Background Box</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={store.customization.translationBackground}
                        onChange={e => store.updateCustomization({ translationBackground: e.target.checked })}
                      />
                      <div className="w-7 h-4 bg-muted/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Show Separator</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={store.customization.showSeparator}
                        onChange={e => store.updateCustomization({ showSeparator: e.target.checked })}
                      />
                      <div className="w-7 h-4 bg-muted/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>
                </div>
                </>
              )}
              </div>

              {/* Position */}
              <div className="pt-2 border-t border-input mt-2">
                <div className="flex justify-between text-sm text-muted-foreground mb-1">
                  <span>Global Y Position</span>
                  <span>{store.customization.textPositionY}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" 
                  value={store.customization.textPositionY} 
                  onChange={e => store.updateCustomization({ textPositionY: parseInt(e.target.value) })}
                  className="w-full h-1"
                />
              </div>

              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-input">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Watermark</span>
                  <select 
                    value={store.customization.watermarkType}
                    onChange={e => store.updateCustomization({ watermarkType: e.target.value as any })}
                    className="bg-background border border-input rounded text-foreground text-xs px-2 py-1"
                  >
                    <option value="none">None</option>
                    <option value="text">Text</option>
                    <option value="image">Image (PNG)</option>
                  </select>
                </div>
                {store.customization.watermarkType === 'text' && (
                  <input 
                    type="text" 
                    value={store.customization.watermarkText} 
                    onChange={e => store.updateCustomization({ watermarkText: e.target.value })}
                    className="w-full bg-background border border-input rounded px-2 py-1 text-sm text-foreground"
                    placeholder="Enter watermark text"
                  />
                )}
                {store.customization.watermarkType === 'image' && (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={async () => {
                        const { open } = await import('@tauri-apps/plugin-dialog');
                        const selected = await open({ filters: [{ name: 'Image', extensions: ['png'] }], multiple: false });
                        if (selected && typeof selected === 'string') {
                          store.updateCustomization({ watermarkImage: selected });
                        }
                      }}
                      className="bg-muted hover:bg-muted/80 text-xs px-2 py-1 rounded text-foreground"
                    >
                      Browse Logo...
                    </button>
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {store.customization.watermarkImage ? store.customization.watermarkImage.split(/[\\/]/).pop() : 'No image selected'}
                    </span>
                  </div>
                )}
                
                {store.customization.watermarkType !== 'none' && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Watermark Y Pos</span>
                      <span>{store.customization.watermarkPositionY}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" 
                      value={store.customization.watermarkPositionY} 
                      onChange={e => store.updateCustomization({ watermarkPositionY: parseInt(e.target.value) })}
                      className="w-full h-1"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-input">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Video Orientation</span>
                  <select 
                    value={store.customization.videoOrientation}
                    onChange={e => store.updateCustomization({ videoOrientation: e.target.value as any })}
                    className="bg-background border border-input rounded text-foreground text-xs px-2 py-1"
                  >
                    <option value="vertical">Vertical (9:16)</option>
                    <option value="landscape">Landscape (16:9)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-input">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Render Duration</span>
                  <div className="flex gap-2">
                    <input 
                      type="number"
                      placeholder="Auto"
                      value={store.customization.videoDuration || ''}
                      onChange={e => store.updateCustomization({ videoDuration: e.target.value ? parseInt(e.target.value) : null })}
                      className="bg-background border border-input rounded text-foreground text-xs px-2 py-1 w-20"
                    />
                    <span className="text-xs text-muted-foreground self-center">sec</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-input">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Animation Style</span>
                  <select 
                    value={store.customization.animationStyle}
                    onChange={e => store.updateCustomization({ animationStyle: e.target.value as any })}
                    className="bg-background border border-input rounded text-foreground text-xs px-2 py-1"
                  >
                    <option value="none">None</option>
                    <option value="fade">Fade In/Out</option>
                  </select>
                </div>
                {store.customization.animationStyle === 'fade' && (
                  <div className="mt-1">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Fade Duration</span>
                      <span>{store.customization.fadeDuration.toFixed(1)}s</span>
                    </div>
                    <input 
                      type="range" min="0.3" max="2.0" step="0.1"
                      value={store.customization.fadeDuration} 
                      onChange={e => store.updateCustomization({ fadeDuration: parseFloat(e.target.value) })}
                      className="w-full h-1"
                    />
                    <div className="text-[10px] text-muted-foreground mt-1 italic">
                      Fade-in pada ayat pertama, fade-out pada ayat terakhir
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-2 pt-2 border-t border-input">
                <span className="text-sm text-muted-foreground">Karaoke Mode</span>
                <div className="flex items-center gap-4">
                  {store.customization.karaokeMode && (
                    <select 
                      value={store.customization.karaokeStyle}
                      onChange={e => store.updateCustomization({ karaokeStyle: e.target.value })}
                      className="bg-background border border-input rounded text-foreground text-xs px-2 py-1"
                    >
                      <option value="pop">Pop (Yellow)</option>
                      <option value="hormozi">Hormozi (Green)</option>
                      <option value="neon">Neon Glow</option>
                      <option value="punch">Word Punch</option>
                      <option value="tiktok">TikTok Bold</option>
                    </select>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={store.customization.karaokeMode}
                      onChange={e => store.updateCustomization({ karaokeMode: e.target.checked })}
                    />
                    <div className="w-9 h-5 bg-muted/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
              </div>
            </div>
          </section>
          </>
          )}

          {activeTab === 'templates' && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Template</h3>
            <select 
              value={store.selectedTemplate}
              onChange={e => store.setSelectedTemplate(e.target.value)}
              className="w-full p-2 bg-background border border-input rounded text-foreground"
            >
              <option value="default">Default (No Style)</option>
              <option value="minimal">Minimal</option>
              <option value="cinematic">Cinematic</option>
              <option value="clean">Clean</option>
            </select>
          </section>
          )}

          {activeTab === 'ai' && (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tafsir & AI Tools</h3>
            
            {!activeSlide ? (
              <div className="text-sm text-muted-foreground italic bg-muted p-3 rounded">
                Please select a slide from the 'Data' tab first to generate Tafsir or AI assets for it.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted p-3 rounded space-y-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Tafsir Source</label>
                    <select 
                      value={tafsirSourceId}
                      onChange={(e) => setTafsirSourceId(e.target.value)}
                      className="w-full p-2 bg-background border border-input rounded text-foreground text-sm"
                    >
                      <option value="169">Ibn Kathir (English)</option>
                      <option value="16">Tafsir Muyassar (Arabic)</option>
                      <option value="165">Tafsir Ahsanul Bayaan (Bengali)</option>
                      {/* Can add more from API later */}
                    </select>
                  </div>
                  
                  <button 
                    onClick={async () => {
                      if (!activeSlide) return;
                      const verse = store.verses[activeSlide.verseIndex];
                      if (!verse) return;
                      setIsFetchingTafsir(true);
                      try {
                        const text = await fetchTafsir(
                          verse.surah,
                          verse.ayah,
                          parseInt(tafsirSourceId)
                        );
                        setRawTafsir(text);
                      } catch (e) {
                        alert(`Failed to fetch tafsir: ${e}`);
                      } finally {
                        setIsFetchingTafsir(false);
                      }
                    }}
                    disabled={isFetchingTafsir || activeSlide.type === 'tafsir'}
                    className="w-full bg-secondary hover:bg-secondary/80 py-2 rounded text-secondary-foreground text-sm transition disabled:opacity-50"
                  >
                    {isFetchingTafsir ? 'Fetching...' : '1. Fetch Raw Tafsir'}
                  </button>
                  
                  {rawTafsir && (
                    <div className="text-[10px] text-muted-foreground max-h-24 overflow-y-auto bg-background p-2 rounded border border-border">
                      {rawTafsir}
                    </div>
                  )}
                </div>

                <div className="bg-muted p-3 rounded space-y-3">
                  <button 
                    onClick={async () => {
                      if (!rawTafsir) { alert('Fetch raw tafsir first'); return; }
                      setIsGeneratingSummary(true);
                      try {
                        const summary = await aiSummarizeTafsir(
                          rawTafsir,
                          store.customization.translationLanguage
                        );
                        setAiSummary(summary);
                      } catch (e) {
                        alert(`Failed to summarize: ${e}`);
                      } finally {
                        setIsGeneratingSummary(false);
                      }
                    }}
                    disabled={isGeneratingSummary || !rawTafsir}
                    className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded text-white text-sm transition disabled:opacity-50"
                  >
                    {isGeneratingSummary ? 'Summarizing...' : '2. Generate AI Summary'}
                  </button>
                  
                  {aiSummary && (
                    <>
                      <textarea
                        value={aiSummary}
                        onChange={(e) => setAiSummary(e.target.value)}
                        className="w-full p-2 bg-background border border-input rounded text-foreground text-sm"
                        rows={3}
                      />
                      <button 
                        onClick={() => {
                          const srcName = tafsirSourceId === '169' ? 'Ibn Kathir' : 'Tafsir';
                          store.insertTafsirSlide(activeSlide.id, aiSummary, srcName);
                          setAiSummary('');
                          setRawTafsir('');
                        }}
                        className="w-full bg-primary hover:bg-primary/90 py-2 rounded text-primary-foreground text-sm transition"
                      >
                        ➕ Insert as Tafsir Slide
                      </button>
                    </>
                  )}
                </div>

                <div className="border-t border-border pt-4 mt-2">
                  <h4 className="text-xs font-semibold mb-2">AI Media for Current Slide</h4>
                  <div className="space-y-2">
                    <button 
                      onClick={async () => {
                        const verse = store.verses[activeSlide.verseIndex];
                        const contextText = activeSlide.type === 'tafsir' 
                          ? activeSlide.tafsirText 
                          : (verse?.translation_en || verse?.translation || '');
                        
                        if (!contextText) { alert('No text available for this slide'); return; }
                        
                        setIsGeneratingImage(true);
                        try {
                          const imgPath = await aiGenerateImage(contextText);
                          store.updateSlideCustomBg(activeSlide.id, imgPath);
                        } catch (e) {
                          alert(`Image gen failed: ${e}`);
                        } finally {
                          setIsGeneratingImage(false);
                        }
                      }}
                      disabled={isGeneratingImage}
                      className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded text-white text-sm transition disabled:opacity-50"
                    >
                      {isGeneratingImage ? 'Generating...' : '🖼️ Generate AI Background'}
                    </button>
                    
                    {activeSlide.type === 'tafsir' && (
                      <button 
                        onClick={async () => {
                          if (!activeSlide.tafsirText) return;
                          setIsGeneratingAudio(true);
                          try {
                            const audioPath = await aiGenerateAudio(activeSlide.tafsirText);
                            store.updateSlideAudio(activeSlide.id, audioPath);
                          } catch (e) {
                            alert(`Audio gen failed: ${e}`);
                          } finally {
                            setIsGeneratingAudio(false);
                          }
                        }}
                        disabled={isGeneratingAudio}
                        className="w-full bg-teal-600 hover:bg-teal-700 py-2 rounded text-white text-sm transition disabled:opacity-50"
                      >
                        {isGeneratingAudio ? 'Generating...' : '🔊 Generate AI Voiceover'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
          )}
        </div>
      </div>

      {/* Right panel: Preview & Actions */}
      <div className="flex-1 bg-background flex flex-col p-4">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <h3 className="font-semibold text-muted-foreground hidden">Preview (1080x1920)</h3>
            <div className="flex items-center bg-card rounded overflow-hidden">
              <button 
                onClick={() => { (previewRef.current as any)?.playPreview?.(); }}
                className="px-3 py-1 hover:bg-muted text-sm font-medium transition border-r border-border text-green-400"
              >
                Play
              </button>
              <button 
                onClick={() => { (previewRef.current as any)?.pausePreview?.(); }}
                className="px-3 py-1 hover:bg-muted text-sm font-medium transition text-yellow-400"
              >
                Pause
              </button>
            </div>
          </div>
          <div className="space-x-2">
            <button onClick={() => store.clearProject()} className="bg-red-700 hover:bg-red-600 px-4 py-2 rounded transition text-white text-sm">Clear</button>
            <button onClick={async () => {
              try {
                const { saveProject } = await import('../utils/project');
                await saveProject();
                alert('Project saved successfully!');
              } catch (e) {
                alert('Failed to save project');
              }
            }} className="bg-muted hover:bg-muted/80 px-4 py-2 rounded transition text-foreground">Save</button>
            <button onClick={handleGenerate} disabled={loading} className="bg-primary hover:bg-primary/90 px-4 py-2 rounded transition font-medium text-primary-foreground disabled:opacity-50">
              {loading ? 'Processing...' : 'Add to Queue'}
            </button>
          </div>
        </div>
        <div className="flex-1 flex bg-black rounded-lg overflow-hidden border border-border p-4">
          <PreviewCanvas ref={previewRef} />
        </div>
      </div>

      {/* Hidden Slide Render Container */}
      <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -10, pointerEvents: 'none', opacity: 0 }}>
        {store.slides.map(slide => (
           <div id={`render-slide-${slide.id}`} key={`render-${slide.id}`} style={{ width: store.customization.videoOrientation === 'landscape' ? 1920 : 1080, height: store.customization.videoOrientation === 'landscape' ? 1080 : 1920 }}>
             <PreviewCanvas overrideSlideId={slide.id} isOffscreenRender={true} />
           </div>
        ))}
      </div>

      {/* Hidden Thumbnail Generator Container */}
      <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -10 }}>
        <div id="thumbnail-generator" className="relative flex flex-col items-center justify-center gap-6 overflow-hidden" style={{ width: '1080px', height: '1920px', background: 'radial-gradient(circle at center, #1a1a1a 0%, #000000 100%)' }}>
           {thumbnailBgPath && (
             <img src={convertFileSrc(thumbnailBgPath)} className="absolute inset-0 w-full h-full object-cover z-0" />
           )}
           <div className="z-10 flex flex-col items-center gap-6 px-16 py-12 bg-black/50 backdrop-blur-md rounded-3xl border border-white/10 shadow-2xl">
             <h1 className="text-white font-bold text-center" style={{ fontSize: '100px', lineHeight: '1.2', textShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>{thumbnailTitle}</h1>
             <p className="text-gray-300 font-semibold text-center" style={{ fontSize: '60px', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>{thumbnailSubtitle}</p>
           </div>
           </div>
        </div>
      </div>


      {/* Stock Background Fetch Modal */}
      {stockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setStockModalOpen(false)}>
          <div
            className="bg-card border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-card-foreground">Fetch Background Online</h3>
                <button onClick={() => setStockModalOpen(false)} className="text-muted-foreground hover:text-foreground text-lg px-2">✕</button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={stockQuery}
                  onChange={(e) => setStockQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchStock(); }}
                  placeholder="Search... (e.g. night sky, mosque, mountains)"
                  className="flex-1 p-2 bg-background border border-input rounded text-foreground text-sm"
                  autoFocus
                />
                <button onClick={handleSearchStock} disabled={isFetchingStock || !stockQuery.trim()} className="px-4 py-2 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm transition disabled:opacity-50">
                  {isFetchingStock ? 'Searching...' : 'Search'}
                </button>
              </div>
              <div className="flex gap-2">
                <select value={stockProvider} onChange={(e) => setStockProvider(e.target.value as 'pixabay' | 'pexels')} className="p-1.5 bg-background border border-input rounded text-foreground text-xs">
                  <option value="pixabay">Pixabay</option>
                  <option value="pexels">Pexels</option>
                </select>
                <div className="flex rounded overflow-hidden border border-input">
                  <button onClick={() => setStockType('image')} className={`px-3 py-1.5 text-xs ${stockType === 'image' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}>Photos</button>
                  <button onClick={() => setStockType('video')} className={`px-3 py-1.5 text-xs ${stockType === 'video' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}>Videos</button>
                </div>
                <span className="text-[10px] text-muted-foreground self-center ml-auto">API key di Settings → Stock Background APIs</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {stockError && <p className="text-sm text-destructive mb-2">{stockError}</p>}
              {isFetchingStock && <p className="text-sm text-muted-foreground">Searching...</p>}
              <div className="grid grid-cols-3 gap-3">
                {stockResults.map(item => (
                  <button
                    key={`${item.provider}-${item.id}`}
                    onClick={() => handlePickStock(item)}
                    disabled={isDownloadingStock}
                    className="relative group rounded border border-border overflow-hidden hover:border-primary transition disabled:opacity-50"
                  >
                    <img src={item.preview_url} alt={`by ${item.author}`} loading="lazy" className="w-full h-28 object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition">
                      <span>by {item.author}</span>
                      <span>{item.width}×{item.height}</span>
                    </div>
                    {item.duration != null && (
                      <span className="absolute top-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">{item.duration}s</span>
                    )}
                    {isDownloadingStock && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><span className="text-white text-xs">Downloading...</span></div>}
                  </button>
                ))}
              </div>
              {!isFetchingStock && stockResults.length === 0 && !stockError && (
                <p className="text-sm text-muted-foreground text-center mt-8">Type a query and press Search.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
