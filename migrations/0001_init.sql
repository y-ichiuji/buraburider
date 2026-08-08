-- ブラブライダー D1 初期スキーマ（architecture.md §4）。
-- 適用: `wrangler d1 migrations apply buraburider`（ローカルは --local、本番は --remote）。
-- テストは test/apply-d1-migrations.ts が applyD1Migrations でこのファイルを適用する。

-- 路面報告（③ 安全・快適ルーティングの土台）。
CREATE TABLE IF NOT EXISTS road_reports (
  id          TEXT PRIMARY KEY,
  lng         REAL NOT NULL,
  lat         REAL NOT NULL,
  hazard      TEXT NOT NULL,        -- 'gravel' | 'leaves' | 'ice'
  reported_at INTEGER NOT NULL      -- epoch ms
);

-- 新しい順の一覧取得と、bbox（経度・緯度範囲）での絞り込みを想定したインデックス。
CREATE INDEX IF NOT EXISTS idx_road_reports_reported_at ON road_reports (reported_at);
CREATE INDEX IF NOT EXISTS idx_road_reports_lng_lat ON road_reports (lng, lat);

-- 保存ルート。
CREATE TABLE IF NOT EXISTS saved_routes (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  origin     TEXT NOT NULL,         -- JSON [lng, lat]
  dest       TEXT NOT NULL,         -- JSON [lng, lat]
  geojson    TEXT NOT NULL,         -- ルート GeoJSON
  created_at INTEGER NOT NULL       -- epoch ms
);
