// PWA / Service Worker 登録の純粋ロジック + 登録ヘルパ。
//
// Service Worker 本体は public/sw.js（バンドル対象外の素の JS）に置く。ルート直下から
// 配信されるため scope は '/'。本ファイルの isCacheableAssetPath() が「SW がランタイム
// キャッシュしてよいパス」の正典であり、sw.js はこのロジックをミラーしている
// （両者を変更する際は必ず揃える）。
//
// オフライン地図までは踏み込まない（設計 §8）。キャッシュ対象はビルド成果物の静的アセット
// （ハッシュ付き・不変）とアイコン/マニフェスト等に限定し、API・地図タイルは常にネットワーク。

/** Service Worker スクリプトの URL（ルート scope）。 */
export const SERVICE_WORKER_URL = '/sw.js'

/** SW がランタイムキャッシュしてよい静的アセットのパス接頭辞。 */
export const CACHEABLE_ASSET_PREFIXES: readonly string[] = ['/assets/', '/icons/']

/** SW がランタイムキャッシュしてよい個別パス（完全一致）。 */
export const CACHEABLE_ASSET_PATHS: readonly string[] = ['/manifest.webmanifest', '/favicon.ico']

/**
 * 与えられた同一オリジンの pathname が「キャッシュ対象の静的アセット」かを判定する。
 * API（/api/*）や SSR ドキュメント（/）は false（常にネットワーク）。
 * sw.js が同じ判定をミラーする正典ロジック。
 */
export function isCacheableAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return false
  if (CACHEABLE_ASSET_PATHS.includes(pathname)) return true
  return CACHEABLE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * Service Worker を登録する（本番ビルド時のみ）。
 * dev（Vite HMR）では登録しない — SW のキャッシュが HMR やモジュール配信を阻害するため。
 * navigator.serviceWorker 非対応の環境では黙って何もしない。
 */
export async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.DEV) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' })
  } catch {
    // 登録失敗はアプリ動作を妨げない（PWA インストール不可になるだけ）。握りつぶす。
  }
}
