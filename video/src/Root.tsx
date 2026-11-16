import { Composition } from 'remotion'
import { DURATION, FPS, HEIGHT, WIDTH } from './beats'
import { LingvoPromo } from './Video'

export const RemotionRoot = () => (
  <Composition id="LingvoPromo" component={LingvoPromo} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
)
