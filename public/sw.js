/*
 * ブラブライダー Service Worker（最小構成）。
 *
 * 役割はインストール可能性の確保と静的アセットの軽いキャッシュのみ。オフライン地図には
 * 踏み込まない（設計 §8）。キャッシュ判定は src/client/lib/pwa.ts の isCacheableAssetPath()
 * を正典としてミラーしている（変更時は両方を揃えること）。
 *
 * 方針:
 *   - install: アプリシェル（/・マニフェスト・アイコン）を best-effort でプリキャッシュ。
 *   - activate: 旧バージョンのキャッシュを掃除し、即座に制御を奪う。
 *   - fetch: 同一オリジンの GET のうち「キャッシュ対象アセット」だけ cache-first + 背景更新。
 *            それ以外（ナビゲーション・/api・地図タイル等）は素通し（ネットワーク）。
 *
 * このファイルはバンドル対象外の素の JS（public/ 配下）。ルート直下配信で scope は '/'。
 */

const CACHE_VERSION = 'buraburider-v1'

// install 時に best-effort でプリキャッシュするアプリシェル。
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png'
]

// src/client/lib/pwa.ts の isCacheableAssetPath() と同じロジック（ミラー）。
const CACHEABLE_ASSET_PREFIXES = ['/assets/', '/icons/']
const CACHEABLE_ASSET_PATHS = ['/manifest.webmanifest', '/favicon.ico']

function isCacheableAssetPath(pathname) {
  if (pathname.startsWith('/api/')) return false
  if (CACHEABLE_ASSET_PATHS.includes(pathname)) return true
  return CACHEABLE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      // 一部が失敗しても install 自体は成功させる（オフライン地図は目標外）。
      await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // 地図タイル等のクロスオリジンは素通し。
  if (!isCacheableAssetPath(url.pathname)) return // ナビゲーション・API は常にネットワーク。

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      const cached = await cache.match(request)
      if (cached) {
        // 背景で更新（stale-while-revalidate）。失敗は無視。
        event.waitUntil(
          fetch(request)
            .then((res) => {
              if (res && res.ok) return cache.put(request, res.clone())
            })
            .catch(() => {})
        )
        return cached
      }
      // オフラインかつ未キャッシュ時は fetch がそのまま失敗する
      // （フォールバックは用意しない。地図はオンライン前提）。
      const res = await fetch(request)
      if (res && res.ok) await cache.put(request, res.clone())
      return res
    })()
  )
})
