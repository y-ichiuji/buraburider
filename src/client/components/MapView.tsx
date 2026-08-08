import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef } from 'react'
import type { Coord } from '../../server/types'
import { DEFAULT_ORIGIN } from '../lib/geo'

/** ダーク基調に合わせた Mapbox スタイル。 */
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'
/** 出発地マーカー色（緑）。 */
const ORIGIN_COLOR = '#34c759'
/** 目的地マーカー色（オレンジ = --primary）。 */
const DEST_COLOR = '#ff6a00'

export interface MapViewProps {
  /** SSR から渡された public token。null ならフォールバック表示。 */
  token: string | null
  /** 出発地（現在地）。マーカー表示に使う。 */
  origin: Coord | null
  /** 目的地。マーカー表示に使う。 */
  destination: Coord | null
  /** 地図をこの座標へ移動（flyTo）する。参照が変わるたびに移動。 */
  focus: Coord | null
}

/**
 * Mapbox GL JS による全画面地図。出発地・目的地のマーカー表示と、focus 変更時の flyTo を行う。
 * token が無効な場合は地図を初期化せず、案内用のフォールバックを表示する。
 */
export function MapView({ token, origin, destination, focus }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null)

  // 地図の初期化（token 確定後に一度だけ）。
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
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

    return () => {
      map.remove()
      mapRef.current = null
      originMarkerRef.current = null
      destMarkerRef.current = null
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

  // focus が変わったら地図を移動。
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo({ center: focus, zoom: Math.max(map.getZoom(), 13), essential: true })
  }, [focus])

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
