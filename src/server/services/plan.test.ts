import { describe, expect, it, vi } from 'vitest'
import type { Coord, PlanRequest, Rest, RestConfig, Route, Spot, Waypoint } from '../types'
import type { CollectSpotsOptions, DirectionsOptions, MapboxDeps } from './mapbox'
import {
  DETOUR_LEVEL_MAX,
  detourParamsForLevel,
  MAX_DETOUR_WAYPOINTS,
  mergeIntermediateCoords,
  parsePlanRequest,
  planRoute
} from './plan'
import type { RestDeps } from './rest'

/** getDirections の型付きモックを作る（mock.calls を型安全に検証するため）。 */
function makeGetDirections(impl: () => Promise<Route>) {
  return vi.fn((_coords: Coord[], _opts: DirectionsOptions, _deps: MapboxDeps) => impl())
}

// --- テスト用のダミー Route -----------------------------------------------

const fakeRoute: Route = {
  geojson: {
    type: 'LineString',
    coordinates: [
      [139.767, 35.681],
      [138.727, 35.36]
    ]
  },
  distanceKm: 152.4,
  durationMin: 214
}

const validRequest: PlanRequest = {
  origin: [139.767, 35.681],
  destination: [138.727, 35.36],
  detourLevel: 0,
  rest: { enabled: false, intervalMinutes: 90, mode: 'konbini' }
}

// --- planRoute --------------------------------------------------------------

describe('planRoute', () => {
  it('経由地なしで [origin, destination] を getDirections に渡す', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    await planRoute(validRequest, { mapbox: { token: 't' }, getDirections })

    expect(getDirections).toHaveBeenCalledTimes(1)
    const passedCoords = getDirections.mock.calls[0][0]
    expect(passedCoords).toEqual([validRequest.origin, validRequest.destination])
  })

  it('mapbox 依存を getDirections に引き渡す', async () => {
    const cache = {} as KVNamespace
    const getDirections = makeGetDirections(async () => fakeRoute)
    await planRoute(validRequest, { mapbox: { token: 'secret', cache }, getDirections })

    const passedDeps = getDirections.mock.calls[0][2]
    expect(passedDeps).toEqual({ token: 'secret', cache })
  })

  it('route と 空の waypoints / rests を返す', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const result = await planRoute(validRequest, { mapbox: { token: 't' }, getDirections })

    expect(result).toEqual({ route: fakeRoute, waypoints: [], rests: [] })
  })

  it('getDirections が投げたエラーはそのまま伝播する', async () => {
    const getDirections = makeGetDirections(async () => {
      throw new Error('boom')
    })
    await expect(
      planRoute(validRequest, { mapbox: { token: 't' }, getDirections })
    ).rejects.toThrow('boom')
  })
})

// --- detourParamsForLevel ---------------------------------------------------

describe('detourParamsForLevel', () => {
  it('level 0 は寄り道なし（waypointCount 0）', () => {
    expect(detourParamsForLevel(0).waypointCount).toBe(0)
  })

  it('level が上がるほど経由地数・探索点数・遠回り許容が増える', () => {
    let prev = detourParamsForLevel(1)
    for (let level = 2; level <= DETOUR_LEVEL_MAX; level++) {
      const cur = detourParamsForLevel(level)
      expect(cur.waypointCount).toBeGreaterThanOrEqual(prev.waypointCount)
      expect(cur.maxSpotDistanceMeters).toBeGreaterThanOrEqual(prev.maxSpotDistanceMeters)
      prev = cur
    }
  })

  it('範囲外はクランプする', () => {
    expect(detourParamsForLevel(-3)).toEqual(detourParamsForLevel(0))
    expect(detourParamsForLevel(99)).toEqual(detourParamsForLevel(DETOUR_LEVEL_MAX))
  })
})

// --- planRoute（寄り道あり）------------------------------------------------

