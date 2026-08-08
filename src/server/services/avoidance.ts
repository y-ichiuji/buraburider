// 酷道・悪路回避フィルタ（③ 安全・快適ルーティングの差し込み口）。
//
// ユーザー報告（road_reports）由来の路面ハザード付近を避けるための純粋関数群。
// ここでは「報告地点付近を通る経由地候補を弾く」「ルート線がハザードを通過するか判定する」
// といった土台のみを提供する。プローブ解析やリアルタイム共有はスコープ外。
//
// planRoute（src/server/services/plan.ts）への実結線は本ステップでは必須ではない。
// 将来の差し込み口:
//   1. planRoute 冒頭で `listRoadReports(db, bbox)` により対象エリアの報告を取得する。
//   2. 寄り道候補スポット選定後に `filterAvoidingHazards(waypoints, reports)` で
//      ハザード付近の経由地を除外する。
//   3. 再計算後のルートに対し `routeHasHazard(route.geojson.coordinates, reports)` で
//      警告を出す／代替ルートを促す、といった用途に使う。
// いずれも副作用のない純粋関数なので、上位のオーケストレーション（plan.ts）から
// 任意の順序で差し込める。

import type { Coord, RoadReport } from '../types'
import { haversineMeters } from './mapbox'

/**
 * 報告地点をこの距離（m）以内で通る点は「ハザード付近」とみなす既定の回避半径。
 * 砂利・落ち葉・凍結は面的に広がるため、点報告より少し広めに取る。
 */
export const DEFAULT_AVOIDANCE_RADIUS_METERS = 150

/**
 * 座標がいずれかの報告地点の回避半径内にあるか判定する。
 * reports が空なら常に false（回避対象なし）。
 */
export function isNearHazard(
  coord: Coord,
  reports: readonly RoadReport[],
  radiusMeters: number = DEFAULT_AVOIDANCE_RADIUS_METERS
): boolean {
  return reports.some((r) => haversineMeters(coord, [r.lng, r.lat]) <= radiusMeters)
}

/**
 * `coord` を持つ候補（経由地・スポットなど）から、報告ハザード付近のものを除外する。
 * ③ の回避フィルタの中核となる純粋関数。元配列は変更しない。
 */
export function filterAvoidingHazards<T extends { coord: Coord }>(
  candidates: readonly T[],
  reports: readonly RoadReport[],
  radiusMeters: number = DEFAULT_AVOIDANCE_RADIUS_METERS
): T[] {
  if (reports.length === 0) return [...candidates]
  return candidates.filter((c) => !isNearHazard(c.coord, reports, radiusMeters))
}

/**
 * ルート線（頂点列）が、いずれかの報告ハザードの回避半径内を通過するか判定する。
 * 頂点ベースの近似（線分の内挿は行わない）だが、警告表示・代替提案の土台には十分。
 */
export function routeHasHazard(
  path: readonly Coord[],
  reports: readonly RoadReport[],
  radiusMeters: number = DEFAULT_AVOIDANCE_RADIUS_METERS
): boolean {
  if (reports.length === 0) return false
  return path.some((vertex) => isNearHazard(vertex, reports, radiusMeters))
}
