import { Hono } from 'hono'
import { renderToReadableStream } from 'react-dom/server'
import { Link, ReactRefresh, Script, ViteClient } from 'vite-ssr-components/react'
import { createApiApp } from './server/routes'
import { buildMapboxTokenScript } from './shared/mapbox-token'

// NOTE: RideSession Durable Object（④ の土台）はステップ 7 で追加する。
// その際に `agentsMiddleware()`（hono-agents）と durable_objects バインディングを戻す。

const app = new Hono<{ Bindings: CloudflareBindings }>()

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
