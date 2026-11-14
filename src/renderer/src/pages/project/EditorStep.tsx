import { useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { msg, t } from '@shared/i18n'
import { SAFE_AREA } from '@video/common'
import { QuranVideo } from '@video/QuranVideo'
import { Icon } from '../../components/ui'
import { useVideoProps } from '../../lib/videoProps'
import { useProject } from '../../store/project'
import { AudioPanel } from './editor/AudioPanel'
import { BackgroundPanel } from './editor/BackgroundPanel'
import { EditorTimeline } from './editor/EditorTimeline'
import { FormatPanel } from './editor/FormatPanel'
import { OverlayPanel } from './editor/OverlayPanel'
import { StylePanel } from './editor/StylePanel'

const FPS = 30
type Tab = 'gaya' | 'latar' | 'overlay' | 'audio' | 'format'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'gaya', label: msg('Gaya'), icon: 'type' },
  { id: 'latar', label: msg('Latar'), icon: 'image' },
  { id: 'overlay', label: msg('Overlay'), icon: 'layers' },
  { id: 'audio', label: msg('Audio'), icon: 'volume-2' },
  { id: 'format', label: msg('Format'), icon: 'frame' }
]

export function EditorStep() {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const canUndo = useProject((s) => s.canUndo)
  const canRedo = useProject((s) => s.canRedo)
  const props = useVideoProps(project, assets, FPS)
  const playerRef = useRef<PlayerRef | null>(null)
  const [tab, setTab] = useState<Tab>('gaya')
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [guides, setGuides] = useState(false)

  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const frames = Math.max(1, Math.ceil((props.durationMs * FPS) / 1000))
  const safe = SAFE_AREA[project.aspect]
  const ratio = props.width / props.height

  return (
    <div className="ed-layout">
      <nav className="ed-rail" aria-label={t('Alat editor')}>
        {TABS.map((item) => (
          <button key={item.id} type="button" className="ed-rail__btn" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>
            <Icon name={item.icon} />
            <span>{t(item.label)}</span>
          </button>
        ))}
      </nav>
      <aside className="ed-panel" aria-label={t('Pengaturan')}>
        {tab === 'gaya' && <StylePanel />}
        {tab === 'latar' && <BackgroundPanel />}
        {tab === 'overlay' && <OverlayPanel selectedId={overlayId} onSelect={setOverlayId} durationMs={props.durationMs} />}
        {tab === 'audio' && <AudioPanel />}
        {tab === 'format' && <FormatPanel guides={guides} onGuides={setGuides} />}
      </aside>
      <main className="ed-stage" aria-label={t('Pratinjau')}>
        <div className="ed-stage__bar">
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={!canUndo} onClick={() => useProject.getState().undo()}>
            <Icon name="rotate-ccw" size="sm" />
            {t('Urungkan')}
          </button>
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={!canRedo} onClick={() => useProject.getState().redo()}>
            {t('Ulangi')}
          </button>
        </div>
        <div className="ed-stage__view">
          <div className="ed-stage__frame" style={{ aspectRatio: `${props.width} / ${props.height}`, '--ratio': ratio } as React.CSSProperties}>
            <Player
              ref={playerRef}
              component={QuranVideo as never}
              inputProps={props as never}
              durationInFrames={frames}
              compositionWidth={props.width}
              compositionHeight={props.height}
              fps={FPS}
              controls
              clickToPlay
              acknowledgeRemotionLicense
              style={{ width: '100%', height: '100%' }}
            />
            {guides && (
              <div
                className="ed-guide"
                aria-hidden="true"
                style={{ top: `${safe.top * 100}%`, bottom: `${safe.bottom * 100}%`, left: `${safe.side * 100}%`, right: `${safe.side * 100}%` }}
              />
            )}
          </div>
        </div>
      </main>
      <section className="ed-timeline" aria-label={t('Linimasa')}>
        <EditorTimeline
          project={project}
          source={source}
          verses={props.verses}
          durationMs={props.durationMs}
          fps={FPS}
          playerRef={playerRef}
          selectedOverlay={overlayId}
          onSelectOverlay={(id) => {
            setOverlayId(id)
            setTab('overlay')
          }}
        />
      </section>
    </div>
  )
}
