import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Coord, PlanResponse, RestConfig } from '../../server/types'
import { buildPlanRequest, PLAN_ENDPOINT } from '../lib/plan'
import { useRoutePlan } from './useRoutePlan'

const ORIGIN: Coord = [139.767, 35.681]
const DEST: Coord = [138.7274, 35.3606]
const REST: RestConfig = { enabled: true, intervalMinutes: 60, mode: 'cafe' }

const PLAN: PlanResponse = {
  route: {
    geojson: { type: 'LineString', coordinates: [ORIGIN, DEST] },
    distanceKm: 12.3,
    durationMin: 95
  },
  waypoints: [],
  rests: []
}

describe('useRoutePlan', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('初期状態は idle / plan null', () => {
    const { result } = renderHook(() => useRoutePlan())
    expect(result.current.status).toBe('idle')
    expect(result.current.plan).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('generate で loading → success へ遷移し、detourLevel/rest を body に渡す', async () => {
    let resolveFetch: (res: Response) => void = () => {}
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRoutePlan())

    let genPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      genPromise = result.current.generate(ORIGIN, DEST, 3, REST)
    })
    // fetch 応答前は loading。
    expect(result.current.status).toBe('loading')
    expect(result.current.plan).toBeNull()

    await act(async () => {
      resolveFetch({ ok: true, json: async () => PLAN } as Response)
      await genPromise
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.plan).toEqual(PLAN)
    expect(result.current.error).toBeNull()

    // 正しいエンドポイント・メソッド・ボディで叩いている。
    expect(fetchMock).toHaveBeenCalledWith(
      PLAN_ENDPOINT,
      expect.objectContaining({ method: 'POST' })
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual(buildPlanRequest(ORIGIN, DEST, 3, REST))
  })

  it('引数省略時は既定の寄り道度・休憩設定を送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => PLAN } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRoutePlan())
    await act(async () => {
      await result.current.generate(ORIGIN, DEST)
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual(buildPlanRequest(ORIGIN, DEST))
  })

  it('error レスポンス（{ error }）で status error とメッセージ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'ルートが見つかりません' })
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRoutePlan())
    await act(async () => {
      await result.current.generate(ORIGIN, DEST)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('ルートが見つかりません')
    expect(result.current.plan).toBeNull()
  })

  it('fetch 例外時は汎用エラーメッセージ', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRoutePlan())
    await act(async () => {
      await result.current.generate(ORIGIN, DEST)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('ルート生成に失敗しました')
  })

  it('reset で初期状態へ戻す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => PLAN } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRoutePlan())
    await act(async () => {
      await result.current.generate(ORIGIN, DEST)
    })
    expect(result.current.plan).toEqual(PLAN)

    act(() => {
      result.current.reset()
    })
    expect(result.current.plan).toBeNull()
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()
  })
})
