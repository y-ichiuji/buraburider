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

describe('POST /api/routes/plan', () => {
  const validBody = {
    origin: [139.767, 35.681],
    destination: [138.727, 35.36],
    detourLevel: 0,
    rest: { enabled: false, intervalMinutes: 90, mode: 'konbini' }
  }

  function postPlan(app: ReturnType<typeof buildApp>, body: unknown, env = testEnv) {
    return app.request(
      '/api/routes/plan',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      },
      env
    )
  }

  function stubDirections() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              routes: [
                {
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      [139.767, 35.681],
                      [138.727, 35.36]
                    ]
                  },
                  distance: 152400,
                  duration: 12840
                }
              ]
            }),
            { status: 200 }
          )
      )
    )
  }

  it('素のルート（route + 空の waypoints/rests）を返す', async () => {
    stubDirections()
    const app = buildApp()
    const res = await postPlan(app, validBody)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      route: { distanceKm: number; durationMin: number }
      waypoints: unknown[]
      rests: unknown[]
    }
    expect(body.route.distanceKm).toBe(152.4)
    expect(body.route.durationMin).toBe(214)
    expect(body.waypoints).toEqual([])
    expect(body.rests).toEqual([])
  })

  it('Directions へ [origin, destination] を渡す', async () => {
    stubDirections()
    const app = buildApp()
    await postPlan(app, validBody)
    const calledUrl = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0].toString())
    expect(calledUrl.pathname).toBe('/directions/v5/mapbox/driving/139.767,35.681;138.727,35.36')
  })

  it('不正なボディは 400 を返す（Mapbox は呼ばない）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const app = buildApp()
    const res = await postPlan(app, {
      origin: [139.767],
      destination: [138.727, 35.36],
      detourLevel: 0
    })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('detourLevel が範囲外なら 400 を返す', async () => {
    const app = buildApp()
    const res = await postPlan(app, { ...validBody, detourLevel: 9 })
    expect(res.status).toBe(400)
  })

  it('トークン未設定なら 500 を返す', async () => {
    const app = buildApp()
    const res = await postPlan(app, validBody, {} as CloudflareBindings)
    expect(res.status).toBe(500)
  })

  it('Mapbox がエラーなら 502 を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    )
    const app = buildApp()
    const res = await postPlan(app, validBody)
    expect(res.status).toBe(502)
  })
})
