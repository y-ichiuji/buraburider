import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiApp } from './index'

// 実 index.tsx（SSR 依存）を読み込まず、/api のマウント構成だけを再現して結合テストする。
function buildApp() {
  const app = new Hono<{ Bindings: CloudflareBindings }>()
  app.route('/api', createApiApp())
  return app
}

// app.request の第3引数に渡すテスト用 env。Mapbox 呼び出しはモックするため CACHE は未使用。
const testEnv = { MAPBOX_SECRET_TOKEN: 'test-token' } as unknown as CloudflareBindings

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/health', () => {
  it('{ ok: true } を返す', async () => {
    const app = buildApp()
    const res = await app.request('/api/health', {}, testEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('GET /api/search/suggest', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              features: [
                {
                  geometry: { coordinates: [138.727, 35.36] },
                  properties: { mapbox_id: 'poi.1', name: '富士山', full_address: '静岡県' }
                }
              ]
            }),
            { status: 200 }
          )
      )
    )
  })

  it('q が空なら fetch せず空配列を返す', async () => {
    const app = buildApp()
    const res = await app.request('/api/search/suggest', {}, testEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('正規化した SuggestItem[] を返す', async () => {
    const app = buildApp()
    const res = await app.request('/api/search/suggest?q=富士山', {}, testEnv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ name: string; coord: [number, number] }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].name).toBe('富士山')
    expect(body.items[0].coord).toEqual([138.727, 35.36])
  })

  it('トークン未設定なら 500 を返す', async () => {
    const app = buildApp()
    const res = await app.request('/api/search/suggest?q=x', {}, {} as CloudflareBindings)
    expect(res.status).toBe(500)
  })

  it('Mapbox がエラーなら 502 を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    )
    const app = buildApp()
    const res = await app.request('/api/search/suggest?q=x', {}, testEnv)
    expect(res.status).toBe(502)
  })
})
