import { describe, expect, it, vi } from 'vitest'
import type { Coord, PlanRequest, Route } from '../types'
import type { DirectionsOptions, MapboxDeps } from './mapbox'
import { parsePlanRequest, planRoute } from './plan'

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
