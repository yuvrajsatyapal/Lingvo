import { useCurrentFrame } from 'remotion'
import { clamp, ease } from './motion'
import { interpolate } from 'remotion'

// macOS-style arrow. Coordinates are in world space so it rides with the camera.
export function Cursor(props: { from: { x: number; y: number }; to: { x: number; y: number }; appear: number; arrive: number; click: number; leave: number }) {
  const frame = useCurrentFrame()
  if (frame < props.appear || frame > props.leave + 10) return null
  const t = ease(frame, props.appear, props.arrive)
  const x = props.from.x + (props.to.x - props.from.x) * t
  // Slight arc so the path doesn't feel robotic.
  const y = props.from.y + (props.to.y - props.from.y) * t - Math.sin(t * Math.PI) * 40
  const press = frame >= props.click - 2 && frame < props.click + 4 ? 0.85 : 1
  const opacity = interpolate(frame, [props.appear, props.appear + 6, props.leave, props.leave + 10], [0, 1, 1, 0], clamp)
  const ring = interpolate(frame, [props.click, props.click + 16], [0, 1], clamp)

  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity, zIndex: 30, pointerEvents: 'none' }}>
      {frame >= props.click && ring < 1 && (
        <span style={{
          position: 'absolute', left: -30, top: -30, width: 60, height: 60, borderRadius: '50%', border: '3px solid #f5f5f2',
          opacity: 1 - ring, transform: `scale(${0.4 + ring})`,
        }} />
      )}
      <svg width={34} height={46} viewBox="0 0 17 23" style={{ transform: `scale(${press})`, transformOrigin: '2px 2px' }}>
        <path d="M1.5 1.5v17.2l4.3-4.1 2.7 6.4 3-1.3-2.7-6.3h6z" fill="#fff" stroke="#000" strokeWidth={1.3} strokeLinejoin="round" />
      </svg>
    </div>
  )
}
