// 休憩スケジューリングのロジック（ステップ5: 機能②）。
//
// 寄り道確定後の最終ルート（Route）と休憩設定（RestConfig）を入力に、
//   1. 累積所要時間から intervalMinutes ごとの休憩挿入タイミング（分）を算出し、
//   2. 各タイミングのルート上の位置を「所要時間 ≈ 距離」の比例近似で求め、
//   3. その近傍でモードに応じたカテゴリ検索（Search Box / forward search）を行い、
//   4. ルートから最も外れないスポットを 1 件選んで Rest を組み立てる。
//
// カテゴリ検索や個々の休憩地点の選定が失敗しても機能を壊さず、
// スポットが見つからないタイミングはスキップする。

import type {
  Coord,
  LineString,
  Rest,
  RestConfig,
  RestMode,
  RestType,
  Route,
  Spot,
  SuggestItem
} from '../types'
import {
  distanceToPathMeters,
  geocodeForward as defaultGeocodeForward,
  haversineMeters,
  searchCategory as defaultSearchCategory,
  type MapboxDeps
} from './mapbox'

/** 1 ルートに挿入する休憩の最大数（経由地上限とは別の安全弁）。 */
export const MAX_RESTS = 8

/** 休憩スポットがルートからこの距離（m）を超える場合は採用しない。 */
export const MAX_REST_SPOT_DISTANCE_METERS = 10000

/** 休憩スポット検索の 1 検索あたり取得上限。 */
export const REST_SEARCH_LIMIT = 5

/** 休憩モードごとの検索仕様（種別・カテゴリ・forward 検索語）。 */
export interface RestSearchSpec {
  /** 組み立てる Rest の種別。 */
  restType: RestType
  /** Search Box カテゴリ検索の canonical id 群。 */
  categories: readonly string[]
  /** forward search で使う日本語クエリ群（canonical カテゴリで賄えない道の駅など）。 */
  forwardQueries: readonly string[]
}

/**
 * 休憩モード → 検索仕様のマッピング（architecture.md 6-2 準拠）。
 * - konbini    : コンビニ
 * - local      : 道の駅 / farmers market・特産品
 * - cafe       : カフェ / 絶景ビューポイント
 * - emergency  : ガソリンスタンド
 */
export function restSearchSpec(mode: RestMode): RestSearchSpec {
  const table: Record<RestMode, RestSearchSpec> = {
    konbini: { restType: 'konbini', categories: ['convenience_store'], forwardQueries: [] },
    local: { restType: 'michinoeki', categories: ['farmers_market'], forwardQueries: ['道の駅'] },
    cafe: { restType: 'cafe', categories: ['cafe', 'viewpoint'], forwardQueries: [] },
    emergency: { restType: 'gas', categories: ['gas_station'], forwardQueries: [] }
  }
  return table[mode]
}

/**
 * 総所要時間（分）と休憩間隔（分）から休憩挿入タイミング（分）の列を求める。
 * 例: durationMin=214, intervalMinutes=90 → [90, 180]。
 * 目的地手前（durationMin 以上）には入れない。安全弁として MAX_RESTS 件でクランプする。
 */
export function computeRestMinutes(durationMin: number, intervalMinutes: number): number[] {
  if (!Number.isFinite(durationMin) || durationMin <= 0) return []
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return []

  const marks: number[] = []
  for (let mark = intervalMinutes; mark < durationMin; mark += intervalMinutes) {
    marks.push(Math.round(mark))
    if (marks.length >= MAX_RESTS) break
  }
  return marks
}

/**
 * LineString を弧長で辿り、全長に対する割合 fraction（0-1）の位置の座標を返す。
 * fraction は [0, 1] にクランプする。所要時間の累積割合 ≈ 距離割合として休憩位置に使う。
 */
export function pointAtRouteFraction(line: LineString, fraction: number): Coord {
  const coords = line.coordinates
  if (coords.length === 0) throw new Error('pointAtRouteFraction: 空の LineString です')
  if (coords.length === 1) return coords[0]

  const f = Math.max(0, Math.min(1, fraction))

  // 各頂点までの累積距離。
  const cumulative: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coords[i - 1], coords[i]))
  }
  const total = cumulative[cumulative.length - 1]
  if (total === 0) return coords[0]

  const target = total * f
  let seg = 1
  while (seg < cumulative.length - 1 && cumulative[seg] < target) seg++
  const segStart = cumulative[seg - 1]
  const segEnd = cumulative[seg]
  const segLen = segEnd - segStart
  const t = segLen > 0 ? (target - segStart) / segLen : 0
  const a = coords[seg - 1]
  const b = coords[seg]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** 休憩スポットの候補（Spot / SuggestItem を共通化した最小情報）。 */
