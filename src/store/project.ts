import { QuranAyah, Slide } from './index';

export interface ProjectDocument {
  version: number;
  id: string;
  metadata: {
    title: string;
    createdAt: number;
    updatedAt: number;
  };
  assets: {
    audioPath: string | null;
    bgPath: string | null;
  };
  verses: QuranAyah[];
  slides: Slide[];
  customization: any;
}

export function migrateToProjectDocument(state: any): ProjectDocument {
  return {
    version: 1,
    id: `proj_${Date.now()}`,
    metadata: {
      title: 'Untitled Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    assets: {
      audioPath: state.audioPath || null,
      bgPath: state.bgPath || null,
    },
    verses: state.verses || [],
    slides: state.slides || [],
    customization: state.customization || {},
  };
}

export class ProjectHistoryManager {
  private history: string[] = []; // store JSON string to deep copy
  private currentIndex: number = -1;

  public pushState(doc: ProjectDocument) {
    // truncate future history if we are in the middle of undo stack
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    this.history.push(JSON.stringify(doc));
    this.currentIndex++;
  }

  public undo(): ProjectDocument | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return JSON.parse(this.history[this.currentIndex]);
    }
    return null;
  }

  public redo(): ProjectDocument | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return JSON.parse(this.history[this.currentIndex]);
    }
    return null;
  }
  
  public canUndo() {
    return this.currentIndex > 0;
  }

  public canRedo() {
    return this.currentIndex < this.history.length - 1;
  }
}
