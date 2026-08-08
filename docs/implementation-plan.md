# ブラブライダー（Buraburider）実装計画

[architecture.md](./architecture.md) で定めた設計を、どの順序で実装していくかをまとめる。
設計（何を作るか）とは分離し、この文書は進め方（どう進めるか）に絞る。

## スコープ（再掲）

MVP では [product-vision.md](./product-vision.md) の 4 機能のうち以下 2 つをコアとして完成させる。

- ① ルート生成＆カスタマイズ（寄り道度スライダー）
- ② スマート休憩スケジューリング（モード選択）

③ 酷道・悪路回避、④ SOS ボタンは土台（スキーマ・UI・DO）のみ用意する。

## 段階的な実装ステップ

各ステップの完了時に、適切な粒度で `main` ブランチへコミットする。

### ステップ 1: 基盤整備

- スターターの CounterAgent サンプル（`src/agents/counter.ts` / `src/client/counter.tsx`）を撤去する。
- Hono の `/api` ルーティングの土台を用意する。
- `src/server/services/mapbox.ts` に Mapbox API クライアント（Directions / Geocoding のプロキシ + KV キャッシュ）を実装する。

### ステップ 2: 地図表示

- `src/client/components/MapView.tsx` で Mapbox GL JS の地図を表示する。
- 出発地・目的地の入力欄と、サジェスト（`GET /api/search/suggest`）を接続する。

### ステップ 3: 基本ルート

- 寄り道度 0 の素のルートを `POST /api/routes/plan` で取得し、地図に描画する。

### ステップ 4: 寄り道生成（①完成）

- ルート沿いの候補 POI を Search Box API で収集する。
- Workers AI で寄り道度に応じたスポットを選定・並べ替えする。
- 選定した経由地を含めて Directions API で再計算する。

### ステップ 5: 休憩挿入（②完成）

- 累積所要時間から休憩挿入地点を算出する。
- モード別（コンビニ / 道の駅 / カフェ / GS）のカテゴリ検索で最適スポットを選ぶ。
- 休憩地点を含めて最終ルートを再計算する。

### ステップ 6: PWA 化と仕上げ

- `public/manifest.webmanifest` とアイコンを用意し、インストール可能にする。
- SOS ボタン UI（スワイプ / 1 秒長押し）を配置する。
- モバイル向けにレスポンシブ調整する。

### ステップ 7: （余力）③④ の土台

- 路面報告用の D1 テーブルと `POST /api/reports` を用意する。
- 走行セッション用の `RideSession` Durable Object を用意する。

## 事前準備・環境設定メモ

- **Mapbox トークン**
  - サーバー用トークンは `wrangler secret put MAPBOX_SECRET_TOKEN` で登録済み。
  - ローカル開発・検証では `.dev.vars` の `MAPBOX_SECRET_TOKEN` を使用する（`.gitignore` 済み）。
  - 地図描画用の public token は `wrangler.jsonc` の `vars.MAPBOX_PUBLIC_TOKEN` に設定する。
- **Worker 名**
  - デプロイ名を `buraburider` に変更する場合、`wrangler.jsonc` の `name` を更新し、
    新しい Worker 名で `wrangler secret put MAPBOX_SECRET_TOKEN` を再登録する必要がある
    （シークレットは Worker 名に紐づくため）。
