# ブラブライダー（Buraburider）デザインシステム & 実装規約

全実装ステップ（サブエージェント含む）が従う共通ルール。ステップ間で見た目・構造がブレないための単一の参照点とする。

## 1. ブランドとトーン

- プロダクト名: **ブラブライダー（Buraburider）**。「ブラブラ寄り道するライダー」を体現する。
- トーン: バイク乗りが好む **アクティブ・骨太・かっこいい**。夜のツーリング／メーターパネルのような雰囲気。
- 基調カラー: **黒 × オレンジ**。黒を背景の主役に、オレンジをアクセント（速度・熱・警告）に使う。

## 2. カラートークン

`src/style.css` の `:root` に以下を定義し、全コンポーネントはこの変数のみを参照する（生の hex を各所に散らさない）。

```css
:root {
  /* 背景（ダーク基調） */
  --bg: #0a0a0b;            /* ページ最背面（ほぼ黒） */
  --surface: #16161a;       /* パネル・カード */
  --surface-2: #1f2027;     /* 一段持ち上げた面 */
  --border: #2e2f37;        /* 境界線 */

  /* オレンジ（アクセント） */
  --primary: #ff6a00;       /* 主アクセント（CTA・アクティブ） */
  --primary-hi: #ff8c3a;    /* ハイライト・ホバー */
  --primary-dim: #c24e00;   /* 沈めたオレンジ */
  --on-primary: #0a0a0b;    /* オレンジ上の文字（黒） */

  /* テキスト */
  --text: #f5f5f7;          /* 主要テキスト */
  --text-muted: #a1a1aa;    /* 補助テキスト */

  /* 状態色 */
  --danger: #ff3b30;        /* SOS・危険（凍結/落ち葉など） */
  --success: #34c759;

  /* エフェクト */
  --grad-heat: linear-gradient(135deg, #ff6a00 0%, #ff9a3d 100%);
  --glow-primary: 0 0 0 1px rgba(255, 106, 0, 0.4), 0 4px 20px rgba(255, 106, 0, 0.25);
  --radius: 12px;
  --radius-lg: 18px;
}
```

### 使い方の原則

- 画面全体は `--bg` のダーク。パネルは `--surface`、その上の要素は `--surface-2`。
- **オレンジは「今アクティブなもの／主要アクション／熱量」だけに使う**（多用しない。効かせどころを絞る）。
- 主要CTA（ルート生成ボタンなど）は `--grad-heat` 背景 + `--on-primary` 文字 + `--glow-primary`。
- SOS・危険報告は `--danger`。オレンジと混同させない。
- 角丸は `--radius`（既定）／大きな面は `--radius-lg`。

## 3. タイポグラフィ

- 本文フォント: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`。
- 数値（距離・所要時間・速度など「メーター」情報）は等幅で強調: `'SF Mono', ui-monospace, 'Roboto Mono', monospace`、太字・やや大きめ。
- 見出しは太字（700〜800）、字間をわずかに詰める（`letter-spacing: -0.01em`）。ラベル類は大文字＋字間広め（`text-transform: uppercase; letter-spacing: 0.08em;`）でメカ感を出す。

## 4. レイアウト / UI 原則（モバイル PWA 前提）

- **地図を全画面**に敷き、操作 UI はその上のオーバーレイ（下部シート／フローティングパネル）として重ねる。
- タップ領域は最低 44px。走行中グローブ操作を想定し、主要操作は大きく。
- SOS ボタンは画面端に**透過の大サイズで常時固定**。誤作動防止で「スワイプ or 1 秒長押し」発動。
- レスポンシブ: モバイル最優先。PC では中央に幅制限したモバイル風カラムでも可。

## 5. コード構成規約

[architecture.md](./architecture.md) の「3. ディレクトリ構成」に従う。要点:

- サーバー: `src/server/routes/*`（Hono ルート）、`src/server/services/*`（ドメインロジック）、`src/server/types.ts`（共有型）。
- クライアント: `src/client/components/*`、`src/client/hooks/*`。
- Durable Object / Agent: `src/agents/*`。
- **Mapbox のシークレットトークンはサーバーのみ**。Directions / Search / Geocoding は必ず Worker 経由（`src/server/services/mapbox.ts`）。ブラウザは地図描画に public token（`MAPBOX_PUBLIC_TOKEN`）のみ使用。

### コーディング規約

- フォーマット/静的解析は oxfmt / oxlint（`.oxfmtrc.json` / `.oxlintrc.json`）。**セミコロンなし・シングルクォート・末尾カンマなし**。Edit/Write で自動実行される。
- TypeScript strict。`any` は避け、`src/server/types.ts` に型を集約。
- 環境値・バインディングは Hono の `c.env`（型は `CloudflareBindings`）から取得。グローバルに秘匿値を置かない。
- **floating promise 禁止**（`await` するか明示的に扱う）。fetch 失敗・外部 API エラーは握りつぶさずハンドリング。
- `wrangler.jsonc` を変更したら `npm run cf-typegen` で `CloudflareBindings` 型を再生成。

### Mapbox 呼び出しの共通方針

- `src/server/services/mapbox.ts` に集約。Geocoding / Search の GET 応答は **KV（`CACHE`）に TTL 付きでキャッシュ**（キーは正規化クエリ）。
- レスポンスはドメイン型（`src/server/types.ts` の `Route` / `Waypoint` / `Spot` 等）に正規化して返す。生の Mapbox JSON を上位層へ漏らさない。

## 6. テスト規約

- フレームワーク: **Vitest + `@cloudflare/vitest-pool-workers`**（Workers ランタイム上で実行）。
- 置き場所: 対象の近くに `*.test.ts`（例 `src/server/services/rest.test.ts`）。
- 方針:
  - ドメインロジック（寄り道度→経由地数のマッピング、休憩挿入地点の算出、モード→カテゴリ変換など）は**純粋関数に切り出してユニットテスト**。
  - API ルートは Hono の `app.request()` で結合テスト。**Mapbox / Workers AI 呼び出しはモック**して外部依存なしで回す。
  - 実 API を叩くスモーク確認が要る場合は `.dev.vars` のトークンを使い、テスト本体からは分離する（CI を汚さない）。
- npm script に `test`（`vitest run`）を追加する。

## 7. 各ステップ完了の定義（Definition of Done）

各サブエージェントはステップ完了時に以下を満たすこと:

1. 実装が完了し、`npm run build` が通る。
2. 型チェック（`tsc --noEmit` 相当）と `npm run lint` が通る。
3. そのステップのテスト（ユニット/結合）を追加し、`npm run test` が緑。
4. 検証: 可能な範囲で実際に動作を確認（API はローカル起動 or `app.request()` で叩く、地図など目視が要る部分は「要目視確認」として明記）。
5. セルフレビュー（バグ・規約違反・設計逸脱）を行い、指摘を自分で修正。
6. 変更点・確認結果・残課題を簡潔に報告。
