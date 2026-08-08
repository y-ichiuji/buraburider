// テスト用の D1 スキーマ適用ヘルパ。
//
// この pool/vitest の組み合わせでは `cloudflare:test` 仮想モジュールの import が
// SyntaxError になるため、`applyD1Migrations` は使えない。代わりに実バインディングを
// `cloudflare:workers` の env から取得し、migrations/0001_init.sql を直接適用する。
// スキーマは `CREATE TABLE IF NOT EXISTS` なので冪等（複数回呼んでも安全）。
import { env } from 'cloudflare:workers'
import initSql from '../migrations/0001_init.sql?raw'

/** SQL 文字列を行コメント（--）を除いて `;` 区切りの文へ分割する。 */
function splitSqlStatements(raw: string): string[] {
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** migrations/0001_init.sql を D1（BURABURIDER_DB）へ適用する。 */
export async function applyMigrations(): Promise<void> {
  for (const statement of splitSqlStatements(initSql)) {
    await env.BURABURIDER_DB.prepare(statement).run()
  }
}
