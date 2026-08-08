import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LineString, Route, Spot } from '../types'
import {
  categoryCacheKey,
  collectRouteSpots,
  dedupeSpots,
  distanceToPathMeters,
  geocodeForward,
  haversineMeters,
  MapboxError,
  nearestVertexIndex,
  normalizeCategory,
  normalizeDirections,
  normalizeQuery,
  normalizeSuggest,
  sampleAlongLine,
  searchCategory,
  SEARCH_CACHE_TTL_SECONDS,
  suggestCacheKey
} from './mapbox'

// --- KV モック（in-memory）------------------------------------------------

function createKvMock() {
  const store = new Map<string, string>()
  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key)
      if (raw == null) return null
      return type === 'json' ? JSON.parse(raw) : raw
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    })
  }
  return { kv: kv as unknown as KVNamespace, store }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// --- 純粋関数 --------------------------------------------------------------

describe('normalizeQuery', () => {
  it('前後空白の除去・小文字化・連続空白の畳み込みを行う', () => {
    expect(normalizeQuery('  Fuji   San  ')).toBe('fuji san')
  })
})

describe('suggestCacheKey', () => {
  it('正規化クエリと既定オプションから決定的なキーを作る', () => {
    expect(suggestCacheKey(' 富士山 ')).toBe('suggest:富士山:ja:jp:10:')
  })

  it('proximity と limit を含める', () => {
    const key = suggestCacheKey('温泉', { limit: 5, proximity: [139.7, 35.6] })
    expect(key).toBe('suggest:温泉:ja:jp:5:139.7,35.6')
  })

  it('大文字・空白違いでも同じキーになる', () => {
    expect(suggestCacheKey('Cafe Test')).toBe(suggestCacheKey('  cafe   test '))
  })
})

describe('normalizeSuggest', () => {
  it('features を SuggestItem[] に正規化する', () => {
    const items = normalizeSuggest({
      features: [
        {
          geometry: { coordinates: [138.727, 35.36] },
          properties: {
            mapbox_id: 'abc',
            name: '富士山',
            full_address: '静岡県富士宮市'
          }
        }
      ]
    })
    expect(items).toEqual([
      {
        id: 'abc',
        name: '富士山',
        coord: [138.727, 35.36],
        fullAddress: '静岡県富士宮市'
      }
    ])
  })

  it('座標が欠けた feature はスキップする', () => {
    const items = normalizeSuggest({
      features: [
        { properties: { name: '座標なし' } },
        { geometry: { coordinates: [1] }, properties: { name: '不完全' } }
      ]
    })
    expect(items).toEqual([])
  })

  it('mapbox_id が無い場合は座標由来の id と代替名を使う', () => {
    const items = normalizeSuggest({
      features: [{ geometry: { coordinates: [1.5, 2.5] }, properties: {} }]
    })
    expect(items[0].id).toBe('1.5,2.5')
    expect(items[0].name).toBe('(名称不明)')
  })

  it('features が無い応答は空配列を返す', () => {
    expect(normalizeSuggest({})).toEqual([])
  })
})

describe('normalizeDirections', () => {
  it('距離(km) と所要時間(分) を丸めて返す', () => {
    const route = normalizeDirections({
      routes: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1]
            ]
          },
          distance: 152400,
          duration: 12840
        }
      ]
    })
    expect(route.distanceKm).toBe(152.4)
    expect(route.durationMin).toBe(214)
    expect(route.geojson.type).toBe('LineString')
  })

  it('ルートが無い場合は例外を投げる', () => {
    expect(() => normalizeDirections({ routes: [] })).toThrow()
  })
})

// --- geocodeForward（fetch モック）---------------------------------------

