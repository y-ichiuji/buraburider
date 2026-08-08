// ルート生成結果を表示する下部パネル。
// 距離(km)・所要時間(min) をメーター表現（等幅・大きめ）で見せる。
// 将来（ステップ4/5）は立ち寄り一覧・休憩一覧をここに追加する。

import type { PlanResponse, WaypointType } from '../../server/types'
import { formatAtMinute, formatDistance, formatDuration, REST_TYPE_META } from '../lib/plan'
import type { RoutePlanStatus } from '../hooks/useRoutePlan'

/** 経由地種別の表示ラベル。 */
const WAYPOINT_TYPE_LABEL: Record<WaypointType, string> = {
  scenic: '絶景',
  winding: 'ワインディング',
  landmark: '名所',
  poi: '立ち寄り'
}

export interface RoutePanelProps {
  plan: PlanResponse | null
  status: RoutePlanStatus
  error: string | null
}

/**
 * ルート生成の状態に応じたパネル。
 * loading 中はプレースホルダ、error 時はメッセージ、成功時はメーターを表示する。
 * いずれでもない（idle かつ未生成）ときは何も描画しない。
 */
export function RoutePanel({ plan, status, error }: RoutePanelProps) {
  if (status === 'loading') {
    return (
      <div className="route-panel" role="status" aria-live="polite">
        <span className="route-panel__loading">ルートを生成中…</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="route-panel route-panel--error" role="alert">
        <span className="route-panel__error">{error ?? 'ルート生成に失敗しました'}</span>
      </div>
    )
  }

  if (!plan) return null

  const waypoints = plan.waypoints
  const rests = plan.rests

  return (
    <div className="route-panel" role="status" aria-live="polite">
      <dl className="meter-row">
        <div className="meter">
          <dt className="meter__label">距離</dt>
          <dd className="meter__value">
            <span className="meter__num">{formatDistance(plan.route.distanceKm)}</span>
            <span className="meter__unit">km</span>
          </dd>
        </div>
        <div className="meter">
          <dt className="meter__label">所要時間</dt>
          <dd className="meter__value">
            <span className="meter__num">{formatDuration(plan.route.durationMin)}</span>
          </dd>
        </div>
      </dl>

      {waypoints.length > 0 && (
        <ol className="stop-list" aria-label="立ち寄りスポット">
          {waypoints.map((wp, i) => (
            <li className="stop-item" key={`${wp.name}-${wp.coord[0]}-${wp.coord[1]}`}>
              <span className="stop-item__index">{i + 1}</span>
              <span className="stop-item__name">{wp.name}</span>
              <span className="stop-item__type">{WAYPOINT_TYPE_LABEL[wp.type]}</span>
            </li>
          ))}
        </ol>
      )}

      {rests.length > 0 && (
        <ul className="rest-list" aria-label="休憩スポット">
          {rests.map((rest) => (
            <li className="rest-item" key={`${rest.name}-${rest.coord[0]}-${rest.coord[1]}`}>
              <span className="rest-item__icon" aria-hidden="true">
                {REST_TYPE_META[rest.type].icon}
              </span>
              <span className="rest-item__at">{formatAtMinute(rest.atMinute)}</span>
              <span className="rest-item__name">{rest.name}</span>
              <span className="rest-item__type">{REST_TYPE_META[rest.type].label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default RoutePanel
