import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { PlanResponse } from '../server/types'

// RideSession（Agents SDK の Durable Object）を miniflare のローカル模擬で検証する。
// @callable メソッドは通常の public メソッドでもあるため、DO の RPC スタブから直接呼べる。

function fakeRoute(distanceKm: number): PlanResponse {
  return {
    route: {
      geojson: {
        type: 'LineString',
        coordinates: [
          [139.767, 35.681],
          [138.727, 35.36]
        ]
      },
      distanceKm,
      durationMin: 120
    },
    waypoints: [],
    rests: []
  }
}

describe('RideSession DO', () => {
  it('初期状態は空セッション', async () => {
    const stub = env.RideSession.getByName('ride-initial')
    const state = await stub.getSnapshot()
    expect(state.route).toBeNull()
    expect(state.progress).toBe(0)
    expect(state.sosActive).toBe(false)
    expect(state.routeBeforeSos).toBeNull()
  })

  it('setRoute でルートを設定し進捗を 0 に戻す', async () => {
    const stub = env.RideSession.getByName('ride-setroute')
    const state = await stub.setRoute(fakeRoute(100))
    expect(state.route?.route.distanceKm).toBe(100)
    expect(state.progress).toBe(0)
  })

  it('updateProgress は 0〜1 にクランプする', async () => {
    const stub = env.RideSession.getByName('ride-progress')
    expect((await stub.updateProgress(0.5)).progress).toBe(0.5)
    expect((await stub.updateProgress(2)).progress).toBe(1)
    expect((await stub.updateProgress(-1)).progress).toBe(0)
  })

  it('startSos で元ルートを退避し、resume で復帰する', async () => {
    const stub = env.RideSession.getByName('ride-sos')
    await stub.setRoute(fakeRoute(150))

    const sos = await stub.startSos()
    expect(sos.sosActive).toBe(true)
    expect(sos.routeBeforeSos?.route.distanceKm).toBe(150)

    const resumed = await stub.resume()
    expect(resumed.sosActive).toBe(false)
    expect(resumed.routeBeforeSos).toBeNull()
    expect(resumed.route?.route.distanceKm).toBe(150)
  })

  it('startSos は多重発動しても元ルートを上書きしない', async () => {
    const stub = env.RideSession.getByName('ride-sos-twice')
    await stub.setRoute(fakeRoute(200))
    await stub.startSos()
    const second = await stub.startSos()
    expect(second.routeBeforeSos?.route.distanceKm).toBe(200)
  })

  it('インスタンスは name ごとに独立する', async () => {
    const a = env.RideSession.getByName('ride-a')
    const b = env.RideSession.getByName('ride-b')
    await a.setRoute(fakeRoute(10))
    expect((await b.getSnapshot()).route).toBeNull()
    expect((await a.getSnapshot()).route?.route.distanceKm).toBe(10)
  })
})