describe('geocodeForward', () => {
  it('空クエリでは fetch せず空配列を返す', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const items = await geocodeForward('   ', {}, { token: 't' })
    expect(items).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('キャッシュミス時に Mapbox を叩き、結果をキャッシュへ格納する', async () => {
    const { kv, store } = createKvMock()
    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo) =>
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: [138.7, 35.3] },
                properties: { mapbox_id: 'x', name: 'A' }
              }
            ]
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    const items = await geocodeForward('富士', { limit: 5 }, { token: 'secret', cache: kv })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = new URL(fetchMock.mock.calls[0][0].toString())
    expect(calledUrl.pathname).toBe('/search/searchbox/v1/forward')
    expect(calledUrl.searchParams.get('access_token')).toBe('secret')
    expect(calledUrl.searchParams.get('q')).toBe('富士')
    expect(items).toHaveLength(1)

    // キャッシュへ TTL 付きで格納されている
    expect(kv.put).toHaveBeenCalledWith(suggestCacheKey('富士', { limit: 5 }), expect.any(String), {
      expirationTtl: SEARCH_CACHE_TTL_SECONDS
    })
    expect(store.size).toBe(1)
  })

  it('キャッシュヒット時は fetch せずキャッシュ値を返す', async () => {
    const { kv } = createKvMock()
    const cached = [{ id: 'c', name: 'キャッシュ', coord: [1, 2] as [number, number] }]
    await kv.put(suggestCacheKey('温泉'), JSON.stringify(cached))

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const items = await geocodeForward('温泉', {}, { token: 't', cache: kv })
    expect(items).toEqual(cached)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Mapbox がエラー応答なら MapboxError を投げる', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(geocodeForward('x', {}, { token: 't' })).rejects.toBeInstanceOf(MapboxError)
  })
})

// --- 幾何ヘルパー（POI 収集用の純粋関数）---------------------------------

describe('haversineMeters', () => {
  it('同一点は 0、東京〜富士山方面は概ね 100km 前後', () => {
    expect(haversineMeters([139.0, 35.0], [139.0, 35.0])).toBe(0)
    const d = haversineMeters([139.767, 35.681], [138.727, 35.36])
    expect(d).toBeGreaterThan(90000)
    expect(d).toBeLessThan(120000)
  })
})

describe('sampleAlongLine', () => {
  const line: LineString = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0]
    ]
  }

  it('端点を含む maxSamples 点を弧長按分で返す', () => {
    const samples = sampleAlongLine(line, 3)
    expect(samples).toHaveLength(3)
    expect(samples[0]).toEqual([0, 0])
    expect(samples[2]).toEqual([4, 0])
    expect(samples[1][0]).toBeCloseTo(2, 5)
  })

  it('maxSamples が頂点数以上なら全頂点を返す', () => {
    expect(sampleAlongLine(line, 10)).toEqual(line.coordinates)
  })

  it('空の座標列は空配列', () => {
    expect(sampleAlongLine({ type: 'LineString', coordinates: [] }, 3)).toEqual([])
  })
})

describe('distanceToPathMeters / nearestVertexIndex', () => {
  const path: [number, number][] = [
    [139.0, 35.0],
    [138.5, 35.0],
    [138.0, 35.0]
  ]

  it('最近傍頂点までの距離を返す', () => {
    expect(distanceToPathMeters([138.5, 35.0], path)).toBe(0)
    expect(distanceToPathMeters([138.5, 35.01], path)).toBeGreaterThan(0)
  })

  it('最近傍頂点のインデックスを返す', () => {
    expect(nearestVertexIndex([138.02, 35.0], path)).toBe(2)
    expect(nearestVertexIndex([138.99, 35.0], path)).toBe(0)
  })
})

