import { describe, expect, it, vi } from 'vitest'
import type { Route, Spot } from '../types'
import {
  buildSelectionMessages,
  extractResponseText,
  orderSpotsAlongRoute,
  parseAiSelection,
  scoreSpot,
  selectByScore,
  selectDetourWaypoints,
  spotToWaypoint,
  waypointTypeForCategory
} from './ai'

// --- テスト用データ --------------------------------------------------------

/** 東→西へ伸びる単純な直線ルート。 */
const route: Route = {
  geojson: {
    type: 'LineString',
    coordinates: [
      [139.0, 35.0],
      [138.5, 35.0],
      [138.0, 35.0]
    ]
  },
  distanceKm: 90,
  durationMin: 120
}

function spot(id: string, lng: number, lat: number, category?: string): Spot {
  return { id, name: `spot-${id}`, coord: [lng, lat], category }
}

// --- カテゴリ→種別/変換 ----------------------------------------------------

describe('waypointTypeForCategory', () => {
  it('絶景系は scenic、名所系は landmark、未知は poi', () => {
    expect(waypointTypeForCategory('viewpoint')).toBe('scenic')
    expect(waypointTypeForCategory('waterfall')).toBe('scenic')
    expect(waypointTypeForCategory('tourist_attraction')).toBe('landmark')
    expect(waypointTypeForCategory('mountain')).toBe('winding')
    expect(waypointTypeForCategory('unknown_cat')).toBe('poi')
    expect(waypointTypeForCategory(undefined)).toBe('poi')
  })

  it('touring_road は winding（ワインディング）に対応する', () => {
    expect(waypointTypeForCategory('touring_road')).toBe('winding')
  })
})

describe('spotToWaypoint', () => {
  it('Spot を種別付き Waypoint に変換する', () => {
    expect(spotToWaypoint(spot('a', 138.5, 35.0, 'viewpoint'))).toEqual({
      type: 'scenic',
      name: 'spot-a',
      coord: [138.5, 35.0]
    })
  })
})

// --- スコアリング ----------------------------------------------------------

describe('scoreSpot / selectByScore', () => {
  it('ルートに近い高カテゴリほど高スコア', () => {
    const near = spot('near', 138.5, 35.0, 'viewpoint')
    const far = spot('far', 138.5, 35.4, 'park')
    expect(scoreSpot(near, route, 3)).toBeGreaterThan(scoreSpot(far, route, 3))
  })

  it('寄り道度が高いほど遠方のペナルティが緩む', () => {
    // level1 の許容(5km)超・level5 の許容(17km)内となる約 10km 地点。
    const far = spot('far', 138.5, 35.09, 'viewpoint')
    expect(scoreSpot(far, route, 5)).toBeGreaterThan(scoreSpot(far, route, 1))
  })

  it('スコア上位から count 件を選ぶ', () => {
    const spots = [
      spot('a', 138.5, 35.0, 'viewpoint'),
      spot('b', 138.5, 35.5, 'park'),
      spot('c', 138.0, 35.0, 'tourist_attraction')
    ]
    const picked = selectByScore(spots, route, 2, 3)
    expect(picked).toHaveLength(2)
    expect(picked.map((s) => s.id)).not.toContain('b')
  })

  it('touring_road は同条件の絶景・名所より高スコアで最優先に選ばれる', () => {
    const road = spot('road', 138.5, 35.0, 'touring_road')
    const view = spot('view', 138.5, 35.0, 'viewpoint')
    expect(scoreSpot(road, route, 3)).toBeGreaterThan(scoreSpot(view, route, 3))
    // 1 件だけ選ぶと touring_road が選ばれる。
    expect(selectByScore([view, road], route, 1, 3).map((s) => s.id)).toEqual(['road'])
  })
})

// --- ルート順の並べ替え ----------------------------------------------------

describe('orderSpotsAlongRoute', () => {
  it('ルート進行順（東→西）に並べ替える', () => {
    const spots = [spot('west', 138.05, 35.0), spot('east', 138.95, 35.0), spot('mid', 138.5, 35.0)]
    const ordered = orderSpotsAlongRoute(spots, route)
    expect(ordered.map((s) => s.id)).toEqual(['east', 'mid', 'west'])
  })
})

// --- AI 応答パース ---------------------------------------------------------

