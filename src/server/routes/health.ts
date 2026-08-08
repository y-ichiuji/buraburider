import { Hono } from 'hono'

/** 動作確認用のヘルスチェック。`GET /api/health` -> `{ ok: true }`。 */
export const health = new Hono<{ Bindings: CloudflareBindings }>()

health.get('/', (c) => c.json({ ok: true }))
