import { ornamentShapes } from '../shared/separator'

const FADE_ID = 'qr-separator-fade'

/** The hairline-and-ornament divider between ayah and translation; `width` x `height` is exactly the room it was given. */
export function Separator({ width, height, color }: { width: number; height: number; color: string }) {
  const { lines, thickness, y, polygons } = ornamentShapes(width, height)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', flex: 'none' }} aria-hidden>
      <defs>
        {/* The line thins out toward both ends, so it does not stop with a hard edge at the text margins. */}
        <linearGradient id={FADE_ID} gradientUnits="userSpaceOnUse" x1={0} x2={width} y1={0} y2={0}>
          <stop offset="0" stopColor={color} stopOpacity={0} />
          <stop offset="0.14" stopColor={color} stopOpacity={1} />
          <stop offset="0.86" stopColor={color} stopOpacity={1} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {lines.map(([x0, x1], i) => (
        <rect key={i} x={x0} y={y - thickness / 2} width={Math.max(0, x1 - x0)} height={thickness} fill={`url(#${FADE_ID})`} />
      ))}
      {polygons.map((points, i) => (
        <polygon key={i} points={points} fill={color} />
      ))}
    </svg>
  )
}
