import { Composition, type CalculateMetadataFunction } from 'remotion'
import { DEFAULT_STYLE } from '../shared/style'
import { COMPOSITION_ID, canvasSize, type VideoProps } from '../shared/video'
import { QuranVideo } from './QuranVideo'

// Remotion wants props as a plain record type; VideoProps is an interface.
type Props = VideoProps & Record<string, unknown>

const Video = (p: Props) => <QuranVideo {...p} />

/** Size, fps and length come from the props, so one composition serves every aspect, resolution and recording. */
const metadata: CalculateMetadataFunction<Props> = ({ props }) => ({
  width: props.width,
  height: props.height,
  fps: props.fps,
  durationInFrames: Math.max(1, Math.ceil((props.durationMs * props.fps) / 1000))
})

const size = canvasSize('9:16', 1080)

/** Only for Remotion Studio; real renders always pass input props. */
const defaultProps: Props = {
  project: {
    id: 'contoh',
    title: 'Contoh',
    step: 4,
    status: 'editing',
    aspect: '9:16',
    surah: null,
    ayahFrom: null,
    ayahTo: null,
    reciter: '',
    script: 'kemenag',
    editions: [],
    sourceAssetId: null,
    segments: [],
    style: DEFAULT_STYLE,
    background: { kind: 'color', color: '#101114', assetId: null, dim: 0, blur: 0 },
    overlays: [],
    createdAt: 0,
    updatedAt: 0
  },
  assets: {},
  verses: {},
  surah: null,
  ...size,
  fps: 30,
  durationMs: 5000,
  baseUrl: { asset: '', font: '' }
}

export const Root = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Video}
    width={size.width}
    height={size.height}
    fps={30}
    durationInFrames={150}
    defaultProps={defaultProps}
    calculateMetadata={metadata}
  />
)
