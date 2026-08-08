import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORIGIN } from '../lib/geo'
import { useGeolocation } from './useGeolocation'

/** navigator.geolocation を差し替える（happy-dom は未実装のため直接定義する）。 */
function setGeolocation(value: Geolocation | undefined): void {
  Object.defineProperty(navigator, 'geolocation', {
    value,
    configurable: true,
    writable: true
  })
}

describe('useGeolocation', () => {
  afterEach(() => {
    setGeolocation(undefined)
    vi.restoreAllMocks()
  })

  it('取得成功で座標と success を返す', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { longitude: 135.5, latitude: 34.7 } } as GeolocationPosition)
    })
    setGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useGeolocation())

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.coord).toEqual([135.5, 34.7])
    expect(getCurrentPosition).toHaveBeenCalledOnce()
  })

  it('未許可・失敗時は東京駅フォールバックと fallback を返す', async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError)
      }
    )
    setGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useGeolocation())

    await waitFor(() => expect(result.current.status).toBe('fallback'))
    expect(result.current.coord).toEqual(DEFAULT_ORIGIN)
  })

  it('非対応（geolocation なし）なら即フォールバック', async () => {
    setGeolocation(undefined)

    const { result } = renderHook(() => useGeolocation())

    await waitFor(() => expect(result.current.status).toBe('fallback'))
    expect(result.current.coord).toEqual(DEFAULT_ORIGIN)
  })

  it('取得中は locating（初期状態は東京駅）', () => {
    // コールバックを呼ばないモック = 取得中のまま。
    const getCurrentPosition = vi.fn()
    setGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useGeolocation())

    expect(result.current.status).toBe('locating')
    expect(result.current.coord).toEqual(DEFAULT_ORIGIN)
  })

  it('高精度オプション付きで getCurrentPosition を呼ぶ', () => {
    const getCurrentPosition = vi.fn()
    setGeolocation({ getCurrentPosition } as unknown as Geolocation)

    renderHook(() => useGeolocation())

    const options = getCurrentPosition.mock.calls[0]?.[2] as PositionOptions
    expect(options.enableHighAccuracy).toBe(true)
  })
})
