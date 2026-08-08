// 路面報告（③ 安全・快適ルーティングの土台）のドメインロジック。
//
// `POST /api/reports` / `GET /api/reports`（src/server/routes/reports.ts）から呼ばれる。
// バリデーションは純粋関数として切り出し（テスト対象）、D1 アクセスは薄いヘルパにまとめる。
// 生の D1 行を上位層へ漏らさず、`src/server/types.ts` の `RoadReport` に正規化して返す。

import type { Bbox, CreateReportRequest, HazardType, RoadReport } from '../types'

/** 有効なハザード種別の一覧。 */
export const HAZARD_TYPES: readonly HazardType[] = ['gravel', 'leaves', 'ice']

/** 一覧取得の既定上限件数（地図表示・回避フィルタの土台としては十分な件数）。 */
export const DEFAULT_REPORTS_LIMIT = 500

/** バリデーション結果。成功なら正規化済みの値、失敗ならエラーメッセージ。 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * `POST /api/reports` の未検証ボディを検証し、正規化済みの CreateReportRequest を返す。
 * 不正な場合はエラーメッセージを返す（ルート側で 400 にする）。
 */
export function parseCreateReportRequest(raw: unknown): ParseResult<CreateReportRequest> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'リクエストボディが不正です' }
  }
  const body = raw as Record<string, unknown>

  const coord = parseCoord(body.coord)
  if (!coord) {
    return { ok: false, error: 'coord は [lng, lat] の数値2要素で指定してください' }
  }

  const { hazard } = body
  if (typeof hazard !== 'string' || !HAZARD_TYPES.includes(hazard as HazardType)) {
    return {
      ok: false,
      error: `hazard は ${HAZARD_TYPES.join(' | ')} のいずれかで指定してください`
    }
  }

  return { ok: true, value: { coord, hazard: hazard as HazardType } }
}

/** `[lng, lat]` として妥当な座標なら `[lng, lat]` を、不正なら null を返す。 */
function parseCoord(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null
  const [lng, lat] = raw as unknown[]
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  return [lng, lat]
}

/**
 * `GET /api/reports?bbox=minLng,minLat,maxLng,maxLat` の bbox クエリを検証する。
 * - 未指定（undefined）は `{ ok: true, value: null }`（範囲指定なし）。
 * - 形式が不正なら `{ ok: false }`（ルート側で 400 にする）。
 */
export function parseBbox(raw: string | undefined): ParseResult<Bbox | null> {
  if (raw === undefined) return { ok: true, value: null }
  const parts = raw.split(',')
  if (parts.length !== 4) {
    return { ok: false, error: 'bbox は minLng,minLat,maxLng,maxLat 形式で指定してください' }
  }
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) {
    return { ok: false, error: 'bbox の各要素は数値で指定してください' }
  }
  const [minLng, minLat, maxLng, maxLat] = nums
  if (minLng > maxLng || minLat > maxLat) {
    return { ok: false, error: 'bbox は min <= max である必要があります' }
  }
  return { ok: true, value: [minLng, minLat, maxLng, maxLat] }
}

/** D1 `road_reports` テーブルの行の形。 */
interface RoadReportRow {
  id: string
  lng: number
  lat: number
  hazard: string
  reported_at: number
}

/** D1 行をドメイン型 `RoadReport` に正規化する。 */
function rowToReport(row: RoadReportRow): RoadReport {
  return {
    id: row.id,
    lng: row.lng,
    lat: row.lat,
    hazard: row.hazard as HazardType,
    reportedAt: row.reported_at
  }
}

/** 路面報告を D1 に1件挿入する。 */
export async function insertRoadReport(db: D1Database, report: RoadReport): Promise<void> {
  await db
    .prepare('INSERT INTO road_reports (id, lng, lat, hazard, reported_at) VALUES (?, ?, ?, ?, ?)')
    .bind(report.id, report.lng, report.lat, report.hazard, report.reportedAt)
    .run()
}

/**
 * 路面報告を新しい順に一覧取得する。
 * bbox が指定された場合はその矩形範囲内の報告のみを返す（③ の回避フィルタ・地図表示の土台）。
 */
export async function listRoadReports(
  db: D1Database,
  bbox: Bbox | null = null,
  limit: number = DEFAULT_REPORTS_LIMIT
): Promise<RoadReport[]> {
  const stmt = bbox
    ? db
        .prepare(
          'SELECT id, lng, lat, hazard, reported_at FROM road_reports ' +
            'WHERE lng >= ? AND lng <= ? AND lat >= ? AND lat <= ? ' +
            'ORDER BY reported_at DESC LIMIT ?'
        )
        .bind(bbox[0], bbox[2], bbox[1], bbox[3], limit)
    : db
        .prepare(
          'SELECT id, lng, lat, hazard, reported_at FROM road_reports ORDER BY reported_at DESC LIMIT ?'
        )
        .bind(limit)

  const { results } = await stmt.all<RoadReportRow>()
  return results.map(rowToReport)
}