describe('dedupeSpots', () => {
  function s(id: string, lng: number, lat: number): Spot {
    return { id, name: id, coord: [lng, lat] }
  }

  it('同一 id を除去する', () => {
    const out = dedupeSpots([s('a', 139, 35), s('a', 139, 35), s('b', 138, 35)])
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('近接（既定 80m 以内）の別 id も除去する', () => {
    // 約 9m しか離れていない 2 点 → 後者を除去。
    const out = dedupeSpots([s('a', 139.0, 35.0), s('b', 139.0001, 35.0)])
    expect(out.map((x) => x.id)).toEqual(['a'])
  })
})

describe('normalizeCategory', () => {
  it('features を Spot[] に正規化し category に canonical id を入れる', () => {
    const spots = normalizeCategory(
      {
        features: [
          {
            geometry: { coordinates: [138.7, 35.3] },
            properties: { mapbox_id: 'poi.1', name: '○○展望台', full_address: '山梨県' }
          }
        ]
      },
      'viewpoint'
    )
    expect(spots).toEqual([
      {
        id: 'poi.1',
        name: '○○展望台',
        coord: [138.7, 35.3],
        category: 'viewpoint',
        address: '山梨県'
      }
    ])
  })

  it('座標が欠けた feature はスキップする', () => {
    expect(normalizeCategory({ features: [{ properties: { name: 'x' } }] }, 'park')).toEqual([])
  })
})

describe('categoryCacheKey', () => {
  it('proximity を 3 桁に丸めた決定的キーを作る', () => {
    expect(categoryCacheKey('viewpoint', { proximity: [138.72678, 35.36012] })).toBe(
      'category:viewpoint:138.727,35.360:ja:jp:5'
    )
  })
})

// --- searchCategory（fetch + キャッシュ）---------------------------------

describe('searchCategory', () => {
  function createKvMock() {
    const store = new Map<string, string>()
    const kv = {
      get: vi.fn(async (key: string, type?: string) => {
        const raw = store.get(key)
        if (raw == null) return null
        return type === 'json' ? JSON.parse(raw) : raw
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      })
    }
    return { kv: kv as unknown as KVNamespace, store }
  }

  it('category エンドポイントを叩き、結果をキャッシュへ格納する', async () => {
    const { kv, store } = createKvMock()
    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo) =>
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: [138.7, 35.3] },
                properties: { mapbox_id: 'x', name: 'A' }
              }
            ]
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    const spots = await searchCategory(
      'viewpoint',
      { proximity: [138.7, 35.3], limit: 5 },
      { token: 'secret', cache: kv }
    )

    const calledUrl = new URL(fetchMock.mock.calls[0][0].toString())
    expect(calledUrl.pathname).toBe('/search/searchbox/v1/category/viewpoint')
    expect(calledUrl.searchParams.get('proximity')).toBe('138.7,35.3')
    expect(calledUrl.searchParams.get('access_token')).toBe('secret')
    expect(spots).toHaveLength(1)
    expect(spots[0].category).toBe('viewpoint')
    expect(store.size).toBe(1)
  })

  it('キャッシュヒット時は fetch しない', async () => {
    const { kv } = createKvMock()
    const cached: Spot[] = [{ id: 'c', name: 'キャッシュ', coord: [1, 2], category: 'park' }]
    await kv.put(categoryCacheKey('park', { proximity: [1, 2] }), JSON.stringify(cached))

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const spots = await searchCategory('park', { proximity: [1, 2] }, { token: 't', cache: kv })
    expect(spots).toEqual(cached)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Mapbox がエラーなら MapboxError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 }))
    )
    await expect(
      searchCategory('viewpoint', { proximity: [1, 2] }, { token: 't' })
    ).rejects.toBeInstanceOf(MapboxError)
  })
})

// --- collectRouteSpots（サンプリング + フィルタ + 重複除去）--------------

describe('collectRouteSpots', () => {
  const route: Route = {
    geojson: {
      type: 'LineString',
      coordinates: [
        [139.0, 35.0],
        [138.5, 35.0],
        [138.0, 35.0]
      ]
    },
    distanceKm: 90,
    durationMin: 120
  }

  it('ルート近傍の候補を集め、遠い候補は除外し重複除去する', async () => {
    // 近傍（ルート上）の A と、遠すぎる B を返すカテゴリ検索。
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: [138.5, 35.0] },
                properties: { mapbox_id: 'near', name: '近い' }
              },
              {
                geometry: { coordinates: [138.5, 36.0] },
                properties: { mapbox_id: 'far', name: '遠い' }
              }
            ]
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)

    const spots = await collectRouteSpots(
      route,
      { sampleCount: 2, maxSpotDistanceMeters: 5000, categories: ['viewpoint'] },
      { token: 't' }
    )

    // 'near' は複数サンプルで重複ヒットするが 1 件に、'far' は距離フィルタで除外。
    expect(spots.map((s) => s.id)).toEqual(['near'])
  })

  it('一部のカテゴリ検索が失敗しても成功分を返す（allSettled）', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call++
      if (call === 1) return new Response('boom', { status: 500 })
      return new Response(
        JSON.stringify({
          features: [
            {
              geometry: { coordinates: [138.5, 35.0] },
              properties: { mapbox_id: 'ok', name: 'OK' }
            }
          ]
        }),
        { status: 200 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const spots = await collectRouteSpots(
      route,
      { sampleCount: 2, maxSpotDistanceMeters: 5000, categories: ['viewpoint'] },
      { token: 't' }
    )
    expect(spots.map((s) => s.id)).toEqual(['ok'])
  })
})
