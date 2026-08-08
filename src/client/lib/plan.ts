// ルート生成（POST /api/routes/plan）呼び出しの純粋ロジック。
// React 非依存で、useRoutePlan フックとユニットテストの双方から利用する。

import type { Coord, PlanRequest, PlanResponse } from '../../server/types'

/** ルート生成 API のエンドポイント。 */
export const PLAN_ENDPOINT = '/api/routes/plan'

/** 寄り道度スライダーの範囲（サーバーの parsePlanRequest と一致させる）。 */
export const DETOUR_LEVEL_MIN = 0
export const DETOUR_LEVEL_MAX = 5

/** 既定の寄り道度（素のルート）。 */
export const DEFAULT_DETOUR_LEVEL = DETOUR_LEVEL_MIN

/** ルート生成 API のレスポンス形（成功時は PlanResponse、失敗時は { error }）。 */
export type PlanApiResponse = PlanResponse | { error: string }

/**
 * `POST /api/routes/plan` のリクエストボディを組み立てる。
 * ステップ3では休憩は無効・寄り道度は 0 固定。
 */
export function buildPlanRequest(
  origin: Coord,
  destination: Coord,
  detourLevel: number = DEFAULT_DETOUR_LEVEL
): PlanRequest {
  return {
    origin,
    destination,
    detourLevel,
    rest: { enabled: false, intervalMinutes: 90, mode: 'konbini' }
  }
}

/** 所要時間（分）を「2時間34分」「45分」形式へ整形する。 */
export function formatDuration(durationMin: number): string {
  const total = Math.max(0, Math.round(durationMin))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes}分`
  return `${hours}時間${minutes}分`
}

/** 距離（km）を小数第1位までの文字列へ整形する。 */
export function formatDistance(distanceKm: number): string {
  return distanceKm.toFixed(1)
}
