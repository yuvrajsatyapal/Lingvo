import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Control } from './Control'
import { Overlay } from './Overlay'
import './styles.css'

if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
  const { installMock } = await import('./dev-mock')
  installMock()
}

const isOverlay = getCurrentWebviewWindow().label === 'overlay'
document.documentElement.dataset.window = isOverlay ? 'overlay' : 'main'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlay ? <Overlay /> : <Control />}</StrictMode>,
)