describe('extractResponseText', () => {
  it('{ response } とプレーン文字列の双方を扱う', () => {
    expect(extractResponseText({ response: 'hello' })).toBe('hello')
    expect(extractResponseText('raw')).toBe('raw')
    expect(extractResponseText({ other: 1 })).toBe('')
    expect(extractResponseText(null)).toBe('')
  })
})

describe('parseAiSelection', () => {
  const spots = [spot('0', 139, 35), spot('1', 138.5, 35), spot('2', 138, 35)]

  it('{"selected":[...]} を順序保持で採用する', () => {
    const picked = parseAiSelection('{"selected":[2,0]}', spots, 3)
    expect(picked?.map((s) => s.id)).toEqual(['2', '0'])
  })

  it('前後に文章があっても JSON を救出する', () => {
    const picked = parseAiSelection('選びました: {"selected":[1]} 以上です', spots, 3)
    expect(picked?.map((s) => s.id)).toEqual(['1'])
  })

  it('素の配列も受理する', () => {
    const picked = parseAiSelection('[0, 1]', spots, 3)
    expect(picked?.map((s) => s.id)).toEqual(['0', '1'])
  })

  it('範囲外・重複・非整数は除外し、count で打ち切る', () => {
    const picked = parseAiSelection('{"selected":[5,1,1,0,-1,2]}', spots, 2)
    expect(picked?.map((s) => s.id)).toEqual(['1', '0'])
  })

  it('妥当な番号が無ければ null', () => {
    expect(parseAiSelection('{"selected":[9,10]}', spots, 3)).toBeNull()
    expect(parseAiSelection('not json', spots, 3)).toBeNull()
    expect(parseAiSelection('{"foo":1}', spots, 3)).toBeNull()
  })
})

describe('buildSelectionMessages', () => {
  it('候補を番号付きで列挙し JSON 出力を指示する', () => {
    const messages = buildSelectionMessages([spot('a', 138.5, 35, 'viewpoint')], 3, 1)
    expect(messages[0].role).toBe('system')
    expect(messages[1].content).toContain('0: spot-a')
    expect(messages[1].content).toContain('"selected"')
  })

  it('ツーリングロードを最優先にする指示を含む', () => {
    const messages = buildSelectionMessages([spot('a', 138.5, 35, 'touring_road')], 3, 1)
    const joined = messages.map((m) => m.content).join('\n')
    expect(joined).toContain('最優先')
    expect(joined).toContain('ツーリングロード')
    // 候補リストには category が含まれ AI の判断材料になる。
    expect(messages[1].content).toContain('touring_road')
  })
})

// --- selectDetourWaypoints（AI + フォールバック）--------------------------

describe('selectDetourWaypoints', () => {
  const spots = [
    spot('a', 139.0, 35.0, 'viewpoint'),
    spot('b', 138.5, 35.0, 'park'),
    spot('c', 138.0, 35.0, 'tourist_attraction')
  ]

  it('候補が空なら空配列（AI を呼ばない）', async () => {
    const run = vi.fn()
    const waypoints = await selectDetourWaypoints([], route, 3, 2, {
      ai: { run } as unknown as Ai
    })
    expect(waypoints).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  it('AI 応答で選定し、ルート順の Waypoint を返す', async () => {
    const run = vi.fn(async () => ({ response: '{"selected":[2,0]}' }))
    const waypoints = await selectDetourWaypoints(spots, route, 3, 2, {
      ai: { run } as unknown as Ai
    })
    // AI は c,a を選ぶ → ルート順（東→西）で a(139) → c(138)
    expect(waypoints.map((w) => w.name)).toEqual(['spot-a', 'spot-c'])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('AI が投げたらスコアリングにフォールバックする', async () => {
    const run = vi.fn(async () => {
      throw new Error('ai down')
    })
    const waypoints = await selectDetourWaypoints(spots, route, 3, 2, {
      ai: { run } as unknown as Ai
    })
    expect(waypoints).toHaveLength(2)
  })

  it('AI 応答が不正 JSON でもフォールバックで結果を返す', async () => {
    const run = vi.fn(async () => ({ response: 'ごめんなさい選べません' }))
    const waypoints = await selectDetourWaypoints(spots, route, 3, 2, {
      ai: { run } as unknown as Ai
    })
    expect(waypoints).toHaveLength(2)
  })

  it('AI 未指定でもスコアリングで動く', async () => {
    const waypoints = await selectDetourWaypoints(spots, route, 2, 1, {})
    expect(waypoints).toHaveLength(1)
  })
})
