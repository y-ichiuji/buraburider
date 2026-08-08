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

  // detourLevel >= 1: Directions（基本＋再計算）と Search Box カテゴリ検索、
  // Workers AI をすべてモックし、経由地入りルートが返ることを確認する。
  it('detourLevel>=1 で候補収集＋AI選定を経て経由地入りルートを返す', async () => {
    // ルート頂点上に置いた候補は距離フィルタを通過する。
    const routeVertex = [139.0, 35.5]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(input.toString())
        if (url.pathname.startsWith('/directions/')) {
          return new Response(
            JSON.stringify({
              routes: [
                {
                  geometry: {
                    type: 'LineString',
                    coordinates: [[139.767, 35.681], routeVertex, [138.727, 35.36]]
                  },
                  distance: 180000,
                  duration: 15000
                }
              ]
            }),
            { status: 200 }
          )
        }
        // カテゴリ検索: ルート頂点上の展望台を返す。
        return new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: routeVertex },
                properties: { mapbox_id: 'poi.view', name: '峠の展望台' }
              }
            ]
          }),
          { status: 200 }
        )
      })
    )

    const aiRun = vi.fn(async () => ({ response: '{"selected":[0]}' }))
    const env = {
      MAPBOX_SECRET_TOKEN: 'test-token',
      AI: { run: aiRun }
    } as unknown as CloudflareBindings

    const app = buildApp()
    const res = await postPlan(app, { ...validBody, detourLevel: 3 }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      waypoints: Array<{ name: string; type: string; coord: [number, number] }>
    }
    expect(body.waypoints).toHaveLength(1)
    expect(body.waypoints[0].name).toBe('峠の展望台')
    expect(body.waypoints[0].type).toBe('scenic')
    expect(aiRun).toHaveBeenCalledTimes(1)

    // カテゴリ検索エンドポイントと、経由地入りの再計算 Directions が呼ばれている。
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => new URL(c[0].toString()).pathname
    )
    expect(calls.some((p) => p.startsWith('/search/searchbox/v1/category/'))).toBe(true)
    expect(
      calls.some((p) => p === '/directions/v5/mapbox/driving/139.767,35.681;139,35.5;138.727,35.36')
    ).toBe(true)
  })

  it('detourLevel>=1 でも AI 未設定ならフォールバック選定で経由地を返す', async () => {
    const routeVertex = [139.0, 35.5]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(input.toString())
        if (url.pathname.startsWith('/directions/')) {
          return new Response(
            JSON.stringify({
              routes: [
                {
                  geometry: {
                    type: 'LineString',
                    coordinates: [[139.767, 35.681], routeVertex, [138.727, 35.36]]
                  },
                  distance: 180000,
                  duration: 15000
                }
              ]
            }),
            { status: 200 }
          )
        }
        return new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: routeVertex },
                properties: { mapbox_id: 'poi.view', name: '峠の展望台' }
              }
            ]
          }),
          { status: 200 }
        )
      })
    )

    // AI バインディングなしの env（testEnv）でフォールバックが働く。
    const app = buildApp()
    const res = await postPlan(app, { ...validBody, detourLevel: 2 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { waypoints: unknown[] }
    expect(body.waypoints).toHaveLength(1)
  })

  // rest.enabled=true: Directions（基本＋休憩入り再計算）とコンビニのカテゴリ検索を
  // モックし、休憩入りルートが返ることを確認する。
  it('rest.enabled=true で休憩スポット入りのルートを返す', async () => {
    // ルート頂点上に置いたスポットは距離フィルタを通過する。
    const originVertex = [139.767, 35.681]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(input.toString())
        if (url.pathname.startsWith('/directions/')) {
          return new Response(
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
        }
        // コンビニのカテゴリ検索: ルート始点上のコンビニを返す。
        return new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: originVertex },
                properties: { mapbox_id: 'poi.store', name: 'コンビニ沿道店' }
              }
            ]
          }),
          { status: 200 }
        )
      })
    )

    const app = buildApp()
    const res = await postPlan(app, {
      ...validBody,
      rest: { enabled: true, intervalMinutes: 90, mode: 'konbini' }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rests: Array<{ name: string; type: string; atMinute: number }>
    }
    expect(body.rests.length).toBeGreaterThanOrEqual(1)
    expect(body.rests[0].type).toBe('konbini')
    expect(body.rests[0].name).toBe('コンビニ沿道店')

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => new URL(c[0].toString()).pathname
    )
    expect(calls.some((p) => p.startsWith('/search/searchbox/v1/category/'))).toBe(true)
  })

  // 寄り道と休憩の併用: convenience_store は休憩、それ以外のカテゴリは寄り道候補として返す。
  it('detourLevel>=1 かつ rest.enabled=true で経由地と休憩の両方を返す', async () => {
    const routeVertex = [139.0, 35.5]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(input.toString())
        if (url.pathname.startsWith('/directions/')) {
          return new Response(
            JSON.stringify({
              routes: [
                {
                  geometry: {
                    type: 'LineString',
                    coordinates: [[139.767, 35.681], routeVertex, [138.727, 35.36]]
                  },
                  distance: 180000,
                  duration: 15000
                }
              ]
            }),
            { status: 200 }
          )
        }
        // コンビニは休憩スポット、その他のカテゴリは寄り道候補（いずれもルート頂点上）。
        const name = url.pathname.includes('convenience_store') ? 'コンビニ峠店' : '峠の展望台'
        const id = url.pathname.includes('convenience_store') ? 'poi.store' : 'poi.view'
        return new Response(
          JSON.stringify({
            features: [
              { geometry: { coordinates: routeVertex }, properties: { mapbox_id: id, name } }
            ]
          }),
          { status: 200 }
        )
      })
    )

    const app = buildApp()
    const res = await postPlan(app, {
      ...validBody,
      detourLevel: 2,
      rest: { enabled: true, intervalMinutes: 90, mode: 'konbini' }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { waypoints: unknown[]; rests: unknown[] }
    expect(body.waypoints.length).toBeGreaterThanOrEqual(1)
    expect(body.rests.length).toBeGreaterThanOrEqual(1)
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
