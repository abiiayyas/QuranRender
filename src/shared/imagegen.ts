import type { Aspect } from './types'

export interface ImageRequest {
  /** What the user typed; may be empty when a theme is chosen. */
  prompt: string
  /** One of IMAGE_THEMES (src/shared/imageThemes.ts); null = prompt only. */
  themeId: string | null
  aspect: Aspect
}
