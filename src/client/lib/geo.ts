// 現在地（Geolocation）関連の純粋ロジック。
// React 非依存で、useGeolocation フックとユニットテストの双方から利用する。

import type { Coord } from '../../server/types'

/** 現在地を取得できない場合のフォールバック座標（東京駅）。 */
export const DEFAULT_ORIGIN: Coord = [139.767, 35.681]

/** Geolocation API の position を Coord（[lng, lat]）に変換する。 */
export function positionToCoord(position: GeolocationPosition): Coord {
  return [position.coords.longitude, position.coords.latitude]
}
