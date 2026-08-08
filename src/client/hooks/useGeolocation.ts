import { useEffect, useState } from 'react'
import type { Coord } from '../../server/types'
import { DEFAULT_ORIGIN, positionToCoord } from '../lib/geo'

/** 現在地取得の状態。取得成功なら 'success'、失敗/未許可/非対応なら 'fallback'。 */
export type GeoStatus = 'locating' | 'success' | 'fallback'

export interface GeolocationState {
  /** 出発地に使う座標。取得できるまで/失敗時は DEFAULT_ORIGIN。 */
  coord: Coord
  status: GeoStatus
}

/**
 * ブラウザ Geolocation API で現在地を取得し、出発地の初期値として返す。
 * 取得失敗・未許可・非対応時は東京駅（DEFAULT_ORIGIN）へフォールバックする。
 */
export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    coord: DEFAULT_ORIGIN,
    status: 'locating'
  })

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ coord: DEFAULT_ORIGIN, status: 'fallback' })
      return
    }

    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!cancelled) setState({ coord: positionToCoord(position), status: 'success' })
      },
      () => {
        if (!cancelled) setState({ coord: DEFAULT_ORIGIN, status: 'fallback' })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    )

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