describe('planRoute（detourLevel >= 1）', () => {
  const detourRequest: PlanRequest = { ...validRequest, detourLevel: 3 }

  const candidateSpots: Spot[] = [
    { id: 'a', name: '展望台A', coord: [139.2, 35.5], category: 'viewpoint' },
    { id: 'b', name: '公園B', coord: [138.9, 35.4], category: 'park' }
  ]

  const selectedWaypoints: Waypoint[] = [
    { type: 'scenic', name: '展望台A', coord: [139.2, 35.5] },
    { type: 'poi', name: '公園B', coord: [138.9, 35.4] }
  ]

  function makeCollect(spots: Spot[]) {
    return vi.fn((_route: Route, _opts: CollectSpotsOptions, _deps: MapboxDeps) =>
      Promise.resolve(spots)
    )
  }

  /** selectWaypoints の型付きモック（mock.calls を型安全に検証するため）。 */
  function makeSelect(result: Waypoint[]) {
    return vi.fn(
      (_spots: Spot[], _route: Route, _level: number, _count: number, _deps: { ai?: Ai }) =>
        Promise.resolve(result)
    )
  }

  it('基本ルート取得→候補収集→選定→経由地入りで再計算する', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const collectSpots = makeCollect(candidateSpots)
    const selectWaypoints = vi.fn(async () => selectedWaypoints)

    const result = await planRoute(detourRequest, {
      mapbox: { token: 't' },
      getDirections,
      collectSpots,
      selectWaypoints
    })

    // 基本ルート + 経由地入り再計算で 2 回呼ばれる。
    expect(getDirections).toHaveBeenCalledTimes(2)
    // 2 回目は origin, 経由地×2, destination。
    const secondCoords = getDirections.mock.calls[1][0]
    expect(secondCoords).toEqual([
      detourRequest.origin,
      [139.2, 35.5],
      [138.9, 35.4],
      detourRequest.destination
    ])
    expect(result.waypoints).toEqual(selectedWaypoints)
  })

  it('選定 count は detourParamsForLevel に一致する', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const selectWaypoints = makeSelect(selectedWaypoints)
    await planRoute(detourRequest, {
      mapbox: { token: 't' },
      getDirections,
      collectSpots: makeCollect(candidateSpots),
      selectWaypoints
    })
    const passedCount = selectWaypoints.mock.calls[0][3]
    expect(passedCount).toBe(detourParamsForLevel(3).waypointCount)
  })

  it('候補収集が失敗しても基本ルートへフォールバックする', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const collectSpots = vi.fn(async () => {
      throw new Error('search down')
    })
    const selectWaypoints = vi.fn(async () => selectedWaypoints)

    const result = await planRoute(detourRequest, {
      mapbox: { token: 't' },
      getDirections,
      collectSpots,
      selectWaypoints
    })

    expect(result.waypoints).toEqual([])
    // 再計算はせず基本ルートのみ（1 回）。
    expect(getDirections).toHaveBeenCalledTimes(1)
    expect(result.route).toEqual(fakeRoute)
  })

  it('経由地ゼロ選定なら基本ルートを返す（再計算しない）', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const result = await planRoute(detourRequest, {
      mapbox: { token: 't' },
      getDirections,
      collectSpots: makeCollect([]),
      selectWaypoints: vi.fn(async () => [])
    })
    expect(result.waypoints).toEqual([])
    expect(getDirections).toHaveBeenCalledTimes(1)
  })

  it('経由地は Directions 上限（23）に収める', async () => {
    const many: Waypoint[] = Array.from({ length: 30 }, (_v, i) => ({
      type: 'poi' as const,
      name: `w${i}`,
      coord: [138 + i * 0.01, 35] as Coord
    }))
    const getDirections = makeGetDirections(async () => fakeRoute)
    const result = await planRoute(detourRequest, {
      mapbox: { token: 't' },
      getDirections,
      collectSpots: makeCollect(candidateSpots),
      selectWaypoints: vi.fn(async () => many)
    })
    expect(result.waypoints).toHaveLength(MAX_DETOUR_WAYPOINTS)
    const secondCoords = getDirections.mock.calls[1][0]
    // origin + 23 + destination = 25
    expect(secondCoords).toHaveLength(MAX_DETOUR_WAYPOINTS + 2)
  })

  it('collectSpots に origin/destination を excludeNear として渡す', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const collectSpots = makeCollect(candidateSpots)
    await planRoute(detourRequest, {
      mapbox: { token: 't' },
      getDirections,
      collectSpots,
      selectWaypoints: makeSelect(selectedWaypoints)
    })
    const passedOpts = collectSpots.mock.calls[0][1]
    expect(passedOpts.excludeNear).toEqual([detourRequest.origin, detourRequest.destination])
  })

  it('ai を選定関数へ引き渡す', async () => {
    const ai = { run: vi.fn() } as unknown as Ai
    const selectWaypoints = makeSelect(selectedWaypoints)
    await planRoute(detourRequest, {
      mapbox: { token: 't' },
      ai,
      getDirections: makeGetDirections(async () => fakeRoute),
      collectSpots: makeCollect(candidateSpots),
      selectWaypoints
    })
    expect(selectWaypoints.mock.calls[0][4]).toEqual({ ai })
  })
})

