import { Hono } from 'hono'
import { geocodeForward } from '../services/mapbox'
import type { Coord } from '../types'

/** 目的地サジェスト系ルート。`/api/search` にマウントされる。 */
export const search = new Hono<{ Bindings: CloudflareBindings }>()

/**
 * `GET /api/search/suggest?q=...&proximity=lng,lat`
 * Mapbox forward search をプロキシしてオートコンプリート候補（SuggestItem[]）を返す。
 * 応答は KV（CACHE）に TTL 付きでキャッシュされる。
 */
search.get('/suggest', async (c) => {
  const q = c.req.query('q')?.trim() ?? ''
  if (!q) return c.json({ items: [] })

  const token = c.env.MAPBOX_SECRET_TOKEN
  if (!token) {
    return c.json({ error: 'MAPBOX_SECRET_TOKEN が設定されていません' }, 500)
  }

  const proximity = parseProximity(c.req.query('proximity'))

  try {
    const items = await geocodeForward(q, { proximity, limit: 10 }, { token, cache: c.env.CACHE })
    return c.json({ items })
  } catch (err) {
    console.error('目的地サジェストに失敗しました', err)
    return c.json({ error: 'サジェストの取得に失敗しました' }, 502)
  }
})

/** `"lng,lat"` 形式の proximity 文字列を Coord に変換する。不正なら undefined。 */
function parseProximity(raw: string | undefined): Coord | undefined {
  if (!raw) return undefined
  const parts = raw.split(',')
  if (parts.length !== 2) return undefined
  const lng = Number(parts[0])
  const lat = Number(parts[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined
  return [lng, lat]
}
