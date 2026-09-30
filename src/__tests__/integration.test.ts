import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store';

describe('Project Integration Test', () => {
  beforeEach(() => {
    useAppStore.getState().clearProject();
  });

  it('should fetch ayah, create slide, save state, and undo', () => {
    const store = useAppStore.getState();

    // 1. Fetch Ayah (mocking the result)
    const mockVerse = {
      surah: 1,
      ayah: 1,
      arabic: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      translation: 'Dengan nama Allah Yang Maha Pengasih, Maha Penyayang',
      words: []
    };
    
    // Simulate setting verses which automatically creates slides
    store.setVerses([mockVerse]);

    const stateAfterFetch = useAppStore.getState();
    expect(stateAfterFetch.verses.length).toBe(1);
    expect(stateAfterFetch.slides.length).toBe(1);
    expect(stateAfterFetch.slides[0].translation).toBe('Dengan nama Allah Yang Maha Pengasih, Maha Penyayang');

    // 2. Commit state (State A)
    stateAfterFetch.commitHistory();

    // 3. Modify something and commit (State B)
    stateAfterFetch.updateSlideTranslation(stateAfterFetch.slides[0].id, 'id', 'Bismillah');
    
    const stateAfterMod = useAppStore.getState();
    expect(stateAfterMod.slides[0].translation).toBe('Bismillah');
    stateAfterMod.commitHistory();

    // 4. Undo (Back to State A)
    stateAfterMod.undo();

    const stateAfterUndo = useAppStore.getState();
    expect(stateAfterUndo.slides[0].translation).toBe('Dengan nama Allah Yang Maha Pengasih, Maha Penyayang');
  });
});
