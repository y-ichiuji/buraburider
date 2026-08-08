// ルート生成のオーケストレーション。
//
// `POST /api/routes/plan`（src/server/routes/plan.ts）から呼ばれる中核ロジック。
// ステップ3では「素のルート」のみを扱い、経由地・休憩は空で返す。
//
// 拡張点（後続ステップ）:
//   - ステップ4（寄り道）: ルート沿いの POI を選定し `waypoints` を組み立てる。
//   - ステップ5（休憩）  : 累積所要時間から休憩地点を算出し `rests` を組み立てる。
// いずれも「origin と destination の間に経由地を挿入して再計算する」形なので、
// planRoute は `[origin, ...waypoints, destination]` を Directions へ渡す構造にしてある。
// 後続ステップは waypoints / rests の組み立て処理を足すだけで済む。

import type {
  Coord,
  PlanRequest,
  PlanResponse,
  Rest,
  RestConfig,
  RestMode,
  Route,
  Spot,
  Waypoint
} from '../types'
import { selectDetourWaypoints as defaultSelectDetourWaypoints } from './ai'
import {
  collectRouteSpots as defaultCollectRouteSpots,
  type CollectSpotsOptions,
  getDirections as defaultGetDirections,
  type DirectionsOptions,
  type MapboxDeps,
  nearestVertexIndex
} from './mapbox'
import { scheduleRests as defaultScheduleRests, type RestDeps } from './rest'

/** planRoute の依存。Mapbox 依存に加え、テスト用に各段の実装を差し替えできる。 */
export interface PlanDeps {
  /** Mapbox 呼び出しに必要な依存（トークン・キャッシュ）。 */
  mapbox: MapboxDeps
  /** Workers AI バインディング。未指定でもフォールバック選定で動作する。 */
  ai?: Ai
  /** 経路探索の実装。既定は services/mapbox の getDirections。テストでモックする。 */
  getDirections?: (coords: Coord[], opts: DirectionsOptions, deps: MapboxDeps) => Promise<Route>
  /** ルート沿い候補収集の実装。既定は services/mapbox の collectRouteSpots。 */
  collectSpots?: (route: Route, opts: CollectSpotsOptions, deps: MapboxDeps) => Promise<Spot[]>
  /** スポット選定の実装。既定は services/ai の selectDetourWaypoints。 */
  selectWaypoints?: (
    spots: Spot[],
    route: Route,
    level: number,
    count: number,
    deps: { ai?: Ai }
  ) => Promise<Waypoint[]>
  /** 休憩スケジューリングの実装。既定は services/rest の scheduleRests。 */
  scheduleRests?: (route: Route, config: RestConfig, deps: RestDeps) => Promise<Rest[]>
}

/** Mapbox Directions の経由地上限（25）から origin/destination を除いた挿入可能数。 */
export const MAX_DETOUR_WAYPOINTS = 23

/** 寄り道度（1-5）→ 候補収集・選定パラメータのマッピング。 */
export interface DetourParams {
  /** 挿入する経由地の目標数（N）。 */
  waypointCount: number
  /** ルート線のサンプリング点数（候補収集の探索範囲）。 */
  sampleCount: number
  /** ルートからこの距離（m）を超える候補は除外する（遠回り許容度）。 */
  maxSpotDistanceMeters: number
}

/**
 * 寄り道度（0-5）から候補収集・選定のパラメータを求める。
 * level が高いほど「経由地数」「探索点数」「遠回り許容距離」を増やす。
 * level 0 は寄り道なし（waypointCount 0）。
 */
export function detourParamsForLevel(level: number): DetourParams {
  const table: Record<number, DetourParams> = {
    0: { waypointCount: 0, sampleCount: 0, maxSpotDistanceMeters: 0 },
    1: { waypointCount: 1, sampleCount: 3, maxSpotDistanceMeters: 4000 },
    2: { waypointCount: 2, sampleCount: 4, maxSpotDistanceMeters: 6000 },
    3: { waypointCount: 3, sampleCount: 4, maxSpotDistanceMeters: 9000 },
    4: { waypointCount: 4, sampleCount: 5, maxSpotDistanceMeters: 13000 },
    5: { waypointCount: 6, sampleCount: 6, maxSpotDistanceMeters: 20000 }
  }
  const clamped = Math.max(DETOUR_LEVEL_MIN, Math.min(DETOUR_LEVEL_MAX, Math.round(level)))
  return table[clamped]
}

