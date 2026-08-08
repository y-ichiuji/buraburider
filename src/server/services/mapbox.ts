// Mapbox API クライアント。
//
// Directions API / Search Box (Geocoding) API をラップし、生の Mapbox JSON を
// ドメイン型（src/server/types.ts）に正規化して返す。
// Geocoding / Search の GET 応答は KV（CACHE）に TTL 付きでキャッシュする。
//
// シークレットトークンは呼び出し側（ルート）が c.env から取り出して deps.token として渡す。
// この層はグローバルな秘匿値を一切持たない。

import type { Coord, LineString, Route, SuggestItem } from '../types'

const MAPBOX_BASE = 'https://api.mapbox.com'

/** Search / Geocoding 応答のキャッシュ TTL（秒）。24 時間。 */
export const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24

/** Mapbox 呼び出しに必要な依存（トークンと任意のキャッシュ）。 */
export interface MapboxDeps {
  /** サーバー用シークレットトークン（`c.env.MAPBOX_SECRET_TOKEN`）。 */
  token: string
  /** Geocoding / Search 応答のキャッシュ用 KV。未指定ならキャッシュしない。 */
  cache?: KVNamespace
}

/** サジェスト（forward search）のオプション。 */
export interface SuggestOptions {
  /** 検索言語（既定 'ja'）。 */
  language?: string
  /** 国コード（既定 'jp'）。 */
  country?: string
  /** 最大件数（既定 10）。 */
  limit?: number
  /** 近傍バイアスの中心座標。 */
  proximity?: Coord
}

/** Directions のオプション。 */
export interface DirectionsOptions {
  /** ルーティングプロファイル（既定 'driving'）。 */
  profile?: 'driving' | 'driving-traffic' | 'cycling' | 'walking'
}

/** Mapbox API がエラー応答を返したことを表す例外。 */
export class MapboxError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'MapboxError'
    this.status = status
    this.body = body
  }
}

// --- Mapbox 生応答の内部型（この層の外へは出さない）-----------------------

interface MapboxForwardFeature {
  geometry?: { coordinates?: number[] }
  properties?: {
    mapbox_id?: string
    name?: string
    name_preferred?: string
    full_address?: string
    place_formatted?: string
  }
}

interface MapboxForwardResponse {
  features?: MapboxForwardFeature[]
}

interface MapboxDirectionsRoute {
  geometry: LineString
  /** メートル。 */
  distance: number
  /** 秒。 */
  duration: number
}

interface MapboxDirectionsResponse {
  routes?: MapboxDirectionsRoute[]
}

// --- 純粋関数（テスト対象）------------------------------------------------

/** クエリを正規化する（前後空白除去・小文字化・連続空白の畳み込み）。 */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** サジェストのキャッシュキーを生成する（正規化クエリ + オプション）。 */
export function suggestCacheKey(q: string, opts: SuggestOptions = {}): string {
  const parts = [
    'suggest',
    normalizeQuery(q),
    opts.language ?? 'ja',
    opts.country ?? 'jp',
    String(opts.limit ?? 10),
    opts.proximity ? `${opts.proximity[0]},${opts.proximity[1]}` : ''
  ]
  return parts.join(':')
}

/** Mapbox forward search の生応答を SuggestItem[] に正規化する。 */
export function normalizeSuggest(res: MapboxForwardResponse): SuggestItem[] {
  const items: SuggestItem[] = []
  for (const feature of res.features ?? []) {
    const coords = feature.geometry?.coordinates
    if (!coords || coords.length < 2) continue
    const [lng, lat] = coords
    if (typeof lng !== 'number' || typeof lat !== 'number') continue
    const props = feature.properties ?? {}
    items.push({
      id: props.mapbox_id ?? `${lng},${lat}`,
      name: props.name ?? props.name_preferred ?? '(名称不明)',
      coord: [lng, lat],
      fullAddress: props.full_address ?? props.place_formatted
    })
  }
  return items
}

/** Mapbox Directions の生応答を Route に正規化する。 */
export function normalizeDirections(res: MapboxDirectionsResponse): Route {
  const route = res.routes?.[0]
  if (!route) {
    throw new Error('Mapbox Directions がルートを返しませんでした')
  }
  return {
    geojson: route.geometry,
    distanceKm: Math.round((route.distance / 1000) * 10) / 10,
    durationMin: Math.round(route.duration / 60)
  }
}

// --- API 呼び出し ----------------------------------------------------------

/**
 * 目的地サジェスト（forward search）。
 * KV キャッシュがあれば正規化クエリでヒットを返し、ミス時のみ Mapbox を叩いて格納する。
 */
export async function geocodeForward(
  query: string,
  opts: SuggestOptions,
  deps: MapboxDeps
): Promise<SuggestItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const cacheKey = suggestCacheKey(trimmed, opts)

  if (deps.cache) {
    const cached = await deps.cache.get<SuggestItem[]>(cacheKey, 'json')
    if (cached) return cached
  }

  const url = new URL(`${MAPBOX_BASE}/search/searchbox/v1/forward`)
  url.searchParams.set('q', trimmed)
  url.searchParams.set('language', opts.language ?? 'ja')
  url.searchParams.set('country', opts.country ?? 'jp')
  url.searchParams.set('limit', String(opts.limit ?? 10))
  if (opts.proximity) {
    url.searchParams.set('proximity', `${opts.proximity[0]},${opts.proximity[1]}`)
  }
  url.searchParams.set('access_token', deps.token)

  const res = await fetch(url)
  if (!res.ok) {
    throw new MapboxError(
      `Mapbox forward search に失敗しました (${res.status})`,
      res.status,
      await res.text()
    )
  }

  const json = (await res.json()) as MapboxForwardResponse
  const items = normalizeSuggest(json)

  if (deps.cache) {
    await deps.cache.put(cacheKey, JSON.stringify(items), {
      expirationTtl: SEARCH_CACHE_TTL_SECONDS
    })
  }

  return items
}

/**
 * 経路探索。座標列（少なくとも 2 点）を渡すと正規化した Route を返す。
 * Directions は都度計算のためキャッシュしない。
 */
export async function getDirections(
  coords: Coord[],
  opts: DirectionsOptions,
  deps: MapboxDeps
): Promise<Route> {
  if (coords.length < 2) {
    throw new Error('getDirections には少なくとも 2 点の座標が必要です')
  }

  const profile = opts.profile ?? 'driving'
  const path = coords.map((c) => `${c[0]},${c[1]}`).join(';')
  const url = new URL(`${MAPBOX_BASE}/directions/v5/mapbox/${profile}/${path}`)
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('overview', 'full')
  url.searchParams.set('access_token', deps.token)

  const res = await fetch(url)
  if (!res.ok) {
    throw new MapboxError(
      `Mapbox Directions に失敗しました (${res.status})`,
      res.status,
      await res.text()
    )
  }

  const json = (await res.json()) as MapboxDirectionsResponse
  return normalizeDirections(json)
}
