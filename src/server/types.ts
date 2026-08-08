// ブラブライダーの共有ドメイン型。
// サーバー層（routes / services）はここで定義した型のみを介してやり取りし、
// 外部 API（Mapbox など）の生 JSON を上位層へ漏らさない。

/** 経度・緯度のペア `[lng, lat]`（GeoJSON と同じ順序）。 */
export type Coord = [number, number]

/** GeoJSON の LineString。ルートの線形を表す。 */
export interface LineString {
  type: 'LineString'
  coordinates: Coord[]
}

/** Directions API から正規化したルート要約。 */
export interface Route {
  /** ルートの線形（GeoJSON LineString）。 */
  geojson: LineString
  /** 総距離（km、小数第1位まで）。 */
  distanceKm: number
  /** 所要時間（分）。 */
  durationMin: number
}

/** 立ち寄り経由地の種別。 */
export type WaypointType = 'scenic' | 'winding' | 'landmark' | 'poi'

/** 寄り道ルートに挿入する経由地。 */
export interface Waypoint {
  type: WaypointType
  name: string
  coord: Coord
}

/** 休憩スポットの種別（休憩モードに対応）。 */
export type RestType = 'konbini' | 'michinoeki' | 'cafe' | 'gas'

/** ルートに挿入する休憩ポイント。 */
export interface Rest {
  type: RestType
  name: string
  /** 出発からの経過時間（分）でのおおよその挿入位置。 */
  atMinute: number
  coord: Coord
}

/** 検索・POI 由来の汎用スポット。 */
export interface Spot {
  id: string
  name: string
  coord: Coord
  category?: string
  address?: string
}

/** 目的地サジェスト候補（`GET /api/search/suggest` の1件）。 */
export interface SuggestItem {
  id: string
  name: string
  coord: Coord
  /** 整形済みの住所文字列（あれば）。 */
  fullAddress?: string
}
