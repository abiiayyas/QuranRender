import { Audio } from 'remotion'
import { ambientFade, ambientGain } from '../shared/ambient'
import type { VideoProps } from '../shared/video'

/**
 * The bundled nature sound under the recitation, looped for the whole video. Its volume is a pure function of the frame
 * (fade in and out), so the preview and the export are the same; the level itself was settled by `ambientOffsetDb`, the
 * measured gap between the reciter and the file.
 */
export function AmbientTrack({ props }: { props: VideoProps }) {
  const { project, baseUrl, fps, durationMs, ambientOffsetDb } = props
  const a = project.ambient
  if (!a || ambientOffsetDb == null) return null
  // The file is measured as 0 dB; `ambientGain` gets the voice at the offset above it.
  const base = ambientGain(ambientOffsetDb, 0, a.levelDb)
  return (
    <Audio
      // The preview (studio://) and the export (http) both serve bundled sounds beside the project files.
      src={`${baseUrl.asset.replace(/asset\/$/, '')}ambient/${a.id}.m4a`}
      loop
      // Without this the frame given to `volume` starts again at every loop, and the fade-in would repeat every 2 minutes.
      loopVolumeCurveBehavior="extend"
      volume={(frame) => base * ambientFade((frame / fps) * 1000, durationMs, a.fadeMs)}
    />
  )
}