/** 有効な休憩モード一覧。 */
export const REST_MODES: readonly RestMode[] = ['konbini', 'local', 'cafe', 'emergency']

/** 寄り道度スライダーの範囲。 */
export const DETOUR_LEVEL_MIN = 0
export const DETOUR_LEVEL_MAX = 5

/** rest が省略/不正だった場合に用いる既定の休憩設定。 */
const DEFAULT_REST: RestConfig = { enabled: false, intervalMinutes: 90, mode: 'konbini' }

/**
 * ルートを生成する。
 *
 * 1. 基本ルート（経由地なし）を取得する。
 * 2. `detourLevel >= 1` なら、ルート沿いの POI 候補収集 → AI（失敗時はスコアリング）で
 *    立ち寄り先を N 件選定し、経由地入りで再計算した「寄り道ルート」を得る。
 * 3. `rest.enabled` なら、寄り道ルート（無ければ基本ルート）に沿って休憩地点を算出し、
 *    寄り道経由地と休憩をルート上の位置順にマージして最終ルートを再計算する。
 *
 * 候補収集・選定・休憩スケジューリング・再計算のいずれが失敗しても、
 * 直前まで得られたルートへフォールバックし、機能全体は壊さない。
 */
export async function planRoute(input: PlanRequest, deps: PlanDeps): Promise<PlanResponse> {
  const getDirections = deps.getDirections ?? defaultGetDirections
  const collectSpots = deps.collectSpots ?? defaultCollectRouteSpots
  const selectWaypoints = deps.selectWaypoints ?? defaultSelectDetourWaypoints
  const scheduleRests = deps.scheduleRests ?? defaultScheduleRests

  // 基本ルート（経由地なし）。寄り道生成・休憩算出の基準線として使う。
  const baseRoute = await getDirections([input.origin, input.destination], {}, deps.mapbox)

  // --- 寄り道経由地の決定（detourLevel >= 1 のとき）-------------------------
  let waypoints: Waypoint[] = []
  if (input.detourLevel > DETOUR_LEVEL_MIN) {
    const params = detourParamsForLevel(input.detourLevel)
    try {
      const spots = await collectSpots(
        baseRoute,
        {
          sampleCount: params.sampleCount,
          maxSpotDistanceMeters: params.maxSpotDistanceMeters,
          // 出発直後・到着直前の不自然な寄り道を避けるため origin/destination 近傍を除外する。
          excludeNear: [input.origin, input.destination]
        },
        deps.mapbox
      )
      waypoints = await selectWaypoints(spots, baseRoute, input.detourLevel, params.waypointCount, {
        ai: deps.ai
      })
    } catch (err) {
      // POI 収集 / 選定の失敗はルート全体を壊さない。基本ルートへフォールバックする。
      console.error('寄り道スポットの収集/選定に失敗しました。基本ルートを返します', err)
      waypoints = []
    }
    waypoints = waypoints.slice(0, MAX_DETOUR_WAYPOINTS)
  }

  // 寄り道経由地入りルート（休憩スケジューリングの基準線）。経由地が無ければ基本ルート。
  let detourRoute = baseRoute
  if (waypoints.length > 0) {
    const coords: Coord[] = [input.origin, ...waypoints.map((w) => w.coord), input.destination]
    detourRoute = await getDirections(coords, {}, deps.mapbox)
  }

  // --- 休憩地点の決定（rest.enabled のとき）--------------------------------
  let rests: Rest[] = []
  if (input.rest.enabled) {
    try {
      const scheduled = await scheduleRests(detourRoute, input.rest, { mapbox: deps.mapbox })
      // 経由地総数（寄り道 + 休憩）が Directions 上限を超えないよう休憩側をキャップする。
      const budget = Math.max(0, MAX_DETOUR_WAYPOINTS - waypoints.length)
      rests = scheduled.slice(0, budget)
    } catch (err) {
      // 休憩の算出失敗は致命ではない。休憩なしで寄り道ルートを返す。
      console.error('休憩スケジューリングに失敗しました。休憩なしで返します', err)
      rests = []
    }
  }

  // --- 最終ルート ----------------------------------------------------------
  // 休憩を挿入する場合のみ、寄り道経由地と休憩をルート順にマージして再計算する。
  if (rests.length > 0) {
    const coords = mergeIntermediateCoords(
      input.origin,
      input.destination,
      waypoints,
      rests,
      detourRoute
    )
    try {
      const route = await getDirections(coords, {}, deps.mapbox)
      return { route, waypoints, rests }
    } catch (err) {
      // 休憩込みの再計算失敗時は寄り道ルートへフォールバック（休憩マーカーは情報として残す）。
      console.error('休憩込みの再計算に失敗しました。寄り道ルートで返します', err)
      return { route: detourRoute, waypoints, rests }
    }
  }

  return { route: detourRoute, waypoints, rests }
}

