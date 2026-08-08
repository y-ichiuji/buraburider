import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Workers ランタイム上でテストを実行する（design-system.md 6章）。
// テストは AI を deps でモックして使わないが、本番 wrangler.jsonc の AI バインディングを
// そのまま読むとプール起動時にリモート接続が張られ、遅延・ネットワーク依存・プロセス残留
// （close timed out）を招く。そのため AI を除いた wrangler.vitest.jsonc を参照する。
//
// D1（BURABURIDER_DB）/ Durable Objects（RideSession）は miniflare がローカル模擬する。
// 実バインディングは各テストが `cloudflare:workers` の env から取得し、D1 スキーマは
// test/d1.ts が migrations/0001_init.sql を適用する（この pool/vitest では `cloudflare:test`
// 仮想モジュールの import が失敗するため、applyD1Migrations は使わず SQL を直接適用する）。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.vitest.jsonc' }
    })
  ]
})
