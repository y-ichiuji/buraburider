import { Hono } from 'hono'
import { agentsMiddleware } from 'hono-agents'
import { renderToReadableStream } from 'react-dom/server'
import { Link, ReactRefresh, Script, ViteClient } from 'vite-ssr-components/react'
import { createApiApp } from './server/routes'
import { buildMapboxTokenScript } from './shared/mapbox-token'

// RideSession Durable Object（④ SOS の土台）を Worker から export する。
// wrangler.jsonc の durable_objects / migrations バインディングと対応する。
export { RideSession } from './agents/ride-session'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// Agents SDK のルーティング（/agents/:agent/:name への WebSocket/HTTP）を有効化する。
// 対象外のパスは next() で素通しするため、/api と SSR ('/') には影響しない。
app.use('*', agentsMiddleware())

// API ルート（/api/*）をサブアプリとしてマウント。
app.route('/api', createApiApp())

app.get('/', async (c) => {
  c.header('Content-Type', 'text/html')
  // public token をブラウザへ受け渡す（window.__MAPBOX_TOKEN__）。
  // secret token は絶対に埋め込まない。未設定時は空文字となりクライアントがフォールバック表示する。
  const tokenScript = buildMapboxTokenScript(c.env.MAPBOX_PUBLIC_TOKEN ?? '')
  return c.body(
    await renderToReadableStream(
      <html lang="ja">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <title>ブラブライダー</title>
          <meta
            name="description"
            content="「最高の道中」を提案するバイク乗り向けの寄り道ナビ、ブラブライダー。"
          />

          {/* PWA: マニフェスト。theme-color はダークな全画面地図に馴染ませて黒基調に、
              マニフェスト側の theme_color はブランドのオレンジ（アプリ chrome のアクセント）。 */}
          <link rel="manifest" href="/manifest.webmanifest" />
          <meta name="theme-color" content="#0a0a0b" />

          {/* iOS ホーム画面追加（スタンドアロン表示・ステータスバー透過で全画面地図を活かす）。 */}
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Buraburider" />
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
          <link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />

          <script dangerouslySetInnerHTML={{ __html: tokenScript }} />
          <ViteClient />
          <ReactRefresh />
          <Script src="/src/client/index.tsx" />
          <Link href="/src/style.css" rel="stylesheet" />
        </head>
        <body>
          <div id="root" />
        </body>
      </html>
    )
  )
})

export default app