// --- mergeIntermediateCoords ------------------------------------------------

describe('mergeIntermediateCoords', () => {
  // 4 頂点のまっすぐな基準ルート。各中間点は最寄り頂点で進行順を決める。
  const route: Route = {
    geojson: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0]
      ]
    },
    distanceKm: 10,
    durationMin: 30
  }
  const origin: Coord = [-1, 0]
  const destination: Coord = [4, 0]

  it('寄り道経由地と休憩をルート進行順にマージする', () => {
    const waypoints: Waypoint[] = [{ type: 'scenic', name: 'W', coord: [2, 0] }]
    const rests: Rest[] = [{ type: 'konbini', name: 'R', atMinute: 10, coord: [1, 0] }]
    const coords = mergeIntermediateCoords(origin, destination, waypoints, rests, route)
    // R（index1）→ W（index2）の順に挟む。
    expect(coords).toEqual([origin, [1, 0], [2, 0], destination])
  })

  it('中間点が無ければ [origin, destination] のみ', () => {
    expect(mergeIntermediateCoords(origin, destination, [], [], route)).toEqual([
      origin,
      destination
    ])
  })
})

// --- planRoute（休憩あり）--------------------------------------------------

describe('planRoute（rest.enabled）', () => {
  const restConfig: RestConfig = { enabled: true, intervalMinutes: 90, mode: 'konbini' }
  const restRequest: PlanRequest = { ...validRequest, rest: restConfig }

  const scheduledRests: Rest[] = [
    { type: 'konbini', name: 'コンビニA', atMinute: 90, coord: [139.3, 35.5] }
  ]

  function makeSchedule(result: Rest[]) {
    return vi.fn((_route: Route, _config: RestConfig, _deps: RestDeps) => Promise.resolve(result))
  }

  it('detourLevel 0 でも休憩を挿入して再計算する', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const scheduleRests = makeSchedule(scheduledRests)
    const result = await planRoute(restRequest, {
      mapbox: { token: 't' },
      getDirections,
      scheduleRests
    })

    // 基本ルート + 休憩入り再計算で 2 回。
    expect(getDirections).toHaveBeenCalledTimes(2)
    const finalCoords = getDirections.mock.calls[1][0]
    expect(finalCoords).toEqual([restRequest.origin, [139.3, 35.5], restRequest.destination])
    expect(result.rests).toEqual(scheduledRests)
    expect(result.waypoints).toEqual([])
  })

  it('休憩スケジューリングは寄り道ルートを基準に呼ばれる', async () => {
    const detourRoute: Route = { ...fakeRoute, durationMin: 300 }
    const getDirections = vi.fn((_c: Coord[], _o: DirectionsOptions, _d: MapboxDeps) =>
      Promise.resolve(detourRoute)
    )
    const scheduleRests = makeSchedule(scheduledRests)
    await planRoute(
      { ...restRequest, detourLevel: 3 },
      {
        mapbox: { token: 't' },
        getDirections,
        collectSpots: vi.fn(
          async (): Promise<Spot[]> => [
            { id: 'a', name: '展望台A', coord: [139.2, 35.5], category: 'viewpoint' }
          ]
        ),
        selectWaypoints: vi.fn(
          async (): Promise<Waypoint[]> => [
            { type: 'scenic', name: '展望台A', coord: [139.2, 35.5] }
          ]
        ),
        scheduleRests
      }
    )
    // scheduleRests には寄り道再計算後のルートが渡る。
    expect(scheduleRests.mock.calls[0][0]).toEqual(detourRoute)
    expect(scheduleRests.mock.calls[0][1]).toEqual(restConfig)
  })

  it('休憩ゼロなら再計算しない（寄り道ルートを返す）', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const scheduleRests = makeSchedule([])
    const result = await planRoute(restRequest, {
      mapbox: { token: 't' },
      getDirections,
      scheduleRests
    })
    expect(getDirections).toHaveBeenCalledTimes(1)
    expect(result.rests).toEqual([])
  })

  it('スケジューリングが失敗しても落ちず休憩なしで返す', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const scheduleRests = vi.fn(async () => {
      throw new Error('rest down')
    })
    const result = await planRoute(restRequest, {
      mapbox: { token: 't' },
      getDirections,
      scheduleRests
    })
    expect(result.rests).toEqual([])
    expect(getDirections).toHaveBeenCalledTimes(1)
  })

  it('寄り道が上限を占有していれば休憩はキャップされる', async () => {
    const many: Waypoint[] = Array.from({ length: MAX_DETOUR_WAYPOINTS }, (_v, i) => ({
      type: 'poi' as const,
      name: `w${i}`,
      coord: [138 + i * 0.01, 35] as Coord
    }))
    const getDirections = makeGetDirections(async () => fakeRoute)
    const scheduleRests = makeSchedule(scheduledRests)
    const result = await planRoute(
      { ...restRequest, detourLevel: 5 },
      {
        mapbox: { token: 't' },
        getDirections,
        collectSpots: vi.fn(async () => []),
        selectWaypoints: vi.fn(async () => many),
        scheduleRests
      }
    )
    // 経由地が 23 枠を使い切るので休憩は 0 件にキャップ。
    expect(result.waypoints).toHaveLength(MAX_DETOUR_WAYPOINTS)
    expect(result.rests).toEqual([])
    // base + detour のみ（休憩入り再計算はしない）。
    expect(getDirections).toHaveBeenCalledTimes(2)
  })

  it('rest.enabled=false なら scheduleRests を呼ばない', async () => {
    const getDirections = makeGetDirections(async () => fakeRoute)
    const scheduleRests = makeSchedule(scheduledRests)
    const result = await planRoute(validRequest, {
      mapbox: { token: 't' },
      getDirections,
      scheduleRests
    })
    expect(scheduleRests).not.toHaveBeenCalled()
    expect(result.rests).toEqual([])
  })
})

