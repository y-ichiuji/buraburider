// Mapbox API クライアント。
//
// Directions API / Search Box (Geocoding) API をラップし、生の Mapbox JSON を
// ドメイン型（src/server/types.ts）に正規化して返す。
// Geocoding / Search の GET 応答は KV（CACHE）に TTL 付きでキャッシュする。
//
// シークレットトークンは呼び出し側（ルート）が c.env から取り出して deps.token として渡す。
// この層はグローバルな秘匿値を一切持たない。

import type { Coord, LineString, Route, Spot, SuggestItem } from '../types'

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

// --- ルート沿いの POI 候補収集（ステップ4: 寄り道生成）--------------------
//
// 基本ルートの LineString を数点サンプリングし、その近傍で Search Box の
// カテゴリ検索（絶景・名所・自然など）を叩いて候補 Spot[] を集める。
// ルートからの距離でフィルタし、重複を除去して返す。

/** 寄り道候補の既定カテゴリ（Search Box canonical id）。絶景・名所・自然系。 */
export const DEFAULT_DETOUR_CATEGORIES: readonly string[] = [
  'viewpoint',
  'tourist_attraction',
  'park',
  'nature_reserve',
  'waterfall'
]

/** Search Box カテゴリ検索の生応答（この層の外へは出さない）。 */
interface MapboxCategoryFeature {
  geometry?: { coordinates?: number[] }
  properties?: {
    mapbox_id?: string
    name?: string
    name_preferred?: string
    full_address?: string
    place_formatted?: string
    address?: string
  }
}

interface MapboxCategoryResponse {
  features?: MapboxCategoryFeature[]
}

/** カテゴリ検索のオプション。 */
export interface CategorySearchOptions {
  /** 近傍バイアスの中心座標（必須）。 */
  proximity: Coord
  /** 最大件数（既定 5）。 */
  limit?: number
  /** 検索言語（既定 'ja'）。 */
  language?: string
  /** 国コード（既定 'jp'）。 */
  country?: string
}

/** ルート沿い候補収集のオプション。 */
export interface CollectSpotsOptions {
  /** ルート線をサンプリングする点数。 */
  sampleCount: number
  /** ルートからこの距離（m）を超える候補は除外する。 */
  maxSpotDistanceMeters: number
  /** 検索するカテゴリ（既定 DEFAULT_DETOUR_CATEGORIES）。 */
  categories?: readonly string[]
  /** カテゴリ1件あたりの取得上限（既定 5）。 */
  perCategoryLimit?: number
}

/** 度をラジアンに変換する。 */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 2 点間の大円距離（メートル）。 */
export function haversineMeters(a: Coord, b: Coord): number {
  const R = 6371000
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * LineString を弧長に沿って等間隔に最大 maxSamples 点サンプリングする。
 * 端点（出発地・目的地）を含み、間を距離按分で埋める。
 */
export function sampleAlongLine(line: LineString, maxSamples: number): Coord[] {
  const coords = line.coordinates
  if (coords.length === 0) return []
  if (coords.length === 1) return [coords[0]]
  if (maxSamples <= 1) return [coords[0]]
  if (maxSamples >= coords.length) return [...coords]

  // 各頂点までの累積距離を求める。
  const cumulative: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coords[i - 1], coords[i]))
  }
  const total = cumulative[cumulative.length - 1]
  if (total === 0) return [coords[0]]

  const samples: Coord[] = []
  for (let s = 0; s < maxSamples; s++) {
    const target = (total * s) / (maxSamples - 1)
    // target 距離に対応する区間を探し、線形補間する。
    let seg = 1
    while (seg < cumulative.length - 1 && cumulative[seg] < target) seg++
    const segStart = cumulative[seg - 1]
    const segEnd = cumulative[seg]
    const segLen = segEnd - segStart
    const t = segLen > 0 ? (target - segStart) / segLen : 0
    const a = coords[seg - 1]
    const b = coords[seg]
    samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return samples
}

/** 点からパス（頂点列）への最短距離（最近傍頂点までの距離、メートル）。 */
export function distanceToPathMeters(point: Coord, path: Coord[]): number {
  let min = Infinity
  for (const v of path) {
    const d = haversineMeters(point, v)
    if (d < min) min = d
  }
  return min
}

/** 点に最も近いパス頂点のインデックス（ルート上の進行順を近似するのに使う）。 */
export function nearestVertexIndex(point: Coord, path: Coord[]): number {
  let min = Infinity
  let idx = 0
  for (let i = 0; i < path.length; i++) {
    const d = haversineMeters(point, path[i])
    if (d < min) {
      min = d
      idx = i
    }
  }
  return idx
}

