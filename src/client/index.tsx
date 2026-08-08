import { createRoot } from 'react-dom/client'
import App from './app'
import { registerServiceWorker } from './lib/pwa'

const rootElement = document.getElementById('root')!

const root = createRoot(rootElement)
root.render(<App />)

// PWA: 本番ビルド時のみ Service Worker を登録する（dev は登録しない）。
// 登録失敗はアプリ動作を妨げないため待たずに投げっぱなしにせず、明示的に扱う。
void registerServiceWorker()
