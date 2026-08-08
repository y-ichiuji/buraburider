import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Workers ランタイム上でテストを実行する（design-system.md 6章）。
// テストは AI を deps でモックして使わないが、本番 wrangler.jsonc の AI バインディングを
// そのまま読むとプール起動時にリモート接続が張られ、遅延・ネットワーク依存・プロセス残留
// （close timed out）を招く。そのため AI を除いた wrangler.vitest.jsonc を参照する。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.vitest.jsonc' }
    })
  ]
})