/** id と近接（既定 80m 以内）で重複する Spot を除去する。先勝ち。 */
export function dedupeSpots(spots: Spot[], minSeparationMeters = 80): Spot[] {
  const kept: Spot[] = []
  const seenIds = new Set<string>()
  for (const s of spots) {
    if (seenIds.has(s.id)) continue
    if (kept.some((k) => haversineMeters(k.coord, s.coord) < minSeparationMeters)) continue
    seenIds.add(s.id)
    kept.push(s)
  }
  return kept
}

/** Search Box カテゴリ検索の生応答を Spot[] に正規化する。category には canonical id を入れる。 */
export function normalizeCategory(res: MapboxCategoryResponse, category: string): Spot[] {
  const spots: Spot[] = []
  for (const feature of res.features ?? []) {
    const coords = feature.geometry?.coordinates
    if (!coords || coords.length < 2) continue
    const [lng, lat] = coords
    if (typeof lng !== 'number' || typeof lat !== 'number') continue
    const props = feature.properties ?? {}
    spots.push({
      id: props.mapbox_id ?? `${lng},${lat}`,
      name: props.name ?? props.name_preferred ?? '(名称不明)',
      coord: [lng, lat],
      category,
      address: props.full_address ?? props.place_formatted ?? props.address
    })
  }
  return spots
}

/** カテゴリ検索のキャッシュキー（proximity は 3 桁に丸めてヒット率を上げる）。 */
export function categoryCacheKey(category: string, opts: CategorySearchOptions): string {
  const lng = opts.proximity[0].toFixed(3)
  const lat = opts.proximity[1].toFixed(3)
  return [
    'category',
    category,
    `${lng},${lat}`,
    opts.language ?? 'ja',
    opts.country ?? 'jp',
    String(opts.limit ?? 5)
  ].join(':')
}

/**
 * Search Box のカテゴリ検索。指定 canonical id の POI を近傍で取得し Spot[] を返す。
 * GET 応答は KV に TTL 付きでキャッシュする。
 */
export async function searchCategory(
  category: string,
  opts: CategorySearchOptions,
  deps: MapboxDeps
): Promise<Spot[]> {
  const cacheKey = categoryCacheKey(category, opts)

  if (deps.cache) {
    const cached = await deps.cache.get<Spot[]>(cacheKey, 'json')
    if (cached) return cached
  }

  const url = new URL(`${MAPBOX_BASE}/search/searchbox/v1/category/${encodeURIComponent(category)}`)
  url.searchParams.set('proximity', `${opts.proximity[0]},${opts.proximity[1]}`)
  url.searchParams.set('language', opts.language ?? 'ja')
  url.searchParams.set('country', opts.country ?? 'jp')
  url.searchParams.set('limit', String(opts.limit ?? 5))
  url.searchParams.set('access_token', deps.token)

  const res = await fetch(url)
  if (!res.ok) {
    throw new MapboxError(
      `Mapbox category search に失敗しました (${res.status})`,
      res.status,
      await res.text()
    )
  }

  const json = (await res.json()) as MapboxCategoryResponse
  const spots = normalizeCategory(json, category)

  if (deps.cache) {
    await deps.cache.put(cacheKey, JSON.stringify(spots), {
      expirationTtl: SEARCH_CACHE_TTL_SECONDS
    })
  }

  return spots
}

/**
 * 基本ルート沿いの POI 候補を収集する。
 * ルート線を sampleCount 点サンプリングし、各点 × 各カテゴリでカテゴリ検索を叩く。
 * 個々のカテゴリ検索が失敗しても全体は止めず（allSettled）、成功分だけを集める。
 * ルートからの距離でフィルタし、重複を除去した Spot[] を返す。
 */
export async function collectRouteSpots(
  route: Route,
  opts: CollectSpotsOptions,
  deps: MapboxDeps
): Promise<Spot[]> {
  const categories = opts.categories ?? DEFAULT_DETOUR_CATEGORIES
  const path = route.geojson.coordinates
  const samples = sampleAlongLine(route.geojson, opts.sampleCount)

  const tasks: Promise<Spot[]>[] = []
  for (const point of samples) {
    for (const category of categories) {
      tasks.push(
        searchCategory(category, { proximity: point, limit: opts.perCategoryLimit ?? 5 }, deps)
      )
    }
  }

  const results = await Promise.allSettled(tasks)
  const all: Spot[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }

  const near = all.filter(
    (spot) => distanceToPathMeters(spot.coord, path) <= opts.maxSpotDistanceMeters
  )
  return dedupeSpots(near)
}
