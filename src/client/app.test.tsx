import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanResponse, SuggestItem } from '../server/types'
import App from './app'

// 地図は WebGL 非対応の happy-dom で動かないためモックする（描画は検証しない）。
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
  const LngLatBounds = vi.fn(function () {
    const bounds = { extend: vi.fn(() => bounds), isEmpty: vi.fn(() => false) }
    return bounds
  })
  return {
    default: {
      accessToken: '',
      Map,
      Marker,
      NavigationControl: vi.fn(),
      GeolocateControl: vi.fn(),
      LngLatBounds
    }
  }
})

const DEST_ITEM: SuggestItem = {
  id: 'fuji',
  name: '富士山',
  coord: [138.7274, 35.3606],
  fullAddress: '静岡県'
}

const PLAN: PlanResponse = {
  route: {
    geojson: {
      type: 'LineString',
      coordinates: [
        [139, 35],
        [138, 34]
      ]
    },
    distanceKm: 42.5,
    durationMin: 80
  },
  waypoints: [],
  rests: []
}

/** suggest / plan を URL で振り分ける fetch モック。 */
function stubApiFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith('/api/search/suggest')) {
      return { ok: true, json: async () => ({ items: [DEST_ITEM] }) } as Response
    }
    if (url.startsWith('/api/routes/plan')) {
      return { ok: true, json: async () => PLAN } as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App（統合）', () => {
  beforeEach(() => {
    window.__MAPBOX_TOKEN__ = 'pk.test'
    // 現在地は非対応 → 東京駅フォールバックにする。
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      configurable: true,
      writable: true
    })
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
    delete window.__MAPBOX_TOKEN__
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('目的地未選択ではルート生成ボタンが非活性', () => {
    stubApiFetch()
    render(<App />)
    expect(screen.getByRole('button', { name: 'ルート生成' })).toBeDisabled()
  })

  it('目的地選択→生成ボタン活性→生成で結果パネルを表示', async () => {
    stubApiFetch()
    const user = userEvent.setup()
    render(<App />)

    // 目的地を入力してサジェストから選択。
    await user.type(screen.getByRole('textbox', { name: '目的地' }), '富士')
    await user.click(await screen.findByRole('button', { name: /富士山/ }))

    // 選択で生成ボタンが活性化する。
    const generateBtn = screen.getByRole('button', { name: 'ルート生成' })
    expect(generateBtn).toBeEnabled()

    // 生成でルート結果（距離・所要時間）が表示される。
    await user.click(generateBtn)
    expect(await screen.findByText('42.5')).toBeInTheDocument()
    expect(screen.getByText('1時間20分')).toBeInTheDocument()
  })
})
