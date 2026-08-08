import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Workers ランタイム上でテストを実行する（design-system.md 6章）。
// cloudflareTest プラグインが wrangler.jsonc からバインディング（KV CACHE など）を解決する。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' }
    })
  ]
})
