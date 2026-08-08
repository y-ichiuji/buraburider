import { describe, expect, it } from 'vitest'
import type { RoadReport } from '../types'
import {
  DEFAULT_AVOIDANCE_RADIUS_METERS,
  filterAvoidingHazards,
  isNearHazard,
  routeHasHazard
} from './avoidance'

function report(lng: number, lat: number, hazard: RoadReport['hazard'] = 'gravel'): RoadReport {
  return { id: `${lng},${lat}`, lng, lat, hazard, reportedAt: 0 }
}

describe('isNearHazard', () => {
  it('報告地点そのものは半径内', () => {
    expect(isNearHazard([139.0, 35.0], [report(139.0, 35.0)])).toBe(true)
  })

  it('遠く離れた点は半径外', () => {
    // 経度 0.1 度 ≈ 約 9km（緯度35度）。既定半径 150m より遥かに遠い。
    expect(isNearHazard([139.1, 35.0], [report(139.0, 35.0)])).toBe(false)
  })

  it('報告が空なら常に false', () => {
    expect(isNearHazard([139.0, 35.0], [])).toBe(false)
  })

  it('半径を広げれば範囲内になる', () => {
    // 経度 0.001 度 ≈ 約 91m。既定 150m 内、10m だと範囲外。
    const coord: [number, number] = [139.001, 35.0]
    expect(isNearHazard(coord, [report(139.0, 35.0)], DEFAULT_AVOIDANCE_RADIUS_METERS)).toBe(true)
    expect(isNearHazard(coord, [report(139.0, 35.0)], 10)).toBe(false)
  })
})

describe('filterAvoidingHazards', () => {
  it('ハザード付近の候補を除外し、それ以外を残す', () => {
    const candidates = [
      { name: 'near', coord: [139.0, 35.0] as [number, number] },
      { name: 'far', coord: [139.5, 35.5] as [number, number] }
    ]
    const kept = filterAvoidingHazards(candidates, [report(139.0, 35.0)])
    expect(kept.map((c) => c.name)).toEqual(['far'])
  })

  it('報告が空なら全件そのまま（コピーを返す）', () => {
    const candidates = [{ coord: [139.0, 35.0] as [number, number] }]
    const kept = filterAvoidingHazards(candidates, [])
    expect(kept).toHaveLength(1)
    expect(kept).not.toBe(candidates)
  })
})

describe('routeHasHazard', () => {
  const path: [number, number][] = [
    [139.0, 35.0],
    [139.2, 35.2],
    [139.4, 35.4]
  ]

  it('ルート頂点付近にハザードがあれば true', () => {
    expect(routeHasHazard(path, [report(139.2, 35.2)])).toBe(true)
  })

  it('どの頂点からも遠ければ false', () => {
    expect(routeHasHazard(path, [report(150.0, 40.0)])).toBe(false)
  })

  it('報告が空なら false', () => {
    expect(routeHasHazard(path, [])).toBe(false)
  })
})
