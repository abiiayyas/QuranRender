import { forwardRef, useRef, useImperativeHandle, useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { convertFileSrc } from '@tauri-apps/api/core';

export interface PreviewCanvasHandle extends HTMLDivElement {
  playPreview: () => void;
  pausePreview: () => void;
}

export interface PreviewCanvasProps {
  overrideSlideId?: string;
  isOffscreenRender?: boolean;
}

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(({ overrideSlideId, isOffscreenRender }, ref) => {
  const { verses, slides, activeSlideId, bgPath, audioPath, isExporting, selectedTemplate } = useAppStore();
  const customization = useAppStore(state => state.customization);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(isOffscreenRender ? 1 : 0.3);

  const baseW = customization.videoOrientation === 'landscape' ? 1920 : 1080;
  const baseH = customization.videoOrientation === 'landscape' ? 1080 : 1920;

  useEffect(() => {
    if (isOffscreenRender) return;
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        const scaleW = width / baseW;
        const scaleH = height / baseH;
        setScale(Math.max(0.1, Math.min(scaleW, scaleH)));
      }
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [baseW, baseH, isOffscreenRender]);

  const animationRef = useRef<number>(0);

  // Expose methods to parent
  useImperativeHandle(ref, () => {
    const el = containerRef.current as any;
    if (el) {
      el.playPreview = () => {
        if (videoRef.current) videoRef.current.play();
        if (audioRef.current) {
          // Sync audio to the global current time
          audioRef.current.currentTime = useAppStore.getState().globalCurrentTime;
          audioRef.current.play();
          
          const loop = () => {
            if (!audioRef.current || audioRef.current.paused) return;
            
            const timeMs = audioRef.current.currentTime * 1000;
            useAppStore.getState().setGlobalCurrentTime(audioRef.current.currentTime);
            
            if (customization.karaokeMode) {
                const state = useAppStore.getState();
                // We check globally against all verses, or just the active one?
                // For MVP, we check the active slide's verse.
                const verse = state.verses[activeSlide?.verseIndex || 0];
                if (verse && verse.words) {
                    const localWords = verse.words.slice(activeSlide?.wordStartIndex || 0, activeSlide?.wordEndIndex || verse.words.length);
                    const localIndex = localWords.findIndex(w => 
                      w.start_ms !== null && w.end_ms !== null && 
                      timeMs >= w.start_ms && timeMs <= w.end_ms
                    );
                    
                    const globalIndex = localIndex !== -1 && activeSlide ? activeSlide.wordStartIndex + localIndex : -1;
                    
                    if (globalIndex !== -1 && state.customization.highlightWordIndex !== globalIndex) {
                      state.updateCustomization({ highlightWordIndex: globalIndex });
                    } else if (globalIndex === -1 && state.customization.highlightWordIndex !== null) {
                      state.updateCustomization({ highlightWordIndex: null });
                    }
                }
            }
            animationRef.current = requestAnimationFrame(loop);
          };
          animationRef.current = requestAnimationFrame(loop);
        }
      };
      el.pausePreview = () => {
        if (videoRef.current) videoRef.current.pause();
        if (audioRef.current) {
          audioRef.current.pause();
          if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }
        if (customization.karaokeMode) {
          useAppStore.getState().updateCustomization({ highlightWordIndex: null });
        }
      };
    }
    return el;
  });
  
  const activeSlideIdToUse = overrideSlideId || activeSlideId;
  const activeSlide = slides.find(s => s.id === activeSlideIdToUse) || slides[0];
  const verse = activeSlide ? verses[activeSlide.verseIndex] : null;

  const displayWords = verse && verse.words ? verse.words.slice(activeSlide.wordStartIndex, activeSlide.wordEndIndex) : [];
  const displayArabic = (verse && verse.words && verse.words.length > 0) ? displayWords.map(w => w.arabic).join(' ') : (verse ? verse.arabic : '');
  
  const currentAudioPath = verse?.audioPath || audioPath;

  const fontMap: Record<string, string> = {
    'amiri': 'Amiri, serif',
    'Uthmanic': 'Uthmanic, serif',
    'LPMQ': 'LPMQ, serif',
    'sans-serif': 'sans-serif',
    'serif': 'serif',
    'monospace': 'monospace'
  };

  // Convert percentage slider to actual CSS values
  const arabicFontSizeFactor = customization.arabicTextSize / 100;
  const translationFontSizeFactor = customization.translationTextSize / 100;
  const arabicFontSize = `${5 * arabicFontSizeFactor}rem`; // base 5rem (was text-7xl)
  const transFontSize = `${2.25 * translationFontSizeFactor}rem`; // base 2.25rem (was text-4xl)

  // Map 0-100% to absolute top position
  const topPosition = `${customization.textPositionY}%`;

  // Detect background type

  // Template styles
  const getTemplateOverlayClass = () => {
    switch (selectedTemplate) {
      case 'cinematic':
        return 'bg-gradient-to-t from-black/80 via-black/30 to-transparent pb-32 pt-16';
      case 'clean':
        return 'bg-black/40 backdrop-blur-sm rounded-3xl p-8';
      case 'minimal':
      default:
        return '';
    }
  };

  const isFading = customization.animationStyle === 'fade' && !isExporting;

  // During export the render loop toggles `highlightWordIndex` thousands of
  // times to capture per-word karaoke frames. That global state also drives the
  // on-screen preview and would flash through every word, so ignore it for the
  // visible (non-offscreen) canvas — keep the preview on a stable frame while
  // the background render job runs. The offscreen canvases being captured are
  // the ones that actually need the highlights.
  const effectiveHighlightWordIndex = (!isOffscreenRender && isExporting)
    ? null
    : customization.highlightWordIndex;

  return (
    <div className="flex-1 w-full h-full min-h-0 relative overflow-hidden bg-black">
      <div ref={wrapperRef} className="absolute inset-0 flex justify-center items-center">
      <div className="relative flex-shrink-0 bg-zinc-900" style={{ width: `${baseW * scale}px`, height: `${baseH * scale}px` }}>
        <div 
          ref={containerRef}
          className="preview-canvas-container absolute top-0 left-0 flex flex-col items-center justify-center overflow-hidden"
          style={{
            width: `${baseW}px`,
            height: `${baseH}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
        {/* Background Layer - Hidden during export by html-to-image filter logic in Editor.tsx */}
        <div id="preview-bg-layer" className="absolute inset-0 w-full h-full object-cover -z-10">
          {(activeSlide?.customBgPath || bgPath) && (
            (activeSlide?.customBgPath || bgPath)?.toLowerCase().match(/\.(mp4|mov|webm)$/) ? (
              <video ref={videoRef} src={convertFileSrc((activeSlide?.customBgPath || bgPath) as string)} className="w-full h-full object-cover" loop muted playsInline />
            ) : (
              <img src={convertFileSrc((activeSlide?.customBgPath || bgPath) as string)} className="w-full h-full object-cover" />
            )
          )}
          {currentAudioPath && <audio ref={audioRef} src={convertFileSrc(currentAudioPath)} />}
        </div>

        {/* Logo Watermark Layer */}
        {customization.watermarkType !== 'none' && (
          <div 
            className="absolute left-0 right-0 flex justify-center opacity-80 z-20"
            style={{ top: `${customization.watermarkPositionY}%` }}
          >
            {customization.watermarkType === 'text' ? (
              <div className="text-white text-3xl font-bold drop-shadow-xl bg-black/30 px-6 py-2 rounded-xl border border-white/20">
                {customization.watermarkText}
              </div>
            ) : (
              customization.watermarkImage && (
                <img src={convertFileSrc(customization.watermarkImage)} alt="Watermark" className="h-24 drop-shadow-xl" />
              )
            )}
          </div>
        )}

        {/* Text Overlay Layer */}
        {verse && activeSlide?.type === 'tafsir' ? (
          <div 
            key={`${activeSlideId}-tafsir`}
            className={`absolute w-full px-16 flex flex-col items-center gap-6 ${getTemplateOverlayClass()} ${isFading ? 'animate-in fade-in duration-500' : ''}`}
            style={{ 
              top: '50%',
              transform: 'translateY(-50%)',
              textAlign: 'center'
            }}
          >
            <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-full border border-white/20 mb-4">
              <p className="text-white font-semibold text-2xl tracking-widest uppercase">
                {activeSlide.tafsirSource || 'Tafsir'}
              </p>
            </div>
            <div 
              className="bg-black/40 backdrop-blur-sm p-12 rounded-3xl border border-white/10"
              style={{
                color: customization.translationColor,
                fontFamily: fontMap[customization.translationFontFamily],
                fontSize: transFontSize,
                lineHeight: '1.6',
                textShadow: '0 4px 24px rgba(0,0,0,0.8)'
              }}
            >
              {activeSlide.tafsirText}
            </div>
          </div>
        ) : verse ? (
          <div 
            key={`${activeSlideId}-${customization.animationStyle}`}
            className={`absolute w-full px-16 flex flex-col items-center gap-12 ${getTemplateOverlayClass()} ${isFading ? 'animate-in fade-in duration-500' : ''}`}
            style={{ 
              top: topPosition,
              transform: 'translateY(-50%)',
              textAlign: 'center'
            }}
          >
            <p 
              dir="rtl" 
              className="font-bold leading-normal text-center w-full flex justify-center flex-wrap gap-x-4 py-4" 
              style={{ fontFamily: fontMap[customization.arabicFontFamily] || 'Uthmanic, serif', fontSize: arabicFontSize, textShadow: '0px 4px 12px rgba(0,0,0,0.8)' }}
            >
              {customization.karaokeMode && displayWords.length > 0 ? (
                displayWords.map((word, index) => {
                  const globalIndex = activeSlide ? activeSlide.wordStartIndex + index : index;
                  const isHighlighted = effectiveHighlightWordIndex === globalIndex;
                  let color = customization.arabicColor;
                  let backgroundColor = 'transparent';
                  let padding = '0';
                  let borderRadius = '0';
                  let textShadow = '0px 4px 12px rgba(0,0,0,0.8)';
                  let scale = 1;
                  let fontWeight = 'bold';

                  if (isHighlighted) {
                    if (customization.karaokeStyle === 'pop') {
                      color = '#FCD34D'; // Yellow
                    } else if (customization.karaokeStyle === 'hormozi') {
                      color = '#22c55e'; // Green
                    } else if (customization.karaokeStyle === 'neon') {
                      color = '#22d3ee'; // Cyan
                      textShadow = '0 0 10px #22d3ee, 0 0 20px #22d3ee, 0 0 30px #22d3ee';
                    } else if (customization.karaokeStyle === 'punch') {
                      color = '#000000'; // Black
                      backgroundColor = '#FCD34D'; // Yellow box
                      padding = '0 12px';
                      borderRadius = '8px';
                      scale = 1.05;
                    } else if (customization.karaokeStyle === 'tiktok') {
                      color = '#ef4444'; // Red
                      textShadow = '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000';
                    }
                  } else {
                    if (customization.karaokeStyle === 'neon') {
                      color = '#bae6fd'; // Light blue
                    } else if (customization.karaokeStyle === 'tiktok') {
                      textShadow = '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000';
                    }
                  }

                  return (
                    <span 
                      key={index} 
                      className={`inline-block ${customization.karaokeStyle === 'hormozi' ? 'uppercase' : ''}`}
                      style={{ 
                        color,
                        backgroundColor,
                        padding,
                        borderRadius,
                        textShadow,
                        transform: `scale(${scale})`,
                        fontWeight,
                        transition: isExporting ? 'none' : 'all 0.15s ease-in-out' 
                      }}
                    >
                      {word.arabic}
                    </span>
                  );
                })
              ) : (
                <span style={{ color: customization.arabicColor }}>{displayArabic}</span>
              )}
            </p>
            {customization.showSeparator && (
              <div className="w-16 h-1 bg-yellow-500/80 rounded-full" />
            )}

            {customization.showTranslation && (
              <div 
                className={`text-center px-8 p-4 rounded-xl max-w-[90%] ${customization.translationBackground ? 'bg-black/60' : ''}`}
                style={{ 
                  fontSize: transFontSize,
                  fontFamily: fontMap[customization.translationFontFamily] || 'sans-serif',
                  color: customization.translationColor
                }}
              >
                {customization.translationLanguage === 'en' 
                  ? (activeSlide?.translation_en || verse?.translation_en)
                  : (activeSlide?.translation || verse?.translation)}
              </div>
            )}
          </div>
        ) : (
          <div className="text-gray-400 text-5xl font-bold bg-black/50 p-8 rounded-xl z-10">
            No Verse Selected
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
});
