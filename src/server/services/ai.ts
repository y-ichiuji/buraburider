// Workers AI による寄り道スポットの選定・並べ替え（ステップ4）。
//
// collectRouteSpots（services/mapbox）が集めた候補 Spot[] と寄り道度（0-5）を
// Workers AI に渡し、道中体験が最大化されるよう N 件を選定・順序付けする。
//
// AI が使えない / 失敗 / 不正 JSON の場合は、スコアリング（ルートからの距離・
// カテゴリ重み）で機械的に N 件を選ぶフォールバックへ切り替える。AI 無しでも
// 機能が壊れないことを保証する。

import type { Route, Spot, Waypoint, WaypointType } from '../types'
import { distanceToPathMeters, nearestVertexIndex } from './mapbox'

/**
 * スポット選定に用いる Workers AI モデル。
 * 指示追従・JSON 出力に適した軽量モデル。アカウントで使えるモデルに合わせて差し替え可能。
 */
export const SELECTION_MODEL = '@cf/meta/llama-3.1-8b-instruct'

/** AI 選定の依存。AI 未指定ならフォールバック（スコアリング）で動作する。 */
export interface AiDeps {
  ai?: Ai
}

/** カテゴリ（canonical id）→ 経由地種別のマッピング。未知は 'poi'。 */
const TYPE_BY_CATEGORY: Record<string, WaypointType> = {
  viewpoint: 'scenic',
  waterfall: 'scenic',
  nature_reserve: 'scenic',
  park: 'scenic',
  lake: 'scenic',
  beach: 'scenic',
  mountain: 'winding',
  tourist_attraction: 'landmark',
  historic_site: 'landmark',
  monument: 'landmark',
  garden: 'landmark'
}

/** スコアリングのカテゴリ重み（体験価値の目安）。未知は 0.4。 */
const CATEGORY_WEIGHT: Record<string, number> = {
  viewpoint: 1.0,
  waterfall: 0.9,
  nature_reserve: 0.8,
  mountain: 0.75,
  tourist_attraction: 0.7,
  park: 0.6,
  historic_site: 0.6,
  monument: 0.5
}

/** カテゴリ（canonical id）から経由地種別を求める。 */
export function waypointTypeForCategory(category?: string): WaypointType {
  if (!category) return 'poi'
  return TYPE_BY_CATEGORY[category] ?? 'poi'
}

/** Spot を Waypoint に変換する。 */
export function spotToWaypoint(spot: Spot): Waypoint {
  return { type: waypointTypeForCategory(spot.category), name: spot.name, coord: spot.coord }
}

/**
 * スポットのスコア（大きいほど優先）。カテゴリ重みとルート近接性を合成する。
 * 寄り道度が高いほど遠回りの許容が広がり、距離ペナルティが緩む。
 */
export function scoreSpot(spot: Spot, route: Route, level: number): number {
  const dist = distanceToPathMeters(spot.coord, route.geojson.coordinates)
  const catWeight = CATEGORY_WEIGHT[spot.category ?? ''] ?? 0.4
  const tolerance = 2000 + level * 3000
  const proximity = Math.max(0, 1 - dist / tolerance)
  return catWeight * 0.6 + proximity * 0.4
}

/** スコア上位から count 件を選ぶフォールバック選定。 */
export function selectByScore(spots: Spot[], route: Route, count: number, level: number): Spot[] {
  return [...spots]
    .sort((a, b) => scoreSpot(b, route, level) - scoreSpot(a, route, level))
    .slice(0, count)
}

/** 選定済みスポットをルート上の進行順（最近傍頂点インデックス）に並べ替える。 */
export function orderSpotsAlongRoute(spots: Spot[], route: Route): Spot[] {
  const path = route.geojson.coordinates
  return [...spots]
    .map((spot) => ({ spot, index: nearestVertexIndex(spot.coord, path) }))
    .sort((a, b) => a.index - b.index)
    .map((x) => x.spot)
}