/**
 * 寄り道経由地と休憩地点を、基準ルート（detourRoute）上の進行順にマージし、
 * `[origin, ...(順序付き中間点), destination]` の座標列を組み立てる。
 * 進行順は各点に最も近いルート頂点のインデックスで近似する。
 */
export function mergeIntermediateCoords(
  origin: Coord,
  destination: Coord,
  waypoints: readonly Waypoint[],
  rests: readonly Rest[],
  route: Route
): Coord[] {
  const path = route.geojson.coordinates
  const points = [...waypoints.map((w) => w.coord), ...rests.map((r) => r.coord)].map((coord) => ({
    coord,
    progress: nearestVertexIndex(coord, path)
  }))
  points.sort((a, b) => a.progress - b.progress)
  return [origin, ...points.map((p) => p.coord), destination]
}

// --- リクエストのバリデーション（純粋関数・テスト対象）--------------------

/** バリデーション結果。成功なら正規化済みの値、失敗ならエラーメッセージ。 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * 受信した未検証のボディを検証し、正規化済みの PlanRequest を返す。
 * 不正な場合はエラーメッセージを返す（ルート側で 400 にする）。
 */
export function parsePlanRequest(raw: unknown): ParseResult<PlanRequest> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'リクエストボディが不正です' }
  }
  const body = raw as Record<string, unknown>

  const origin = parseCoord(body.origin)
  if (!origin) {
    return { ok: false, error: 'origin は [lng, lat] の数値2要素で指定してください' }
  }

  const destination = parseCoord(body.destination)
  if (!destination) {
    return { ok: false, error: 'destination は [lng, lat] の数値2要素で指定してください' }
  }

  const { detourLevel } = body
  if (
    typeof detourLevel !== 'number' ||
    !Number.isInteger(detourLevel) ||
    detourLevel < DETOUR_LEVEL_MIN ||
    detourLevel > DETOUR_LEVEL_MAX
  ) {
    return {
      ok: false,
      error: `detourLevel は ${DETOUR_LEVEL_MIN}〜${DETOUR_LEVEL_MAX} の整数で指定してください`
    }
  }

  const rest = parseRest(body.rest)
  if (!rest.ok) return rest

  return { ok: true, value: { origin, destination, detourLevel, rest: rest.value } }
}

/** `[lng, lat]` として妥当な座標なら Coord を、不正なら null を返す。 */
function parseCoord(raw: unknown): Coord | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null
  const [lng, lat] = raw as unknown[]
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  return [lng, lat]
}

/** 休憩設定を検証する。省略/null の場合は既定値を用いる。 */
function parseRest(raw: unknown): ParseResult<RestConfig> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: { ...DEFAULT_REST } }
  }
  if (typeof raw !== 'object') {
    return { ok: false, error: 'rest はオブジェクトで指定してください' }
  }
  const r = raw as Record<string, unknown>

  const enabled = r.enabled ?? DEFAULT_REST.enabled
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: 'rest.enabled は真偽値で指定してください' }
  }

  const intervalMinutes = r.intervalMinutes ?? DEFAULT_REST.intervalMinutes
  if (
    typeof intervalMinutes !== 'number' ||
    !Number.isFinite(intervalMinutes) ||
    intervalMinutes <= 0
  ) {
    return { ok: false, error: 'rest.intervalMinutes は正の数で指定してください' }
  }

  const mode = r.mode ?? DEFAULT_REST.mode
  if (typeof mode !== 'string' || !REST_MODES.includes(mode as RestMode)) {
    return {
      ok: false,
      error: `rest.mode は ${REST_MODES.join(' | ')} のいずれかで指定してください`
    }
  }

  return { ok: true, value: { enabled, intervalMinutes, mode: mode as RestMode } }
}
