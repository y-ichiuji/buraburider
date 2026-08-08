import { Hono } from 'hono'
import {
  insertRoadReport,
  listRoadReports,
  parseBbox,
  parseCreateReportRequest
} from '../services/reports'
import type { RoadReport } from '../types'

/** 路面報告系ルート（③ 安全・快適ルーティングの土台）。`/api/reports` にマウントされる。 */
export const reports = new Hono<{ Bindings: CloudflareBindings }>()

/**
 * `POST /api/reports`
 * 砂利・落ち葉・凍結の路面報告を受け取り、バリデーションして D1 に保存する。
 * 保存した報告を 201 で返す。
 *
 * ステータス: 不正な入力 400 / D1 未設定 500 / 保存失敗 500。
 */
reports.post('/', async (c) => {
  const db = c.env.BURABURIDER_DB
  if (!db) {
    return c.json({ error: 'BURABURIDER_DB（D1）が設定されていません' }, 500)
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ error: 'リクエストボディの JSON が不正です' }, 400)
  }

  const parsed = parseCreateReportRequest(raw)
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400)
  }

  const report: RoadReport = {
    id: crypto.randomUUID(),
    lng: parsed.value.coord[0],
    lat: parsed.value.coord[1],
    hazard: parsed.value.hazard,
    reportedAt: Date.now()
  }

  try {
    await insertRoadReport(db, report)
    return c.json({ report }, 201)
  } catch (err) {
    console.error('路面報告の保存に失敗しました', err)
    return c.json({ error: '路面報告の保存に失敗しました' }, 500)
  }
})

/**
 * `GET /api/reports?bbox=minLng,minLat,maxLng,maxLat`
 * 路面報告を新しい順に一覧取得する。bbox 指定時はその範囲内のみ。
 * ③ の回避フィルタ・地図上のハザードマーカー表示の土台。
 *
 * ステータス: bbox 形式不正 400 / D1 未設定 500 / 取得失敗 500。
 */
reports.get('/', async (c) => {
  const db = c.env.BURABURIDER_DB
  if (!db) {
    return c.json({ error: 'BURABURIDER_DB（D1）が設定されていません' }, 500)
  }

  const bbox = parseBbox(c.req.query('bbox'))
  if (!bbox.ok) {
    return c.json({ error: bbox.error }, 400)
  }

  try {
    const items = await listRoadReports(db, bbox.value)
    return c.json({ items })
  } catch (err) {
    console.error('路面報告の取得に失敗しました', err)
    return c.json({ error: '路面報告の取得に失敗しました' }, 500)
  }
})
