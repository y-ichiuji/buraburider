// ルート生成結果を表示する下部パネル。
// 距離(km)・所要時間(min) をメーター表現（等幅・大きめ）で見せる。
// 将来（ステップ4/5）は立ち寄り一覧・休憩一覧をここに追加する。

import type { PlanResponse } from '../../server/types'
import { formatDistance, formatDuration } from '../lib/plan'
import type { RoutePlanStatus } from '../hooks/useRoutePlan'

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
    </div>
  )
}

export default RoutePanel
