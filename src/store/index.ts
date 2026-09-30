import { create } from 'zustand';
import { ProjectDocument, ProjectHistoryManager, migrateToProjectDocument } from './project';

const historyManager = new ProjectHistoryManager();

export interface QuranAyah {
  surah: number;
  ayah: number;
  arabic: string;
  translation: string;
  translation_en?: string;
  words: {
    position: number;
    arabic: string;
    start_ms: number | null;
    end_ms: number | null;
  }[];
  audioPath?: string | null;
  audioDurationMs?: number;
}

export interface BatchJob {
  id: string;
  projectDocument: any;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  error?: string;
  outputPath: string;
}

export interface Slide {
  id: string;
  verseIndex: number;
  wordStartIndex: number;
  wordEndIndex: number;
  translation?: string;
  translation_en?: string;
  type?: 'quran' | 'tafsir';
  tafsirText?: string;
  tafsirSource?: string;
  customBgPath?: string | null;
  audioPath?: string | null;
  slideDuration?: number;
}

interface AppState {
  currentProject: ProjectDocument | null;
  setCurrentProject: (project: ProjectDocument) => void;
  isExporting: boolean;
  setIsExporting: (isExporting: boolean) => void;
  
  renderQueue: any[];
  setRenderQueue: (queue: any[]) => void;
  updateRenderJob: (job: any) => void;

  
  audioPath: string | null;
  setAudioPath: (path: string | null) => void;
  bgPath: string | null;
  setBgPath: (path: string | null) => void;
  
  verses: QuranAyah[];
  setVerses: (verses: QuranAyah[]) => void;
  updateVerseAudio: (index: number, path: string, durationMs?: number) => void;
  
  slides: Slide[];
  setSlides: (slides: Slide[]) => void;
  updateSlideTranslation: (slideId: string, lang: 'id' | 'en', text: string) => void;
  splitSlide: (slideId: string, wordIndex: number) => void;
  removeSlide: (slideId: string) => void;
  insertTafsirSlide: (afterSlideId: string, tafsirText: string, source: string) => void;
  updateSlideCustomBg: (slideId: string, path: string | null) => void;
  updateSlideDuration: (slideId: string, seconds: number) => void;
  updateSlideAudio: (slideId: string, path: string | null) => void;
  activeSlideId: string | null;
  setActiveSlideId: (id: string | null) => void;
  
  globalCurrentTime: number;
  setGlobalCurrentTime: (time: number) => void;
  updateWordTiming: (verseIndex: number, wordIndex: number, start_ms: number, end_ms: number) => void;
  
  selectedTemplate: string;
  setSelectedTemplate: (template: string) => void;

  settings: {
    font: string;
    outputDir: string;
    theme: string;
  };
  updateSettings: (newSettings: Partial<AppState['settings']>) => void;

  customization: {
    arabicTextSize: number;
    arabicFontFamily: string;
    arabicColor: string;
    translationTextSize: number;
    translationFontFamily: string;
    translationColor: string;
    translationBackground: boolean;
    showTranslation: boolean;
    translationLanguage: 'id' | 'en';
    showSeparator: boolean;
    textPositionY: number;
    karaokeMode: boolean;
    karaokeStyle: string;
    thumbnailPath: string | null;
    highlightWordIndex: number | null;
    watermarkType: 'none' | 'text' | 'image';
    watermarkText: string;
    watermarkImage: string | null;
    watermarkPositionY: number;
    animationStyle: 'none' | 'fade';
    fadeDuration: number;
    videoOrientation: 'vertical' | 'landscape';
    videoDuration: number | null;
  };
  updateCustomization: (newCust: Partial<AppState['customization']>) => void;
  clearProject: () => void;
  addVerse: (verse: QuranAyah) => void;
  
  commitHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  batchQueue: BatchJob[];
  addBatchJob: (job: BatchJob) => void;
  updateBatchJob: (id: string, updates: Partial<BatchJob>) => void;
  removeBatchJob: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  canUndo: false,
  canRedo: false,
  commitHistory: () => set((state) => {
    const doc = migrateToProjectDocument(state);
    historyManager.pushState(doc);
    return { currentProject: doc, canUndo: historyManager.canUndo(), canRedo: historyManager.canRedo() };
  }),
  undo: () => set((state) => {
    const prevDoc = historyManager.undo();
    if (prevDoc) {
      return {
        currentProject: prevDoc,
        verses: prevDoc.verses,
        slides: prevDoc.slides,
        customization: prevDoc.customization,
        audioPath: prevDoc.assets.audioPath,
        bgPath: prevDoc.assets.bgPath,
        canUndo: historyManager.canUndo(),
        canRedo: historyManager.canRedo()
      };
    }
    return state;
  }),
  redo: () => set((state) => {
    const nextDoc = historyManager.redo();
    if (nextDoc) {
      return {
        currentProject: nextDoc,
        verses: nextDoc.verses,
        slides: nextDoc.slides,
        customization: nextDoc.customization,
        audioPath: nextDoc.assets.audioPath,
        bgPath: nextDoc.assets.bgPath,
        canUndo: historyManager.canUndo(),
        canRedo: historyManager.canRedo()
      };
    }
    return state;
  }),
  isExporting: false,
  setIsExporting: (isExporting) => set({ isExporting }),
  currentProject: null,
  setCurrentProject: (project) => set({ currentProject: project }),
  renderQueue: [],
  setRenderQueue: (queue) => set({ renderQueue: queue }),
  updateRenderJob: (updatedJob) => set((state) => {
    const existingIdx = state.renderQueue.findIndex(j => j.id === updatedJob.job_id);
    if (existingIdx !== -1) {
      const newQ = [...state.renderQueue];
      newQ[existingIdx] = { ...newQ[existingIdx], status: updatedJob.status, progress: updatedJob.progress, error: updatedJob.error };
      return { renderQueue: newQ };
    } else {
      return { renderQueue: [...state.renderQueue, {
        id: updatedJob.job_id,
        title: `Job ${updatedJob.job_id}`,
        status: updatedJob.status,
        progress: updatedJob.progress,
        error: updatedJob.error,
        jobData: updatedJob.jobData // Added job data for pending queue
      }] };
    }
  }),
  
  audioPath: null,
  setAudioPath: (path) => set({ audioPath: path }),
  bgPath: null,
  setBgPath: (path) => set({ bgPath: path }),
  
  verses: [],
  setVerses: (verses) => {
    const slides = verses.map((v, i) => ({
      id: `slide_${i}_${Date.now()}`,
      verseIndex: i,
      wordStartIndex: 0,
      wordEndIndex: v.words ? v.words.length : 0,
      translation: v.translation,
      translation_en: v.translation_en,
      type: 'quran' as const
    }));
    set({ verses, slides });
  },
  addVerse: (verse) => set((state) => {
    const newVerses = [...state.verses, verse];
    const newSlide = {
      id: `slide_${state.verses.length}_${Date.now()}`,
      verseIndex: state.verses.length,
      wordStartIndex: 0,
      wordEndIndex: verse.words ? verse.words.length : 0,
      translation: verse.translation,
      translation_en: verse.translation_en,
      type: 'quran' as const
    };
    return { verses: newVerses, slides: [...state.slides, newSlide] };
  }),
  updateVerseAudio: (index, path, durationMs) => set((state) => {
    const newVerses = [...state.verses];
    if (newVerses[index]) {
      newVerses[index].audioPath = path;
      newVerses[index].audioDurationMs = durationMs;
    }
    return { verses: newVerses };
  }),
  
  globalCurrentTime: 0,
  setGlobalCurrentTime: (time) => set({ globalCurrentTime: time }),
  
  updateWordTiming: (verseIndex, wordIndex, start_ms, end_ms) => set((state) => {
    const newVerses = [...state.verses];
    if (newVerses[verseIndex] && newVerses[verseIndex].words[wordIndex]) {
       newVerses[verseIndex].words[wordIndex].start_ms = start_ms;
       newVerses[verseIndex].words[wordIndex].end_ms = end_ms;
    }
    return { verses: newVerses };
  }),
  
