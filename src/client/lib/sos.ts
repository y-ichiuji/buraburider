// SOS ボタン（機能④の土台）の純粋ロジック。
//
// 誤作動防止のため、SOS は「タップ」ではなく「スワイプ」または「1秒長押し」で発動する
// （グローブ操作想定 / 設計 §8・機能④）。ここではジェスチャ判定を DOM 非依存の純粋関数に
// 切り出し、ユニットテスト可能にする。SosButton.tsx はこれらを使って PointerEvent を捌く。
//
// この段階は土台: 発動時の「タイムロス最少の1発自動挿入」や SOS 後の自動復帰は実装しない。
// 発動後は選択カテゴリを視覚フィードバックするに留める（近傍スポット自動挿入はステップ7/将来）。

/** 長押しで発動と見なす保持時間の閾値（ミリ秒）。 */
export const SOS_LONG_PRESS_MS = 1000

/** スワイプで発動と見なす移動距離の閾値（px）。 */
export const SOS_SWIPE_THRESHOLD_PX = 64

/** 画面上の座標（px）。 */
export interface Point {
  x: number
  y: number
}

/** SOS の発動トリガー種別（未発動は null）。 */
export type SosTrigger = 'swipe' | 'longpress' | null

/** SOS カテゴリ（機能④で対象とする3種）。 */
export type SosCategory = 'toilet' | 'gas' | 'shelter'

/** SOS カテゴリの表示メタと、将来の近傍検索カテゴリの対応。 */
export interface SosCategoryMeta {
  category: SosCategory
  label: string
  icon: string
  hint: string
  /**
   * 将来 searchCategory（Mapbox カテゴリ検索）へ渡すためのカテゴリ識別子。
   * ステップ7/将来で「タイムロス最少の1発自動挿入」に接続する差し込み口。
   */
  searchCategory: string
}

/** トイレ / GS / 急な雨宿り（高架下・屋根付き）の3種。 */
export const SOS_CATEGORIES: readonly SosCategoryMeta[] = [
  {
    category: 'toilet',
    label: 'トイレ',
    icon: '🚻',
    hint: '近くのトイレ',
    searchCategory: 'toilet'
  },
  { category: 'gas', label: 'GS', icon: '⛽', hint: '給油', searchCategory: 'gas_station' },
  {
    category: 'shelter',
    label: '雨宿り',
    icon: '☔',
    hint: '高架下・屋根付き',
    searchCategory: 'parking_garage'
  }
]

/** 2点間のユークリッド距離（px）。 */
export function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** 保持時間が長押し閾値に達したか。 */
export function isLongPressReached(heldMs: number): boolean {
  return heldMs >= SOS_LONG_PRESS_MS
}

/** 始点から現在位置までの移動がスワイプ閾値に達したか。 */
export function isSwipeReached(start: Point, current: Point): boolean {
  return pointerDistance(start, current) >= SOS_SWIPE_THRESHOLD_PX
}

/**
 * ポインタの始点・現在位置・保持時間から SOS の発動トリガーを判定する。
 * スワイプ（移動量）を優先し、次に長押し（保持時間）を見る。どちらも未達なら null。
 */
export function evaluateSosGesture(input: {
  start: Point
  current: Point
  heldMs: number
}): SosTrigger {
  if (isSwipeReached(input.start, input.current)) return 'swipe'
  if (isLongPressReached(input.heldMs)) return 'longpress'
  return null
}
