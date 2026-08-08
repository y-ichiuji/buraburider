// ルート生成（POST /api/routes/plan）呼び出しの純粋ロジック。
// React 非依存で、useRoutePlan フックとユニットテストの双方から利用する。

import type { Coord, PlanRequest, PlanResponse, RestConfig, RestType } from '../../server/types'

/** ルート生成 API のエンドポイント。 */
export const PLAN_ENDPOINT = '/api/routes/plan'

/** 寄り道度スライダーの範囲（サーバーの parsePlanRequest と一致させる）。 */
export const DETOUR_LEVEL_MIN = 0
export const DETOUR_LEVEL_MAX = 5

/** 既定の寄り道度（素のルート）。 */
export const DEFAULT_DETOUR_LEVEL = DETOUR_LEVEL_MIN

/** 休憩間隔（分）のプリセット。 */
export const REST_INTERVAL_PRESETS: readonly number[] = [60, 90, 120]

/** 休憩無効の既定設定（UI 初期値・buildPlanRequest の既定）。 */
export const DEFAULT_REST_CONFIG: RestConfig = {
  enabled: false,
  intervalMinutes: 90,
  mode: 'konbini'
}

/** ルート生成 API のレスポンス形（成功時は PlanResponse、失敗時は { error }）。 */
export type PlanApiResponse = PlanResponse | { error: string }

/**
 * `POST /api/routes/plan` のリクエストボディを組み立てる。
 * detourLevel と休憩設定（rest）を渡す。省略時は寄り道度 0・休憩無効。
 */
export function buildPlanRequest(
  origin: Coord,
  destination: Coord,
  detourLevel: number = DEFAULT_DETOUR_LEVEL,
  rest: RestConfig = DEFAULT_REST_CONFIG
): PlanRequest {
  return {
    origin,
    destination,
    detourLevel,
    rest
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

/** 休憩種別の表示メタ（ラベル・アイコン）。地図マーカーとパネルで共用する。 */
export const REST_TYPE_META: Record<RestType, { label: string; icon: string }> = {
  konbini: { label: 'コンビニ', icon: '🏪' },
  michinoeki: { label: '道の駅', icon: '🍶' },
  cafe: { label: 'カフェ', icon: '☕' },
  gas: { label: 'GS', icon: '⛽' }
}

/** 経過時間（分）を「◯分後」形式へ整形する（休憩の到達目安表示に使う）。 */
export function formatAtMinute(atMinute: number): string {
  return `${formatDuration(atMinute)}後`
}
