// Mapbox public token をサーバー（SSR）からブラウザへ安全に受け渡すための共有ロジック。
//
// - サーバー（src/index.tsx）: buildMapboxTokenScript() でインラインスクリプト文字列を生成し、
//   HTML の <head> に埋め込んで window.__MAPBOX_TOKEN__ へ代入する。
// - クライアント（src/client）: 埋め込まれた値を読み、isValidPublicToken() で有効性を確認する。
//
// ここに置く値・関数はいずれも純粋（DOM / mapbox-gl 非依存）で、サーバーとクライアントの双方から
// import される。シークレットトークンは扱わない（public token のみ）。

/** ブラウザ側で public token を受け取るグローバル変数名。 */
export const MAPBOX_TOKEN_GLOBAL = '__MAPBOX_TOKEN__'

/**
 * public token が有効か（未設定やプレースホルダでないか）を判定する。
 * Mapbox の public token は `pk.` で始まる。`REPLACE_WITH_...` 等はここで弾かれる。
 */
export function isValidPublicToken(token: string | undefined | null): token is string {
  return typeof token === 'string' && token.startsWith('pk.')
}

/**
 * `window.__MAPBOX_TOKEN__ = "<token>"` を実行するインラインスクリプト本文を生成する。
 * `</script>` 等での早期終了・XSS を防ぐため JSON.stringify で文字列化し、`<` をエスケープする。
 */
export function buildMapboxTokenScript(token: string): string {
  const safe = JSON.stringify(token).replaceAll('<', '\\u003c')
  return `window.${MAPBOX_TOKEN_GLOBAL}=${safe}`
}