  slides: [],
  setSlides: (slides) => set({ slides }),
  updateSlideTranslation: (slideId, lang, text) => set((state) => {
    const idx = state.slides.findIndex(s => s.id === slideId);
    if (idx === -1) return state;
    const newSlides = [...state.slides];
    if (lang === 'id') {
      newSlides[idx].translation = text;
    } else {
      newSlides[idx].translation_en = text;
    }
    return { slides: newSlides };
  }),
  splitSlide: (slideId, wordIndex) => set((state) => {
    const idx = state.slides.findIndex(s => s.id === slideId);
    if (idx === -1) return state;
    const slide = state.slides[idx];
    if (slide.type === 'tafsir') return state;
    if (wordIndex <= slide.wordStartIndex || wordIndex >= slide.wordEndIndex) return state;
    
    const newSlides = [...state.slides];
    
    const splitText = (text?: string) => {
      if (!text) return ['', ''];
      const words = text.split(' ');
      const mid = Math.floor(words.length / 2);
      return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
    };
    
    const [transA, transB] = splitText(slide.translation);
    const [transEnA, transEnB] = splitText(slide.translation_en);

    newSlides.splice(idx, 1, 
      { ...slide, id: `${slide.id}_a`, wordEndIndex: wordIndex, translation: transA, translation_en: transEnA },
      { ...slide, id: `${slide.id}_b`, wordStartIndex: wordIndex, translation: transB, translation_en: transEnB }
    );
    return { slides: newSlides };
  }),
  removeSlide: (slideId) => set((state) => ({
    slides: state.slides.filter(s => s.id !== slideId)
  })),
  insertTafsirSlide: (afterSlideId, tafsirText, source) => set((state) => {
    const idx = state.slides.findIndex(s => s.id === afterSlideId);
    if (idx === -1) return state;
    
    const afterSlide = state.slides[idx];
    const newSlide: Slide = {
      id: `tafsir_${afterSlide.verseIndex}_${Date.now()}`,
      verseIndex: afterSlide.verseIndex,
      wordStartIndex: 0,
      wordEndIndex: 0,
      type: 'tafsir',
      tafsirText,
      tafsirSource: source,
      slideDuration: 5,
    };
    
    const newSlides = [...state.slides];
    newSlides.splice(idx + 1, 0, newSlide);
    return { slides: newSlides };
  }),
  updateSlideCustomBg: (slideId, path) => set((state) => ({
    slides: state.slides.map(s => s.id === slideId ? { ...s, customBgPath: path } : s)
  })),
  updateSlideDuration: (slideId, seconds) => set((state) => ({
    slides: state.slides.map(s => s.id === slideId ? { ...s, slideDuration: seconds } : s)
  })),
  updateSlideAudio: (slideId, path) => set((state) => ({
    slides: state.slides.map(s => s.id === slideId ? { ...s, audioPath: path } : s)
  })),
  activeSlideId: null,
  setActiveSlideId: (id) => set({ activeSlideId: id }),
  
  selectedTemplate: 'cinematic',
  setSelectedTemplate: (template) => set({ selectedTemplate: template }),

  settings: {
    font: 'amiri',
    outputDir: '/Users/user/Downloads',
    theme: 'dark'
  },
  updateSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings }
  })),

  customization: {
    arabicTextSize: 100,
    arabicFontFamily: 'Uthmanic',
    arabicColor: '#ffffff',
    translationTextSize: 100,
    translationFontFamily: 'sans-serif',
    translationColor: '#ffffff',
    translationBackground: true,
    showTranslation: true,
    translationLanguage: 'id',
    showSeparator: false,
    textPositionY: 50, // percentage (50 = center)
    karaokeMode: false,
    karaokeStyle: 'pop',
    thumbnailPath: null,
    highlightWordIndex: null,
    watermarkType: 'none',
    watermarkText: 'Quran Render',
    watermarkImage: null,
    watermarkPositionY: 12,
    animationStyle: 'none',
    fadeDuration: 0.5,
    videoOrientation: 'vertical',
    videoDuration: null,
  },
  updateCustomization: (newCust) => set((state) => ({
    customization: { ...state.customization, ...newCust }
  })),
  clearProject: () => set({
    audioPath: null,
    bgPath: null,
    verses: [],
    slides: [],
    activeSlideId: null,
    customization: {
      arabicTextSize: 100,
      arabicFontFamily: 'Uthmanic',
      arabicColor: '#ffffff',
      translationTextSize: 100,
      translationFontFamily: 'sans-serif',
      translationColor: '#ffffff',
      translationBackground: true,
      showTranslation: true,
      translationLanguage: 'id',
      showSeparator: false,
      textPositionY: 50,
      karaokeMode: false,
      karaokeStyle: 'pop',
      thumbnailPath: null,
      highlightWordIndex: null,
      watermarkType: 'none',
      watermarkText: 'Quran Render',
      watermarkImage: null,
      watermarkPositionY: 12,
      animationStyle: 'none',
      fadeDuration: 0.5,
      videoOrientation: 'vertical',
      videoDuration: null,
    }
  }),
  
  batchQueue: [],
  addBatchJob: (job) => set((state) => ({ batchQueue: [...state.batchQueue, job] })),
  updateBatchJob: (id, updates) => set((state) => ({
    batchQueue: state.batchQueue.map(j => j.id === id ? { ...j, ...updates } : j)
  })),
  removeBatchJob: (id) => set((state) => ({
    batchQueue: state.batchQueue.filter(j => j.id !== id)
  })),
}));
