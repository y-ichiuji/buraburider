import { describe, expect, it, vi } from 'vitest'
import type { Coord, LineString, Route, Spot, SuggestItem } from '../types'
import type { MapboxDeps } from './mapbox'
import {
  computeRestMinutes,
  MAX_RESTS,
  pickNearestToRoute,
  pointAtRouteFraction,
  restSearchSpec,
  scheduleRests
} from './rest'

// 経度方向にまっすぐ伸びる単純なルート（弧長 ≈ 距離比例）。
const straightLine: LineString = {
  type: 'LineString',
  coordinates: [
    [139.0, 35.0],
    [139.5, 35.0],
    [140.0, 35.0]
  ]
}

function routeWith(durationMin: number, line: LineString = straightLine): Route {
  return { geojson: line, distanceKm: 100, durationMin }
}

// --- computeRestMinutes -----------------------------------------------------

describe('computeRestMinutes', () => {
  it('interval ごとの挿入タイミングを返す（目的地手前まで）', () => {
    expect(computeRestMinutes(214, 90)).toEqual([90, 180])
  })

  it('総所要時間が interval 未満なら空', () => {
    expect(computeRestMinutes(80, 90)).toEqual([])
  })

  it('ちょうど倍数の位置（duration と等しい mark）は含めない', () => {
    // 180 は duration 180 と等しいので含めない（目的地に休憩を置かない）。
    expect(computeRestMinutes(180, 90)).toEqual([90])
  })

  it('不正な入力は空を返す', () => {
    expect(computeRestMinutes(0, 90)).toEqual([])
    expect(computeRestMinutes(200, 0)).toEqual([])
    expect(computeRestMinutes(Number.NaN, 90)).toEqual([])
  })

  it('MAX_RESTS 件でクランプする', () => {
    const marks = computeRestMinutes(100000, 10)
    expect(marks).toHaveLength(MAX_RESTS)
  })
})

// --- pointAtRouteFraction ---------------------------------------------------

describe('pointAtRouteFraction', () => {
  it('fraction 0 は始点、1 は終点', () => {
    expect(pointAtRouteFraction(straightLine, 0)).toEqual([139.0, 35.0])
    expect(pointAtRouteFraction(straightLine, 1)).toEqual([140.0, 35.0])
  })

  it('fraction 0.5 はほぼ中点', () => {
    const p = pointAtRouteFraction(straightLine, 0.5)
    expect(p[0]).toBeCloseTo(139.5, 3)
    expect(p[1]).toBeCloseTo(35.0, 5)
  })

  it('範囲外の fraction はクランプする', () => {
    expect(pointAtRouteFraction(straightLine, -1)).toEqual([139.0, 35.0])
    expect(pointAtRouteFraction(straightLine, 2)).toEqual([140.0, 35.0])
  })

  it('単一点の LineString はその点を返す', () => {
    const single: LineString = { type: 'LineString', coordinates: [[139, 35]] }
    expect(pointAtRouteFraction(single, 0.7)).toEqual([139, 35])
  })
})

// --- restSearchSpec ---------------------------------------------------------

describe('restSearchSpec', () => {
  it('モードごとに種別・カテゴリを対応づける', () => {
    expect(restSearchSpec('konbini')).toEqual({
      restType: 'konbini',
      categories: ['convenience_store'],
      forwardQueries: []
    })
    expect(restSearchSpec('local').restType).toBe('michinoeki')
    expect(restSearchSpec('local').forwardQueries).toContain('道の駅')
    expect(restSearchSpec('cafe').restType).toBe('cafe')
    expect(restSearchSpec('cafe').categories).toContain('cafe')
    expect(restSearchSpec('emergency')).toEqual({
      restType: 'gas',
      categories: ['gas_station'],
      forwardQueries: []
    })
  })
})

// --- pickNearestToRoute -----------------------------------------------------

