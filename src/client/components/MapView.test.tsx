import { render, screen } from '@testing-library/react'
import mapboxgl from 'mapbox-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LineString, Rest, Waypoint } from '../../server/types'
import { MapView } from './MapView'

// mapbox-gl は happy-dom（WebGL 無し）では動かないためモックする。
// 各コンストラクタを vi.fn 化し、地図/マーカー/レイヤ操作の呼び出しを検証できるようにする。
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}))
vi.mock('mapbox-gl', () => {
  const makeMap = () => ({
    addControl: vi.fn(),
    getLayer: vi.fn(() => undefined),
    removeLayer: vi.fn(),
    getSource: vi.fn(() => undefined),
    removeSource: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    once: vi.fn(),
    off: vi.fn(),
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn(() => 12),
    resize: vi.fn(),
    remove: vi.fn()
  })
  // new で呼ばれるため実装は通常関数（アロー関数はコンストラクタ不可）。
  const Map = vi.fn(function () {
    return makeMap()
  })
  const Marker = vi.fn(function () {
    const marker = {
      setLngLat: vi.fn(() => marker),
      addTo: vi.fn(() => marker),
      remove: vi.fn(() => marker)
    }
    return marker
  })
  const NavigationControl = vi.fn()
  const GeolocateControl = vi.fn()
  const LngLatBounds = vi.fn(function () {
    const bounds = { extend: vi.fn(() => bounds), isEmpty: vi.fn(() => false) }
    return bounds
  })
  return {
    default: { accessToken: '', Map, Marker, NavigationControl, GeolocateControl, LngLatBounds }
  }
})

const MapMock = vi.mocked(mapboxgl.Map)
const MarkerMock = vi.mocked(mapboxgl.Marker)

/** 直近に生成された地図インスタンス（モック）を取り出す。各メソッドは vi.fn。 */
function lastMap() {
  const results = MapMock.mock.results
  return results[results.length - 1]?.value as unknown as Record<string, ReturnType<typeof vi.fn>>
}

const ROUTE: LineString = {
  type: 'LineString',
  coordinates: [
    [139, 35],
    [138, 34]
  ]
}

describe('MapView', () => {
  beforeEach(() => {
    // ResizeObserver は happy-dom に無いためスタブする。
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('token 無効時はフォールバックを表示し地図を作らない', () => {
    render(<MapView token={null} origin={null} destination={null} focus={null} route={null} />)

    expect(screen.getByText('地図を表示できません')).toBeInTheDocument()
    expect(MapMock).not.toHaveBeenCalled()
  })

  it('token 有効時に地図を初期化し accessToken を設定する', () => {
    render(
      <MapView token="pk.valid" origin={[139, 35]} destination={null} focus={null} route={null} />
    )

    expect(MapMock).toHaveBeenCalledOnce()
    expect(mapboxgl.accessToken).toBe('pk.valid')
    // ナビ / 現在地コントロールを追加している。
    expect(lastMap().addControl).toHaveBeenCalledTimes(2)
  })

  it('origin / destination のマーカーを設置する', () => {
    render(
      <MapView
        token="pk.valid"
        origin={[139, 35]}
        destination={[138, 34]}
        focus={null}
        route={null}
      />
    )

    // 出発地・目的地の2マーカー。
    expect(MarkerMock).toHaveBeenCalledTimes(2)
    for (const result of MarkerMock.mock.results) {
      expect(result.value.setLngLat).toHaveBeenCalled()
      expect(result.value.addTo).toHaveBeenCalled()
    }
  })

  it('waypoints / rests のマーカーを設置する', () => {
    const waypoints: Waypoint[] = [{ type: 'scenic', name: '峠', coord: [139.1, 35.1] }]
    const rests: Rest[] = [
      { type: 'konbini', name: 'ローソン', atMinute: 60, coord: [139.2, 35.2] }
    ]
    render(
      <MapView
        token="pk.valid"
        origin={null}
        destination={null}
        focus={null}
        route={null}
        waypoints={waypoints}
        rests={rests}
      />
    )

    // waypoint 1 + rest 1 の2マーカー（origin/dest は null）。
    expect(MarkerMock).toHaveBeenCalledTimes(2)
  })

  it('route を渡すと source / layer を追加し fitBounds する', () => {
    render(<MapView token="pk.valid" origin={null} destination={null} focus={null} route={ROUTE} />)

    const map = lastMap()
    expect(map.addSource).toHaveBeenCalledWith('buraburider-route', expect.anything())
    expect(map.addLayer).toHaveBeenCalledTimes(2) // casing + line
    expect(map.fitBounds).toHaveBeenCalled()
  })

  it('focus 変更で flyTo する', () => {
    const { rerender } = render(
      <MapView token="pk.valid" origin={[139, 35]} destination={null} focus={null} route={null} />
    )
    const map = lastMap()

    rerender(
      <MapView
        token="pk.valid"
        origin={[139, 35]}
        destination={null}
        focus={[138, 34]}
        route={null}
      />
    )

    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [138, 34] }))
  })

  it('アンマウントで地図を破棄する', () => {
    const { unmount } = render(
      <MapView token="pk.valid" origin={[139, 35]} destination={null} focus={null} route={null} />
    )
    const map = lastMap()

    unmount()
    expect(map.remove).toHaveBeenCalled()
  })
})