/** AI へ渡すチャットメッセージ（候補の番号付きリスト + JSON 出力の指示）。 */
export function buildSelectionMessages(
  spots: Spot[],
  level: number,
  count: number
): { role: 'system' | 'user'; content: string }[] {
  const list = spots.map((s, i) => `${i}: ${s.name}（${s.category ?? 'その他'}）`).join('\n')
  const system =
    'あなたはバイク乗りの寄り道ルートを設計するアシスタントです。' +
    '与えられた候補地から、道中の体験が最も豊かになる立ち寄り先を選びます。' +
    '必ず指定された JSON 形式だけを返し、前後に説明文を書かないでください。'
  const user =
    `寄り道度は ${level}（0-5、大きいほど寄り道を増やす）です。` +
    `次の候補地から最大 ${count} 件を選び、立ち寄る順序で並べてください。\n` +
    `候補地:\n${list}\n\n` +
    '出力は次の JSON のみ: {"selected":[選んだ候補地の番号を順に並べた配列]}'
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/** Workers AI テキスト生成の応答から本文テキストを取り出す。 */
export function extractResponseText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && 'response' in raw) {
    const r = (raw as { response?: unknown }).response
    if (typeof r === 'string') return r
  }
  return ''
}

/** テキストから JSON（オブジェクト or 配列）を抽出する。失敗時 null。 */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // フェンスや前後の文章に埋もれた JSON を救出する。
  }
  const match = trimmed.match(/[[{][\s\S]*[\]}]/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

/**
 * AI 応答テキストを検証し、選定された Spot[] を返す。
 * `{"selected":[番号...]}` または素の番号配列を受理する。
 * 妥当な番号（範囲内・重複除去）のみを順序保持で採用。1 件も無ければ null。
 */
export function parseAiSelection(text: string, spots: Spot[], count: number): Spot[] | null {
  const json = extractJson(text)
  if (json == null) return null

  let indices: unknown
  if (Array.isArray(json)) {
    indices = json
  } else if (typeof json === 'object' && 'selected' in json) {
    indices = (json as Record<string, unknown>).selected
  } else {
    return null
  }
  if (!Array.isArray(indices)) return null

  const chosen: Spot[] = []
  const seen = new Set<number>()
  for (const raw of indices) {
    const i = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    if (!Number.isInteger(i) || i < 0 || i >= spots.length || seen.has(i)) continue
    seen.add(i)
    chosen.push(spots[i])
    if (chosen.length >= count) break
  }
  return chosen.length > 0 ? chosen : null
}

/**
 * 候補スポットから立ち寄り先を N 件（count）選定し、ルート進行順の Waypoint[] を返す。
 *
 * - 候補が空なら空配列。
 * - AI が使えれば AI で選定。失敗 / 不正 JSON はスコアリングへフォールバック。
 * - 最終的にルート上の進行順へ並べ替えて返す（経由地入り再計算で逆走しないように）。
 */
export async function selectDetourWaypoints(
  spots: Spot[],
  route: Route,
  level: number,
  count: number,
  deps: AiDeps
): Promise<Waypoint[]> {
  if (spots.length === 0 || count <= 0) return []

  const targetCount = Math.min(count, spots.length)
  let chosen: Spot[] | null = null

  if (deps.ai) {
    try {
      const messages = buildSelectionMessages(spots, level, targetCount)
      const raw = await deps.ai.run(SELECTION_MODEL, { messages, max_tokens: 256 })
      chosen = parseAiSelection(extractResponseText(raw), spots, targetCount)
    } catch (err) {
      console.error('AI スポット選定に失敗しました。スコアリングでフォールバックします', err)
      chosen = null
    }
  }

  if (!chosen || chosen.length === 0) {
    chosen = selectByScore(spots, route, targetCount, level)
  }

  return orderSpotsAlongRoute(chosen, route).map(spotToWaypoint)
}