interface RestCandidate {
  id: string
  name: string
  coord: Coord
}

function spotsToCandidates(spots: Spot[]): RestCandidate[] {
  return spots.map((s) => ({ id: s.id, name: s.name, coord: s.coord }))
}

function suggestsToCandidates(items: SuggestItem[]): RestCandidate[] {
  return items.map((s) => ({ id: s.id, name: s.name, coord: s.coord }))
}

/**
 * 候補群からルート（path）に最も近く、未使用のスポットを 1 件選ぶ。
 * ルートから MAX_REST_SPOT_DISTANCE_METERS を超えるものは除外。該当なしなら null。
 */
export function pickNearestToRoute(
  candidates: readonly RestCandidate[],
  path: Coord[],
  usedIds: ReadonlySet<string>
): RestCandidate | null {
  let best: RestCandidate | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    if (usedIds.has(c.id)) continue
    const d = distanceToPathMeters(c.coord, path)
    if (d > MAX_REST_SPOT_DISTANCE_METERS) continue
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

/** scheduleRests の依存。テストで検索実装を差し替えられる。 */
export interface RestDeps {
  mapbox: MapboxDeps
  /** カテゴリ検索の実装。既定は services/mapbox の searchCategory。 */
  searchCategory?: (
    category: string,
    opts: { proximity: Coord; limit?: number },
    deps: MapboxDeps
  ) => Promise<Spot[]>
  /** forward search の実装。既定は services/mapbox の geocodeForward。 */
  geocodeForward?: (
    query: string,
    opts: { proximity?: Coord; limit?: number },
    deps: MapboxDeps
  ) => Promise<SuggestItem[]>
}

/** 1 つの休憩位置の近傍で、仕様のカテゴリ／forward 検索を叩いて候補を集める。 */
async function gatherCandidates(
  point: Coord,
  spec: RestSearchSpec,
  deps: RestDeps
): Promise<RestCandidate[]> {
  const searchCategoryFn = deps.searchCategory ?? defaultSearchCategory
  const geocodeForwardFn = deps.geocodeForward ?? defaultGeocodeForward

  const tasks: Promise<RestCandidate[]>[] = []
  for (const category of spec.categories) {
    tasks.push(
      searchCategoryFn(category, { proximity: point, limit: REST_SEARCH_LIMIT }, deps.mapbox).then(
        spotsToCandidates
      )
    )
  }
  for (const query of spec.forwardQueries) {
    tasks.push(
      geocodeForwardFn(query, { proximity: point, limit: REST_SEARCH_LIMIT }, deps.mapbox).then(
        suggestsToCandidates
      )
    )
  }

  const results = await Promise.allSettled(tasks)
  const all: RestCandidate[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
}

/**
 * ルートに沿って休憩地点を算出する。
 *
 * - `config.enabled === false` なら空配列。
 * - intervalMinutes ごとの挿入タイミングを求め、各位置の近傍でモード別カテゴリ検索を行い、
 *   ルートから最も外れないスポットを 1 件選定して Rest を組み立てる。
 * - スポットが見つからないタイミングはスキップし、同一スポットの重複採用は避ける。
 * - 個々の検索が失敗しても全体は止めない（allSettled）。
 */
export async function scheduleRests(
  route: Route,
  config: RestConfig,
  deps: RestDeps
): Promise<Rest[]> {
  if (!config.enabled) return []

  const marks = computeRestMinutes(route.durationMin, config.intervalMinutes)
  if (marks.length === 0) return []

  const spec = restSearchSpec(config.mode)
  const path = route.geojson.coordinates
  const usedIds = new Set<string>()
  const rests: Rest[] = []

  for (const mark of marks) {
    const fraction = mark / route.durationMin
    const point = pointAtRouteFraction(route.geojson, fraction)
    const candidates = await gatherCandidates(point, spec, deps)
    const picked = pickNearestToRoute(candidates, path, usedIds)
    if (!picked) continue
    usedIds.add(picked.id)
    rests.push({ type: spec.restType, name: picked.name, atMinute: mark, coord: picked.coord })
  }

  return rests
}