// --- parsePlanRequest -------------------------------------------------------

describe('parsePlanRequest', () => {
  it('妥当なボディを正規化して返す', () => {
    const result = parsePlanRequest(validRequest)
    expect(result).toEqual({ ok: true, value: validRequest })
  })

  it('rest を省略しても既定値で成功する', () => {
    const result = parsePlanRequest({
      origin: [139.767, 35.681],
      destination: [138.727, 35.36],
      detourLevel: 0
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.rest).toEqual({ enabled: false, intervalMinutes: 90, mode: 'konbini' })
    }
  })

  it('ボディがオブジェクトでなければ失敗する', () => {
    expect(parsePlanRequest(null).ok).toBe(false)
    expect(parsePlanRequest('x').ok).toBe(false)
  })

  it('origin が2要素の数値でなければ失敗する', () => {
    expect(parsePlanRequest({ ...validRequest, origin: [139.767] }).ok).toBe(false)
    expect(parsePlanRequest({ ...validRequest, origin: ['a', 'b'] }).ok).toBe(false)
    expect(parsePlanRequest({ ...validRequest, origin: undefined }).ok).toBe(false)
  })

  it('destination が範囲外なら失敗する', () => {
    expect(parsePlanRequest({ ...validRequest, destination: [200, 35] }).ok).toBe(false)
    expect(parsePlanRequest({ ...validRequest, destination: [139, 100] }).ok).toBe(false)
  })

  it('detourLevel が 0〜5 の整数でなければ失敗する', () => {
    expect(parsePlanRequest({ ...validRequest, detourLevel: -1 }).ok).toBe(false)
    expect(parsePlanRequest({ ...validRequest, detourLevel: 6 }).ok).toBe(false)
    expect(parsePlanRequest({ ...validRequest, detourLevel: 2.5 }).ok).toBe(false)
    expect(parsePlanRequest({ ...validRequest, detourLevel: '3' }).ok).toBe(false)
  })

  it('detourLevel の 0〜5 は全て受け付ける', () => {
    for (const level of [0, 1, 2, 3, 4, 5]) {
      expect(parsePlanRequest({ ...validRequest, detourLevel: level }).ok).toBe(true)
    }
  })

  it('未知の rest.mode は失敗する', () => {
    const result = parsePlanRequest({
      ...validRequest,
      rest: { enabled: true, intervalMinutes: 60, mode: 'unknown' }
    })
    expect(result.ok).toBe(false)
  })

  it('rest.intervalMinutes が正の数でなければ失敗する', () => {
    const result = parsePlanRequest({
      ...validRequest,
      rest: { enabled: true, intervalMinutes: 0, mode: 'cafe' }
    })
    expect(result.ok).toBe(false)
  })
})
