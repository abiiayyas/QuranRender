import { useCallback, useEffect, useRef, useState } from 'react'

export interface AudioPlayer {
  /** Current position, ms. Updates every animation frame while playing. */
  t: number
  playing: boolean
  durationMs: number
  play(): void
  pause(): void
  toggle(): void
  seek(ms: number): void
  /** Plays [fromMs, toMs) once, then pauses (review a segment or a cut). */
  playRange(fromMs: number, toMs: number): void
}

/** One <audio> element for a project asset URL. Playback rate keeps pitch (preservesPitch is the default). */
export function useAudio(url: string | null): AudioPlayer {
  const el = useRef<HTMLAudioElement | null>(null)
  const stopAt = useRef<number | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [durationMs, setDuration] = useState(0)

  useEffect(() => {
    if (!url) return
    const a = new Audio(url)
    a.preload = 'auto'
    el.current = a
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration * 1000 : 0)
    const onEnd = () => setPlaying(false)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    return () => {
      a.pause()
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
      a.src = ''
      el.current = null
      setPlaying(false)
    }
  }, [url])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = el.current
      if (a) {
        const now = a.currentTime * 1000
        if (stopAt.current != null && now >= stopAt.current) {
          a.pause()
          stopAt.current = null
          setPlaying(false)
        }
        setT(now)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const play = useCallback(() => {
    const a = el.current
    if (!a) return
    void a.play().then(() => setPlaying(true), () => setPlaying(false))
  }, [])
  const pause = useCallback(() => {
    el.current?.pause()
    stopAt.current = null
    setPlaying(false)
  }, [])
  const seek = useCallback((ms: number) => {
    const a = el.current
    const v = Math.max(0, ms)
    if (a) a.currentTime = v / 1000
    setT(v)
  }, [])
  const toggle = useCallback(() => (el.current && !el.current.paused ? pause() : play()), [play, pause])
  const playRange = useCallback(
    (fromMs: number, toMs: number) => {
      seek(fromMs)
      stopAt.current = toMs
      play()
    },
    [seek, play]
  )

  return { t, playing, durationMs, play, pause, toggle, seek, playRange }
}
