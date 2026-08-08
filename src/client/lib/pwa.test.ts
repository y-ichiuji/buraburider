import { describe, expect, it } from 'vitest'
import { isCacheableAssetPath, SERVICE_WORKER_URL } from './pwa'

describe('isCacheableAssetPath', () => {
  it('ビルド成果物（/assets/*）はキャッシュ対象', () => {
    expect(isCacheableAssetPath('/assets/index-B0ZkLqo9.js')).toBe(true)
    expect(isCacheableAssetPath('/assets/style-DbypT1xN.css')).toBe(true)
  })

  it('アイコン（/icons/*）はキャッシュ対象', () => {
    expect(isCacheableAssetPath('/icons/icon-192.png')).toBe(true)
  })

  it('マニフェスト・favicon はキャッシュ対象', () => {
    expect(isCacheableAssetPath('/manifest.webmanifest')).toBe(true)
    expect(isCacheableAssetPath('/favicon.ico')).toBe(true)
  })

  it('API（/api/*）はキャッシュしない（常にネットワーク）', () => {
    expect(isCacheableAssetPath('/api/routes/plan')).toBe(false)
    expect(isCacheableAssetPath('/api/search/suggest')).toBe(false)
  })

  it('SSR ドキュメント（/）やその他はキャッシュしない', () => {
    expect(isCacheableAssetPath('/')).toBe(false)
    expect(isCacheableAssetPath('/anything')).toBe(false)
  })
})

describe('SERVICE_WORKER_URL', () => {
  it('ルート scope で配信される /sw.js', () => {
    expect(SERVICE_WORKER_URL).toBe('/sw.js')
  })
})
