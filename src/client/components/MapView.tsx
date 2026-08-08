import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef } from 'react'
import type { Coord, LineString, Waypoint } from '../../server/types'
import { DEFAULT_ORIGIN } from '../lib/geo'

/** ダーク基調に合わせた Mapbox スタイル。 */
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'
/** 出発地マーカー色（緑）。 */
const ORIGIN_COLOR = '#34c759'
/** 目的地マーカー色（オレンジ = --primary）。 */
const DEST_COLOR = '#ff6a00'
/** 寄り道経由地マーカー色（ハイライトオレンジ = --primary-hi）。 */
const WAYPOINT_COLOR = '#ff8c3a'
/** ルートライン色（オレンジ = --primary）。 */
const ROUTE_COLOR = '#ff6a00'
/** ルートの下地（casing）色（ほぼ黒 = --bg）。 */
const ROUTE_CASING_COLOR = '#0a0a0b'

/** ルート描画用の source / layer ID。 */
const ROUTE_SOURCE_ID = 'buraburider-route'
const ROUTE_LAYER_ID = 'buraburider-route-line'
const ROUTE_CASING_ID = 'buraburider-route-casing'

/** ルート描画用の layer / source を（存在すれば）地図から取り除く。 */
function removeRouteLayers(map: mapboxgl.Map): void {
  if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID)
  if (map.getLayer(ROUTE_CASING_ID)) map.removeLayer(ROUTE_CASING_ID)
  if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID)
}

export interface MapViewProps {
  /** SSR から渡された public token。null ならフォールバック表示。 */
  token: string | null
  /** 出発地（現在地）。マーカー表示に使う。 */
  origin: Coord | null
  /** 目的地。マーカー表示に使う。 */
  destination: Coord | null
  /** 地図をこの座標へ移動（flyTo）する。参照が変わるたびに移動。 */
  focus: Coord | null
  /** 描画するルートの線形（GeoJSON LineString）。null なら消去。 */
  route: LineString | null
  /** 寄り道の経由地。順に番号付きマーカーを表示する。 */
  waypoints?: Waypoint[]
}

/**
 * Mapbox GL JS による全画面地図。出発地・目的地のマーカー表示と、focus 変更時の flyTo を行う。
 * token が無効な場合は地図を初期化せず、案内用のフォールバックを表示する。
 */
export function MapView({ token, origin, destination, focus, route, waypoints }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const waypointMarkersRef = useRef<mapboxgl.Marker[]>([])

  // 地図の初期化（token 確定後に一度だけ）。
  useEffect(() => {
    const container = containerRef.current
    if (!token || !container || mapRef.current) return

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container,
      style: MAP_STYLE,
      center: focus ?? origin ?? DEFAULT_ORIGIN,
      zoom: 12,
      attributionControl: true
    })
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true
      }),
      'bottom-right'
    )
    mapRef.current = map

    // コンテナのサイズ変化を監視して map.resize() する。
    // スタイルシート（src/style.css）は <link> で非同期に読み込まれるため、
    // 初期化時にコンテナの高さが 0 のまま計測されるとタイルが一切要求されず地図が黒くなる。
    // Mapbox の trackResize は window リサイズしか追わないため、コンテナ自身の
    // サイズ変化（0 → 全画面）を ResizeObserver で捉えて明示的にリサイズする。
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      originMarkerRef.current = null
      destMarkerRef.current = null
      waypointMarkersRef.current = []
    }
    // focus / origin は初期センターとしてのみ使用。以降の移動は別 effect が担う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // 出発地マーカーの更新。
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!origin) {
      originMarkerRef.current?.remove()
      originMarkerRef.current = null
      return
    }
    if (!originMarkerRef.current) {
      originMarkerRef.current = new mapboxgl.Marker({ color: ORIGIN_COLOR })
    }
    originMarkerRef.current.setLngLat(origin).addTo(map)
  }, [origin])

  // 目的地マーカーの更新。
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!destination) {
      destMarkerRef.current?.remove()
      destMarkerRef.current = null
      return
    }
    if (!destMarkerRef.current) {
      destMarkerRef.current = new mapboxgl.Marker({ color: DEST_COLOR })
    }
    destMarkerRef.current.setLngLat(destination).addTo(map)
  }, [destination])

  // 寄り道経由地マーカーの更新。順番の番号を振った小さめのピンを立てる。
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // 既存の経由地マーカーを一旦すべて外す。
    for (const marker of waypointMarkersRef.current) marker.remove()
    waypointMarkersRef.current = []

    const list = waypoints ?? []
    list.forEach((wp, i) => {
      const el = document.createElement('div')
      el.className = 'waypoint-marker'
      el.textContent = String(i + 1)
      el.style.background = WAYPOINT_COLOR
      el.title = wp.name
      const marker = new mapboxgl.Marker({ element: el }).setLngLat(wp.coord).addTo(map)
      waypointMarkersRef.current.push(marker)
    })
  }, [waypoints])

  // focus が変わったら地図を移動。
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo({ center: focus, zoom: Math.max(map.getZoom(), 13), essential: true })
  }, [focus])

  // ルート（LineString）の描画・更新。route が null になったら消去する。
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // スタイル未ロード中に addSource するとエラーになるため、ロード完了を待つ。
    const apply = () => {
      if (!route) {
        removeRouteLayers(map)
        return
      }

      const feature = {
        type: 'Feature' as const,
        properties: {},
        geometry: route
      }

      const source = map.getSource(ROUTE_SOURCE_ID)
      if (source) {
        ;(source as mapboxgl.GeoJSONSource).setData(feature)
      } else {
        map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: feature })
        map.addLayer({
          id: ROUTE_CASING_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ROUTE_CASING_COLOR, 'line-width': 8, 'line-opacity': 0.9 }
        })
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ROUTE_COLOR, 'line-width': 5 }
        })
      }

      // ルート全体が見えるようにフィットさせる（上部の検索 UI 分を空ける）。
      const bounds = new mapboxgl.LngLatBounds()
      for (const coord of route.coordinates) bounds.extend(coord)
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: { top: 180, bottom: 220, left: 48, right: 48 },
          duration: 800
        })
      }
    }

    if (map.isStyleLoaded()) {
      apply()
      return
    }
    map.once('load', apply)
    return () => {
      map.off('load', apply)
    }
  }, [route])

  if (!token) {
    return (
      <div className="map-fallback" role="alert">
        <p className="map-fallback__title">地図を表示できません</p>
        <p className="map-fallback__hint">
          Mapbox public token（MAPBOX_PUBLIC_TOKEN）が未設定です。
          <br />
          wrangler.jsonc の vars か .dev.vars に有効な pk トークンを設定してください。
        </p>
      </div>
    )
  }

  return <div ref={containerRef} className="map-view" />
}

export default MapView
