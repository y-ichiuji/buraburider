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
  Waypoint
} from '../types'
import {
  getDirections as defaultGetDirections,
  type DirectionsOptions,
  type MapboxDeps
} from './mapbox'

/** planRoute の依存。Mapbox 依存に加え、テスト用に Directions 実装を差し替えできる。 */
export interface PlanDeps {
  /** Mapbox 呼び出しに必要な依存（トークン・キャッシュ）。 */
  mapbox: MapboxDeps
  /** 経路探索の実装。既定は services/mapbox の getDirections。テストでモックする。 */
  getDirections?: (coords: Coord[], opts: DirectionsOptions, deps: MapboxDeps) => Promise<Route>
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
 * ステップ3では detourLevel / rest に関わらず素のルート（`[origin, destination]`）を返し、
 * `waypoints` と `rests` は空配列とする。
 */
export async function planRoute(input: PlanRequest, deps: PlanDeps): Promise<PlanResponse> {
  const getDirections = deps.getDirections ?? defaultGetDirections

  // 後続ステップではここに寄り道経由地・休憩地点を組み立てて詰める。
  const waypoints: Waypoint[] = []
  const rests: Rest[] = []

  // 経由地入りで再計算できるよう、origin と destination の間に waypoints を挟む。
  const coords: Coord[] = [input.origin, ...waypoints.map((w) => w.coord), input.destination]

  const route = await getDirections(coords, {}, deps.mapbox)

  return { route, waypoints, rests }
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
