import { Hono } from 'hono'
import { MapboxError } from '../services/mapbox'
import { parsePlanRequest, planRoute } from '../services/plan'

/** ルート生成系ルート。`/api/routes` にマウントされる。 */
export const plan = new Hono<{ Bindings: CloudflareBindings }>()

/**
 * `POST /api/routes/plan`
 * origin / destination（+ detourLevel / rest）を受け取り、ルートを生成して返す。
 * ステップ3では素のルートのみ（waypoints / rests は空）。
 *
 * ステータス: 不正な入力 400 / トークン未設定 500 / Mapbox エラー 502。
 */
plan.post('/plan', async (c) => {
  const token = c.env.MAPBOX_SECRET_TOKEN
  if (!token) {
    return c.json({ error: 'MAPBOX_SECRET_TOKEN が設定されていません' }, 500)
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ error: 'リクエストボディの JSON が不正です' }, 400)
  }

  const parsed = parsePlanRequest(raw)
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400)
  }

  try {
    const result = await planRoute(parsed.value, {
      mapbox: { token, cache: c.env.CACHE },
      ai: c.env.AI
    })
    return c.json(result)
  } catch (err) {
    if (err instanceof MapboxError) {
      console.error('Mapbox Directions に失敗しました', err)
      return c.json({ error: 'ルート探索に失敗しました' }, 502)
    }
    console.error('ルート生成に失敗しました', err)
    return c.json({ error: 'ルート生成に失敗しました' }, 500)
  }
})
