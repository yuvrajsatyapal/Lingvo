import { useCurrentFrame } from 'remotion'
import { T } from './theme'

export const PLAYER_W = 1100
export const PLAYER_H = 619

// A plain, flat video player showing a Spanish lecture. It is the thing being watched, not Lingvo UI.
export function Player(props: { subtitle: { original: string; text: string; final: boolean } | null; ccStruck: number }) {
  const frame = useCurrentFrame()
  const talk = Math.max(0, Math.sin(frame * 0.9)) * Math.max(0, Math.sin(frame * 0.23 + 1))
  const progress = 0.24 + frame / 900 * 0.02

  return (
    <div style={{
      width: PLAYER_W, height: PLAYER_H, borderRadius: 18, overflow: 'hidden', background: '#0f0f0f', position: 'relative',
      border: `1px solid ${T.line2}`, fontFamily: T.font, boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
    }}>
      {/* Lecture room */}
      <div style={{ position: 'absolute', inset: 0, background: '#141414' }} />
      <div style={{ position: 'absolute', left: 90, top: 70, width: 560, height: 300, background: '#1c1c1c', borderRadius: 8, border: '1px solid #262626' }}>
        {[60, 100, 140, 180].map((y, i) => (
          <div key={y} style={{ position: 'absolute', left: 40, top: y, height: 6, borderRadius: 3, background: '#2a2a2a', width: [380, 300, 420, 240][i] }} />
        ))}
        <div style={{ position: 'absolute', left: 40, top: 22, fontSize: 22, fontWeight: 700, color: '#3a3a3a', letterSpacing: '-0.01em' }}>Historia de España</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, background: '#101010' }} />
      {/* Speaker */}
      <div style={{ position: 'absolute', left: 740, top: 150 + Math.sin(frame / 18) * 2 }}>
        <div style={{ width: 118, height: 118, borderRadius: '50%', background: '#2b2b2b', marginLeft: 51 }} />
        <div style={{ width: 70, height: 6 + talk * 10, borderRadius: 6, background: '#1a1a1a', position: 'absolute', left: 75, top: 82 }} />
        <div style={{ width: 220, height: 260, borderRadius: '110px 110px 20px 20px', background: '#252525', marginTop: 14 }} />
      </div>
      {/* Speaking indicator */}
      <div style={{ position: 'absolute', right: 26, top: 22, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 999, background: 'rgba(0,0,0,0.55)', color: T.text, fontSize: 20, fontWeight: 600 }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 22 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ width: 4, borderRadius: 2, background: T.text, height: 6 + Math.abs(Math.sin(frame * 0.5 + i * 1.3)) * 16 }} />
          ))}
        </div>
        Español
      </div>

      {/* Subtitle overlay, styled like Lingvo's floating subtitles (defaults: white on black at 60%) */}
      {props.subtitle && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 104, display: 'flex', justifyContent: 'center' }}>
          <div style={{
            maxWidth: 980, padding: '0.28em 0.7em', borderRadius: '0.4em', textAlign: 'center', fontWeight: 600, lineHeight: 1.3,
            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 46, textShadow: '0 1px 2px rgba(0,0,0,0.7)',
          }}>
            <div style={{ fontSize: '0.6em', fontWeight: 500, opacity: 0.8, marginBottom: '0.1em' }}>{props.subtitle.original}</div>
            <div style={{ opacity: props.subtitle.final ? 1 : 0.86 }}>{props.subtitle.text || ' '}</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 28px 22px' }}>
        <div style={{ height: 6, borderRadius: 3, background: '#2a2a2a', marginBottom: 16 }}>
          <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 3, background: T.text }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, color: T.text, fontSize: 20 }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill={T.text}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          <span style={{ color: T.muted, fontVariantNumeric: 'tabular-nums' }}>12:{String(4 + Math.floor(frame / 30)).padStart(2, '0')} / 48:10</span>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative', padding: '2px 8px', border: `2px solid ${T.muted}`, borderRadius: 6, color: T.muted, fontSize: 15, fontWeight: 700 }}>
            CC
            <span style={{
              position: 'absolute', left: -6, top: '50%', height: 2.5, background: T.text, borderRadius: 2,
              width: `${props.ccStruck * 130}%`, transform: 'rotate(-28deg)', transformOrigin: 'left center',
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}
