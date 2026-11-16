import { api, type OverlayStyle, type Settings } from './api'
import { Icon, PlayGlyph, Segmented, Switch } from './ui'

const TEXT_COLORS = ['#ffffff', '#ffd666', '#7ee0ff', '#9dffb0']
const BACKGROUND_COLORS = ['#000000', '#0b1a33', '#2a0f0d', '#ffd666']

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** The subtitle block as it appears on screen; `scale` shrinks it to fit a preview. */
export function SubtitleBlock(props: { style: OverlayStyle; original: string | null; text: string; scale?: number }) {
  const { style } = props
  return (
    <div
      className="subtitle"
      style={{
        color: style.textColor,
        background: rgba(style.bgColor, style.bgOpacity),
        fontSize: style.fontSize * (props.scale ?? 1),
      }}
    >
      {style.showOriginal && props.original && <div className="subtitle-original">{props.original}</div>}
      <div className="subtitle-text" style={{ maxHeight: `${style.maxLines * 1.3}em` }}>
        <span>{props.text}</span>
      </div>
    </div>
  )
}

function Swatches(props: { label: string; value: string; colors: string[]; onChange: (c: string) => void }) {
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="swatches" role="radiogroup" aria-label={props.label}>
        {props.colors.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={props.value.toLowerCase() === c}
            aria-label={`${props.label} ${c}`}
            className={`swatch ${props.value.toLowerCase() === c ? 'on' : ''}`}
            style={{ background: c }}
            onClick={() => props.onChange(c)}
          />
        ))}
        <label className="swatch custom" aria-label={`Custom ${props.label.toLowerCase()}`}>
          <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
        </label>
      </div>
    </div>
  )
}

export function Subtitles(props: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  visible: boolean
  edit: boolean
}) {
  const { settings, update, visible, edit } = props
  const style = settings.overlay
  const set = (patch: Partial<OverlayStyle>) => update({ overlay: { ...style, ...patch } })

  return (
    <>
      <div className="heading"><h1>Subtitles</h1><p>How the floating overlay looks on your video.</p></div>

      <div className="scene" aria-label="Subtitle preview">
        <div className="scene-play"><PlayGlyph /></div>
        <SubtitleBlock style={style} original="¿Dónde está la estación de tren?" text="Where is the train station?" />
      </div>

      <div className="row">
        <button className="btn grow" onClick={() => api.setOverlayVisible(!visible)}>
          <Icon name="eye" small />{visible ? 'Hide subtitles' : 'Show subtitles'}
        </button>
        <button className={`btn grow ${edit ? 'primary' : ''}`} onClick={() => api.setOverlayEdit(!edit)}>
          <Icon name="move" small />{edit ? 'Finish moving' : 'Move & resize'}
        </button>
      </div>
      <p className="hint pull-up">Press <kbd>⌘⇧L</kbd> anywhere to hide or show. Clicks pass through to the video.</p>

      <section className="card">
        <label className="field">
          <span>Text size <em>{style.fontSize}px</em></span>
          <input type="range" min={16} max={72} value={style.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Background opacity <em>{Math.round(style.bgOpacity * 100)}%</em></span>
          <input type="range" min={0} max={100} value={Math.round(style.bgOpacity * 100)} onChange={(e) => set({ bgOpacity: Number(e.target.value) / 100 })} />
        </label>
        <div className="row between top">
          <Swatches label="Text" value={style.textColor} colors={TEXT_COLORS} onChange={(textColor) => set({ textColor })} />
          <Swatches label="Background" value={style.bgColor} colors={BACKGROUND_COLORS} onChange={(bgColor) => set({ bgColor })} />
        </div>
        <div className="field">
          <span>Maximum lines</span>
          <Segmented label="Maximum lines" value={style.maxLines} options={[[1, '1'], [2, '2'], [3, '3']] as const} onChange={(maxLines) => set({ maxLines })} />
        </div>
        <div className="row between">
          <span>Also show original words</span>
          <Switch label="Also show original words" checked={style.showOriginal} onChange={(showOriginal) => set({ showOriginal })} />
        </div>
      </section>
    </>
  )
}