describe('pickNearestToRoute', () => {
  const path: Coord[] = straightLine.coordinates

  it('ルートに最も近い候補を選ぶ', () => {
    const candidates = [
      { id: 'far', name: '遠い', coord: [139.5, 35.05] as Coord },
      { id: 'near', name: '近い', coord: [139.5, 35.001] as Coord }
    ]
    expect(pickNearestToRoute(candidates, path, new Set())?.id).toBe('near')
  })

  it('使用済み ID は除外する', () => {
    const candidates = [{ id: 'near', name: '近い', coord: [139.5, 35.001] as Coord }]
    expect(pickNearestToRoute(candidates, path, new Set(['near']))).toBeNull()
  })

  it('ルートから遠すぎる候補は採用しない', () => {
    const candidates = [{ id: 'x', name: '遠すぎ', coord: [139.5, 36.5] as Coord }]
    expect(pickNearestToRoute(candidates, path, new Set())).toBeNull()
  })
})

// --- scheduleRests ----------------------------------------------------------

describe('scheduleRests', () => {
  const baseDeps: { mapbox: MapboxDeps } = { mapbox: { token: 't' } }

  function makeSearchCategory(spotsByCall: Spot[]) {
    return vi.fn(
      (_category: string, _opts: { proximity: Coord; limit?: number }, _deps: MapboxDeps) =>
        Promise.resolve(spotsByCall)
    )
  }

  it('無効なら空配列（検索しない）', async () => {
    const searchCategory = makeSearchCategory([])
    const result = await scheduleRests(
      routeWith(214),
      { enabled: false, intervalMinutes: 90, mode: 'konbini' },
      { ...baseDeps, searchCategory }
    )
    expect(result).toEqual([])
    expect(searchCategory).not.toHaveBeenCalled()
  })

  it('各タイミングで近傍スポットを選び Rest を組み立てる', async () => {
    // 呼び出しごとに別 ID のスポットを返す（重複除去で消えないように）。
    let call = 0
    const searchCategory = vi.fn(
      (_category: string, _opts: { proximity: Coord; limit?: number }, _deps: MapboxDeps) => {
        call += 1
        return Promise.resolve<Spot[]>([
          {
            id: `s${call}`,
            name: 'コンビニ沿道店',
            coord: [139.4, 35.0],
            category: 'convenience_store'
          }
        ])
      }
    )
    const result = await scheduleRests(
      routeWith(214),
      { enabled: true, intervalMinutes: 90, mode: 'konbini' },
      { ...baseDeps, searchCategory }
    )
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('konbini')
    expect(result[0].atMinute).toBe(90)
    expect(result[1].atMinute).toBe(180)
    expect(result[0].name).toBe('コンビニ沿道店')
  })

  it('スポットが無いタイミングはスキップする', async () => {
    const searchCategory = makeSearchCategory([])
    const result = await scheduleRests(
      routeWith(214),
      { enabled: true, intervalMinutes: 90, mode: 'konbini' },
      { ...baseDeps, searchCategory }
    )
    expect(result).toEqual([])
  })

  it('同一スポットを 2 回採用しない（重複除去）', async () => {
    // 常に同じ 1 件だけ返す → 1 件目で使用済みになり 2 件目はスキップ。
    const searchCategory = makeSearchCategory([
      { id: 'dup', name: '唯一の店', coord: [139.5, 35.0], category: 'convenience_store' }
    ])
    const result = await scheduleRests(
      routeWith(214),
      { enabled: true, intervalMinutes: 90, mode: 'konbini' },
      { ...baseDeps, searchCategory }
    )
    expect(result).toHaveLength(1)
  })

  it('local モードは道の駅の forward 検索結果も候補に含める', async () => {
    const searchCategory = makeSearchCategory([])
    const geocodeForward = vi.fn(
      (_q: string, _opts: { proximity?: Coord; limit?: number }, _deps: MapboxDeps) =>
        Promise.resolve<SuggestItem[]>([
          { id: 'm1', name: '道の駅なんとか', coord: [139.5, 35.001] }
        ])
    )
    const result = await scheduleRests(
      routeWith(120),
      { enabled: true, intervalMinutes: 90, mode: 'local' },
      { ...baseDeps, searchCategory, geocodeForward }
    )
    expect(geocodeForward).toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('michinoeki')
    expect(result[0].name).toBe('道の駅なんとか')
  })

  it('検索が投げても全体は止まらない（該当なし扱い）', async () => {
    const searchCategory = vi.fn(async () => {
      throw new Error('search down')
    })
    const result = await scheduleRests(
      routeWith(214),
      { enabled: true, intervalMinutes: 90, mode: 'konbini' },
      { ...baseDeps, searchCategory }
    )
    expect(result).toEqual([])
  })
})
