// 目的地サジェスト（GET /api/search/suggest）呼び出しの純粋ロジック。
// React 非依存で、useSuggest フックとユニットテストの双方から利用する。

import type { Coord, SuggestItem } from '../../server/types'

/** サジェスト API のレスポンス形（{ items } または { error }）。 */
export interface SuggestResponse {
  items?: SuggestItem[]
  error?: string
}

/** サジェスト実行までのデバウンス時間（ミリ秒）。 */
export const SUGGEST_DEBOUNCE_MS = 300

/** サジェストを発火する最小クエリ長。これ未満では叩かない。 */
export const SUGGEST_MIN_QUERY_LENGTH = 2

/** proximity（近傍バイアス）座標を `"lng,lat"` 文字列へ整形する。 */
export function formatProximity(coord: Coord): string {
  return `${coord[0]},${coord[1]}`
}

/** `GET /api/search/suggest` のリクエスト URL を組み立てる。 */
export function buildSuggestUrl(query: string, proximity?: Coord | null): string {
  const params = new URLSearchParams()
  params.set('q', query.trim())
  if (proximity) params.set('proximity', formatProximity(proximity))
  return `/api/search/suggest?${params.toString()}`
}

/** クエリがサジェストを発火する条件（最小長）を満たすか判定する。 */
export function shouldQuery(query: string): boolean {
  return query.trim().length >= SUGGEST_MIN_QUERY_LENGTH
}
