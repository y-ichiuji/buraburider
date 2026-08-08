import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  geocodeForward,
  MapboxError,
  normalizeDirections,
  normalizeQuery,
  normalizeSuggest,
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
