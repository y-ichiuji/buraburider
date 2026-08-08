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

// --- ルート生成 API（POST /api/routes/plan）の入出力契約 -------------------
// architecture.md §5 の契約に対応。クライアント（src/client）とも共有する。

/** 休憩モード。UI の休憩設定に対応し、Mapbox 検索カテゴリへマッピングされる。 */
export type RestMode = 'konbini' | 'local' | 'cafe' | 'emergency'

/** 休憩スケジューリングの設定（リクエストの `rest`）。 */
export interface RestConfig {
  /** 休憩挿入を有効にするか。 */
  enabled: boolean
  /** 休憩間隔（分）。例: 90 =「1時間半ごと」。 */
  intervalMinutes: number
  /** 休憩モード。 */
  mode: RestMode
}

/** `POST /api/routes/plan` のリクエストボディ。 */
export interface PlanRequest {
  /** 出発地 `[lng, lat]`。 */
  origin: Coord
  /** 目的地 `[lng, lat]`。 */
  destination: Coord
  /** 寄り道度スライダー（0〜5）。ステップ3では未使用（素のルート）。 */
  detourLevel: number
  /** 休憩設定。ステップ3では未使用（`rests: []`）。 */
  rest: RestConfig
}

/** `POST /api/routes/plan` のレスポンスボディ。 */
export interface PlanResponse {
  /** 生成されたルート要約。 */
  route: Route
  /** 挿入された立ち寄り経由地（ステップ3では空）。 */
  waypoints: Waypoint[]
  /** 挿入された休憩ポイント（ステップ3では空）。 */
  rests: Rest[]
}

// --- 路面報告 API（③ 安全・快適ルーティングの土台）------------------------
// architecture.md §4 の D1 スキーマ `road_reports` に対応。

/** 路面ハザードの種別。砂利・落ち葉・凍結。 */
export type HazardType = 'gravel' | 'leaves' | 'ice'

/** 路面報告（D1 `road_reports` の1レコードを正規化した形）。 */
export interface RoadReport {
  /** 一意な報告 ID（UUID）。 */
  id: string
  /** 報告地点の経度。 */
  lng: number
  /** 報告地点の緯度。 */
  lat: number
  /** ハザード種別。 */
  hazard: HazardType
  /** 報告時刻（epoch ms）。 */
  reportedAt: number
}

/** `POST /api/reports` のリクエストボディ。 */
export interface CreateReportRequest {
  /** 報告地点 `[lng, lat]`。 */
  coord: Coord
  /** ハザード種別。 */
  hazard: HazardType
}

/** 路面報告の一覧取得に使う矩形範囲 `[minLng, minLat, maxLng, maxLat]`。 */
export type Bbox = [number, number, number, number]

// --- 走行セッション（④ SOS の土台、RideSession Durable Object の状態）------
// architecture.md §4 の Durable Objects（RideSession）に対応。1 ライド = 1 インスタンス。

/** RideSession Durable Object が保持する走行セッション状態。 */
export interface RideSessionState {
  /** 現在ナビ中のルート計画。未開始なら null。 */
  route: PlanResponse | null
  /** 進捗（0〜1）。ルート線上の進行度合いの近似。 */
  progress: number
  /** SOS 発動中か。 */
  sosActive: boolean
  /** SOS 発動前の元ルート（復帰用に退避）。未発動なら null。 */
  routeBeforeSos: PlanResponse | null
}
