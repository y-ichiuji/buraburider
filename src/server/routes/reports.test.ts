import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations } from '../../../test/d1'
import type { RoadReport } from '../types'
import { createApiApp } from './index'

// D1（BURABURIDER_DB）は miniflare のローカル模擬。実バインディングは cloudflare:workers の
// env から取得する。スキーマは beforeAll で migrations/0001_init.sql を適用する。
//
// 実 index.tsx（SSR / agentsMiddleware 依存）は読み込まず、/api のマウントだけ再現する。
function buildApp() {
  const app = new Hono<{ Bindings: CloudflareBindings }>()
  app.route('/api', createApiApp())
  return app
}

// app.request に渡すテスト用 env。実 env をベースに Mapbox トークンだけ足す
// （D1 バインディング BURABURIDER_DB を引き継ぐため）。
const testEnv = { ...env, MAPBOX_SECRET_TOKEN: 'test-token' } as unknown as CloudflareBindings

function postReport(app: ReturnType<typeof buildApp>, body: unknown, e = testEnv) {
  return app.request(
    '/api/reports',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    },
    e
  )
}

beforeAll(async () => {
  await applyMigrations()
})

// テスト間を独立させるため、各テスト後に報告を全消去する。
afterEach(async () => {
  await env.BURABURIDER_DB.exec('DELETE FROM road_reports')
})

describe('POST /api/reports', () => {
  it('報告を保存して 201 と report を返す', async () => {
    const app = buildApp()
    const res = await postReport(app, { coord: [139.767, 35.681], hazard: 'gravel' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { report: RoadReport }
    expect(body.report.hazard).toBe('gravel')
    expect(body.report.lng).toBe(139.767)
    expect(body.report.lat).toBe(35.681)
    expect(body.report.id).toBeTruthy()
    expect(typeof body.report.reportedAt).toBe('number')

    // D1 に実際に1件入っていること。
    const row = await env.BURABURIDER_DB.prepare('SELECT COUNT(*) AS n FROM road_reports').first<{
      n: number
    }>()
    expect(row?.n).toBe(1)
  })

  it('coord が不正なら 400（保存しない）', async () => {
    const app = buildApp()
    const res = await postReport(app, { coord: [139.767], hazard: 'ice' })
    expect(res.status).toBe(400)
    const row = await env.BURABURIDER_DB.prepare('SELECT COUNT(*) AS n FROM road_reports').first<{
      n: number
    }>()
    expect(row?.n).toBe(0)
  })

  it('hazard が未知の値なら 400', async () => {
    const app = buildApp()
    const res = await postReport(app, { coord: [139.767, 35.681], hazard: 'mud' })
    expect(res.status).toBe(400)
  })

  it('JSON が壊れていれば 400', async () => {
    const app = buildApp()
    const res = await app.request(
      '/api/reports',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' },
      testEnv
    )
    expect(res.status).toBe(400)
  })

  it('D1 未設定なら 500', async () => {
    const app = buildApp()
    const res = await postReport(app, { coord: [139.767, 35.681], hazard: 'ice' }, {
      MAPBOX_SECRET_TOKEN: 'x'
    } as unknown as CloudflareBindings)
    expect(res.status).toBe(500)
  })
})

describe('GET /api/reports', () => {
  it('保存した報告を新しい順に一覧取得する', async () => {
    const app = buildApp()
    await postReport(app, { coord: [139.0, 35.0], hazard: 'gravel' })
    await postReport(app, { coord: [140.0, 36.0], hazard: 'leaves' })

    const res = await app.request('/api/reports', {}, testEnv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: RoadReport[] }
    expect(body.items).toHaveLength(2)
    // reported_at DESC。後に入れた leaves が先頭。
    expect(body.items[0].hazard).toBe('leaves')
  })

  it('bbox 指定で範囲内の報告のみ返す', async () => {
    const app = buildApp()
    await postReport(app, { coord: [139.0, 35.0], hazard: 'gravel' }) // 範囲内
    await postReport(app, { coord: [141.0, 37.0], hazard: 'ice' }) // 範囲外

    const res = await app.request('/api/reports?bbox=138.5,34.5,139.5,35.5', {}, testEnv)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: RoadReport[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].hazard).toBe('gravel')
  })

  it('bbox の形式が不正なら 400', async () => {
    const app = buildApp()
    const res = await app.request('/api/reports?bbox=1,2,3', {}, testEnv)
    expect(res.status).toBe(400)
  })

  it('報告が無ければ空配列', async () => {
    const app = buildApp()
    const res = await app.request('/api/reports', {}, testEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })
})
