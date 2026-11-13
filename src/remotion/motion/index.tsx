import type { MotionSpec } from '../../shared/motion'
import { Aurora } from './Aurora'
import { Geometry } from './Geometry'
import { Particles } from './Particles'
import { Rays } from './Rays'
import { Waves } from './Waves'

/** Animated background drawn from the frame number alone (SVG gradients and transforms, bounded element counts). */
export function MotionBackground({ spec, width, height, frame, fps }: { spec: MotionSpec; width: number; height: number; frame: number; fps: number }) {
  const speed = Math.min(2, Math.max(0.25, spec.speed))
  const p = { a: spec.colorA, b: spec.colorB, width, height, t: (frame / fps) * speed }
  switch (spec.type) {
    case 'geometry':
      return <Geometry {...p} />
    case 'particles':
      return <Particles {...p} />
    case 'rays':
      return <Rays {...p} />
    case 'waves':
      return <Waves {...p} />
    default:
      return <Aurora {...p} />
  }
}
