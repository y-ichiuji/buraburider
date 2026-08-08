import { useCallback, useState } from 'react'
import type { Coord, PlanResponse, RestConfig } from '../../server/types'
import { buildPlanRequest, PLAN_ENDPOINT, type PlanApiResponse } from '../lib/plan'

export type RoutePlanStatus = 'idle' | 'loading' | 'error'

export interface RoutePlanState {
  /** 生成結果。未生成/エラー時は null。 */
  plan: PlanResponse | null
  status: RoutePlanStatus
  /** エラー時のメッセージ（表示用）。 */
  error: string | null
}

export interface UseRoutePlan extends RoutePlanState {
  /** 出発地・目的地・寄り道度・休憩設定からルートを生成する。 */
  generate: (
    origin: Coord,
    destination: Coord,
    detourLevel?: number,
    rest?: RestConfig
  ) => Promise<void>
  /** 生成結果をクリアする。 */
  reset: () => void
}

const INITIAL: RoutePlanState = { plan: null, status: 'idle', error: null }

/**
 * `POST /api/routes/plan` を呼んでルートを生成するフック。
 * ローディング / エラー状態を保持する。地図描画は結果の route.geojson を上位で渡す。
 */
export function useRoutePlan(): UseRoutePlan {
  const [state, setState] = useState<RoutePlanState>(INITIAL)

  const generate = useCallback(
    async (origin: Coord, destination: Coord, detourLevel?: number, rest?: RestConfig) => {
      setState({ plan: null, status: 'loading', error: null })
      try {
        const res = await fetch(PLAN_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildPlanRequest(origin, destination, detourLevel, rest))
        })
        const data = (await res.json()) as PlanApiResponse
        if (!res.ok || 'error' in data) {
          const message = 'error' in data ? data.error : `ルート生成に失敗しました (${res.status})`
          setState({ plan: null, status: 'error', error: message })
          return
        }
        setState({ plan: data, status: 'idle', error: null })
      } catch {
        setState({ plan: null, status: 'error', error: 'ルート生成に失敗しました' })
      }
    },
    []
  )

  const reset = useCallback(() => setState(INITIAL), [])

  return { ...state, generate, reset }
}
