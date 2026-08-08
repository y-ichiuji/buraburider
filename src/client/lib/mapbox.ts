// ブラウザ側で SSR から埋め込まれた Mapbox public token を読み出すヘルパー。

import { isValidPublicToken } from '../../shared/mapbox-token'

declare global {
  interface Window {
    __MAPBOX_TOKEN__?: string
  }
}

/**
 * SSR が window へ埋め込んだ public token を返す。
 * 未設定・プレースホルダ等で無効な場合は null を返す（呼び出し側でフォールバック表示する）。
 */
export function readMapboxToken(): string | null {
  const token = typeof window === 'undefined' ? undefined : window.__MAPBOX_TOKEN__
  return isValidPublicToken(token) ? token : null
}
